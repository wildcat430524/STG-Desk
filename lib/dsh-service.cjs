'use strict';
/**
 * DSH 连接后端（真实 ACP stdio JSON-RPC 客户端）。
 *
 * 本模块只承担“连接后端”职责：发现并校验本机 DSH 运行时、按课程目录（cwd）建立可恢复会话、
 * 切换模型、提交 prompt、接收流式更新、取消与释放。任何 UI / 窗口 / IPC 都由宿主负责。
 *
 * 事实依据（均来自本机安装物，非推测）：
 *   - DSH Desktop 0.2.0-rc.2 内置 @deepseek-ai/dsh-acp + @agentclientprotocol/sdk 1.4.0，
 *     `--profile acp` 走 ACP v1 stdio（换行分隔 JSON-RPC），stdout 为协议专用。
 *   - 本机 PATH 上的 dsh 0.1.6-alpha.1 虽然也带 acp profile，但其 runtime 缺
 *     `@deepseek-ai/schemastery`，插件树加载即失败；因此“PATH 上存在 dsh”不等于“可用”。
 *     本模块不据此假设，而是逐个候选做真实 ACP initialize 握手后才判定可用。
 *
 * 关键协议语义（已核对 dsh-acp 源码）：
 *   - `session/new` 返回 `{sessionId, configOptions}`；`configOptions` 中 id 为 `model`
 *     （type=select，value 形如 '["<provider>","<model>"]'，按 provider 分组）与可选的
 *     `reasoning_effort`。模型 id 直接沿用原生 configOption value，绝不臆造。
 *   - `session/set_config_option` 的改动只作用于“下一次”prompt（源码注释与
 *     KV Cache 说明均写明），因此本模块在提交 prompt 前应用模型选择。
 *   - `session/update` 通知里 `agent_message_chunk` 承载的是**已提交的整段 assistant 消息
 *     块**（源码 assistantUpdates 以 message 的 block 为单位 push），不是 token 级增量。
 *     本模块按 messageId 合并同一消息的文本块，向宿主发送 `isSnapshot:true` 的完整正文。
 *   - `session/prompt` 结束时返回 `stopReason`；取消时 DSH 映射为 `cancelled`。
 */

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const {StringDecoder}=require('node:string_decoder');

/** ACP v1（@agentclientprotocol/sdk 的 PROTOCOL_VERSION）。 */
const ACP_PROTOCOL_VERSION = 1;
/** 模型配置项 id（dsh-acp 源码常量）。 */
const MODEL_CONFIG_ID = 'model';
/** 推理强度配置项 id（dsh-acp 源码常量）；provider 默认值在协议上是空字符串。 */
const REASONING_CONFIG_ID = 'reasoning_effort';

const METHODS = {
  initialize: 'initialize',
  sessionNew: 'session/new',
  sessionResume: 'session/resume',
  sessionClose: 'session/close',
  sessionPrompt: 'session/prompt',
  sessionCancel: 'session/cancel',
  sessionUpdate: 'session/update',
  sessionSetConfigOption: 'session/set_config_option',
  sessionRequestPermission: 'session/request_permission',
};

const DEFAULT_TIMEOUTS = {
  /** 单次非 prompt 请求（initialize / session/new / resume / close / set_config_option）。 */
  requestMs: 60000,
  /** 冷启动 + ACP initialize 的整体预算。 */
  startupMs: 45000,
  /** 读取 `--version` 的预算（仅用于展示运行时版本）。 */
  versionMs: 15000,
  /** 发出 session/cancel 后等待 prompt 收尾的宽限；超时也要给 UI 一个 done，避免挂死。 */
  cancelGraceMs: 20000,
  /** dispose 时先关 stdin 再强杀的宽限。 */
  shutdownMs: 5000,
  /** 失败后多久允许重新探测运行时（避免每次查询都拉起进程）。 */
  retryMs: 15000,
};

/** prompt 正文里课程文件内容的字符预算，防止一次塞入超大工作区。 */
const DOCUMENT_BUDGET_CHARS = 200000;
/** stderr 诊断最多保留的字符数。 */
const STDERR_TAIL_CHARS = 4000;

/** 把疑似凭据的片段遮蔽，确保诊断信息与事件里不回显密钥。 */
function redact(text) {
  return String(text)
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, '[已隐去凭据]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]{6,}=*/gi, '$1[已隐去凭据]')
    .replace(/((?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*)["']?[^\s"',;]{6,}/gi, '$1[已隐去凭据]');
}

/** 生成可读的中文错误描述，尽量保留协议原始信息但不含凭据。 */
function describeError(error) {
  if (error === undefined || error === null) return '未知错误';
  if (typeof error === 'string') return redact(error);
  if (error.name === 'DshProtocolError') return redact(error.message);
  if (error.code === 'DshTransportClosed') return redact(error.message || 'DSH 连接已断开。');
  const parts = [];
  if (error.message) parts.push(redact(error.message));
  if (error.data !== undefined) {
    try {
      parts.push(redact(typeof error.data === 'string' ? error.data : JSON.stringify(error.data)));
    } catch {
      /* 不可序列化的 data 直接忽略 */
    }
  }
  return parts.filter(Boolean).join(' ') || '未知错误';
}

/** cwd 到稳定键，避免把路径直接当 JSON 键。 */
function cwdKey(cwd) {
  return crypto.createHash('sha256').update(cwd).digest('hex');
}

/**
 * 运行时的稳定标识：用于判断持久化的会话是否还能恢复。
 * 不同运行时（例如 session v3 与 v4）的会话格式可能互不兼容，
 * 因此按实际运行时路径区分，而不是按“是否注入”区分。
 */
function runtimeKey(descriptor) {
  const basis = (descriptor && (descriptor.path || descriptor.displayPath || descriptor.command)) || (descriptor && descriptor.kind) || 'unknown';
  return crypto.createHash('sha256').update(String(basis)).digest('hex').slice(0, 24);
}

/** 仅接受绝对路径且为非空字符串的 cwd。 */
function assertCwd(cwd) {
  if (typeof cwd !== 'string' || cwd.trim() === '') throw new Error('缺少课程目录（cwd），无法定位 DSH 会话。');
  if (!path.isAbsolute(cwd)) throw new Error(`课程目录必须是绝对路径：${cwd}`);
  return cwd;
}

/**
 * 用于读取子进程输出的有界累加器。
 * 只在内存里保留尾部，避免长任务把 stderr 无限放大。
 */
class TailBuffer {
  constructor(limit) { this.limit = limit; this.text = ''; }
  push(chunk) {
    this.text += chunk.toString();
    if (this.text.length > this.limit) this.text = this.text.slice(this.text.length - this.limit);
  }
  tail(max = 400) {
    const text = this.text.trim();
    return text.length <= max ? text : text.slice(text.length - max);
  }
}

/**
 * 一个 ACP stdio 连接：负责帧编解码、请求/响应配对、通知派发与子进程生命周期。
 * 传输层可注入（测试传假传输即可覆盖协议边界，不需要真实 DSH）。
 */
class AcpConnection {
  /**
   * @param {object} options
   * @param {{stdin:any,stdout:any,stderr?:any,kill?:Function,exited?:Promise<any>,pid?:number}} options.transport
   * @param {object} options.timeouts
   * @param {(error:Error)=>void} options.onClose
   */
  constructor({ transport, timeouts, onClose }) {
    this.transport = transport;
    this.timeouts = timeouts;
    this.onClose = typeof onClose === 'function' ? onClose : () => {};
    this.pending = new Map();
    this.nextId = 1;
    this.closed = false;
    this.closeReason = null;
    this.stdoutBuffer = '';
    this.stdoutDecoder = new StringDecoder('utf8');
    this.stderr = new TailBuffer(STDERR_TAIL_CHARS);
    this.protocolNotifications = 0;
    this.protocolRequests = 0;
    this.parseErrors = 0;
    this.notificationHandlers = new Set();
    this.requestHandlers = new Set();
  }

  get alive() { return !this.closed; }

  /** 挂上 stdout/stderr/exit 监听。 */
  attach() {
    const { stdout, stderr, exited } = this.transport;
    if (stdout) {
      stdout.on('data', (chunk) => this._onStdout(chunk));
      stdout.on('error', (error) => this._fail(`DSH 输出流错误：${describeError(error)}`));
    }
    if (stderr) stderr.on('data', (chunk) => this.stderr.push(chunk));
    if (this.transport.stdin && this.transport.stdin.on) {
      this.transport.stdin.on('error', (error) => this._fail(`DSH 输入流错误：${describeError(error)}`));
    }
    if (exited && typeof exited.then === 'function') {
      exited.then(
        (info) => this._fail(this._exitMessage(info), { fromExit: true }),
        () => this._fail('DSH 子进程异常退出。', { fromExit: true }),
      );
    }
  }

  _exitMessage(info) {
    const code = info && typeof info === 'object' ? info.code : info;
    const signal = info && typeof info === 'object' ? info.signal : undefined;
    const tail = this.stderr.tail();
    const suffix = tail ? `；stderr：${redact(tail)}` : '';
    if (signal) return `DSH 会话进程被信号 ${signal} 终止。${suffix}`;
    return `DSH 会话进程已退出（退出码 ${code === undefined || code === null ? '未知' : code}）。${suffix}`;
  }

  /** stdout 是换行分隔的 JSON-RPC 帧；解析失败只计数，不让 UI 崩溃。 */
  _onStdout(chunk) {
    this.stdoutBuffer += typeof chunk==='string'?chunk:this.stdoutDecoder.write(chunk);
    let index;
    while ((index = this.stdoutBuffer.indexOf('\n')) >= 0) {
      const line = this.stdoutBuffer.slice(0, index).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(index + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        this.parseErrors += 1;
        continue;
      }
      this._dispatch(message);
    }
    // 防御异常对端只写不换行导致缓冲区无限增长。
    if (this.stdoutBuffer.length > 8 * 1024 * 1024) {
      this.stdoutBuffer = '';
      this.parseErrors += 1;
    }
  }

  _dispatch(message) {
    if (!message || typeof message !== 'object') return;
    const isResponse = message.id !== undefined && message.method === undefined;
    if (isResponse) {
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      if (entry.timer) clearTimeout(entry.timer);
      if (message.error) entry.reject(protocolError(message.error));
      else entry.resolve(message.result);
      return;
    }
    if (typeof message.method !== 'string') return;
    if (message.id !== undefined) {
      this.protocolRequests += 1;
      for (const handler of this.requestHandlers) {
        try { handler(message); } catch { /* 单个处理器失败不影响协议 */ }
      }
      return;
    }
    this.protocolNotifications += 1;
    for (const handler of this.notificationHandlers) {
      try { handler(message); } catch { /* 同上 */ }
    }
  }

  onNotification(handler) { this.notificationHandlers.add(handler); return () => this.notificationHandlers.delete(handler); }
  onRequest(handler) { this.requestHandlers.add(handler); return () => this.requestHandlers.delete(handler); }

  /** 发送请求并返回 JSON-RPC id 与 promise；id 同步可得，便于 send() 立即回传 requestId。 */
  beginRequest(method, params, { timeoutMs = this.timeouts.requestMs } = {}) {
    if (this.closed) return { id: null, promise: Promise.reject(this._closedError()) };
    const id = this.nextId++;
    const promise = new Promise((resolve, reject) => {
      const entry = { resolve, reject, timer: null };
      if (timeoutMs > 0) {
        entry.timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`DSH 请求超时（${method}，${Math.round(timeoutMs / 1000)} 秒未返回）。`));
        }, timeoutMs);
        if (entry.timer.unref) entry.timer.unref();
      }
      this.pending.set(id, entry);
      try {
        this.transport.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      } catch (error) {
        this.pending.delete(id);
        if (entry.timer) clearTimeout(entry.timer);
        reject(new Error(`无法向 DSH 发送请求（${method}）：${describeError(error)}`));
      }
    });
    return { id, promise };
  }

  request(method, params, options) { return this.beginRequest(method, params, options).promise; }

  notify(method, params) {
    return this._write({ jsonrpc: '2.0', method, params });
  }

  respond(id, result) {
    return this._write({ jsonrpc: '2.0', id, result });
  }

  respondError(id, code, message) {
    return this._write({ jsonrpc: '2.0', id, error: { code, message } });
  }

  _write(message) {
    if (this.closed) return false;
    try {
      this.transport.stdin.write(`${JSON.stringify(message)}\n`);
      return true;
    } catch {
      return false;
    }
  }

  _closedError() {
    return Object.assign(new Error(this.closeReason || 'DSH 连接已关闭。'), { code: 'DshTransportClosed' });
  }

  /**
   * 连接失效：拒绝所有 pending，通知一次，且只通知一次。
   * 这是“进程退出 / 断连不挂死 UI”的落点。
   */
  _fail(reason, { fromExit = false } = {}) {
    if (this.closed) return;
    this.closed = true;
    this.closeReason = reason;
    for (const [, entry] of this.pending) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(Object.assign(new Error(reason), { code: 'DshTransportClosed' }));
    }
    this.pending.clear();
    this.onClose(Object.assign(new Error(reason), { code: 'DshTransportClosed', fromExit }));
  }

  /** 安全关闭：先关 stdin（EOF 让 ACP 正常收尾），宽限后仍存活则强杀。 */
  async stop({ graceMs = this.timeouts.shutdownMs } = {}) {
    if (this.closed && !this.transport.kill) return;
    try { this.transport.stdin.end(); } catch { /* 已关闭 */ }
    if (typeof this.transport.kill !== 'function') { this.closed = true; return; }
    const timer = setTimeout(() => {
      try { this.transport.kill(); } catch { /* 进程可能已退出 */ }
    }, graceMs);
    if (timer.unref) timer.unref();
    // 不强等 exited：即使子进程拒绝退出，dispose 也不能因此挂住宿主。
    this.closed = true;
    this.closeReason = this.closeReason || 'DSH 连接已按宿主请求关闭。';
  }
}

/** 把 JSON-RPC error 对象转成可读错误。 */
function protocolError(error) {
  const message = typeof error === 'object' && error && error.message ? error.message : JSON.stringify(error);
  const err = new Error(`DSH 返回错误：${String(message)}`);
  err.name = 'DshProtocolError';
  if (error && typeof error === 'object') {
    err.code = error.code;
    if (error.data !== undefined) err.data = error.data;
  }
  return err;
}

// ---------------------------------------------------------------------------
// 运行时发现
// ---------------------------------------------------------------------------

/** 检测一个路径是否存在（同步，仅用于候选筛选这一轻量步骤）。 */
function existsSync(target) {
  try { return fsSync.existsSync(target); } catch { return false; }
}

/**
 * 由 DSH Desktop 安装目录构造直接调用（等价于其 dsh.cmd，但绕开 .cmd 的 spawn 限制）。
 * 安装布局：<install>\DeepSeek Harness.exe 与 <install>\resources\app.asar。
 *
 * 注意：CLI 脚本位于 app.asar 内部，普通 fs 探测看不到它（Electron 自己会解析 asar 内路径），
 * 因此这里只校验 exe 与 app.asar 是否存在，绝不因 asar 内路径不可见而否决 Desktop 候选。
 */
function desktopDescriptorFromInstall(installDir) {
  if (!existsSync(installDir)) return null;
  const asar = path.join(installDir, 'resources', 'app.asar');
  if (!existsSync(asar)) return null;
  let exeName;
  try {
    exeName = fsSync.readdirSync(installDir).find((name) => /^DeepSeek Harness\.exe$/i.test(name));
  } catch {
    return null;
  }
  if (!exeName) return null;
  const cliScript = path.join(asar, 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js');
  const exe = path.join(installDir, exeName);
  return {
    kind: 'desktop',
    label: 'DSH Desktop 内置运行时',
    path: cliScript,
    displayPath: installDir,
    command: exe,
    args: ['--expose-internals', cliScript, '--profile', 'acp'],
    versionArgs: ['--expose-internals', cliScript, '--version'],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  };
}

/** PATH 上的 dsh：按 npm 全局 shim 目录解析到真实 bin.js，避免 .cmd spawn 限制。 */
function pathDshDescriptor() {
  const shimDirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const seen = new Set();
  for (const dir of shimDirs) {
    if (seen.has(dir.toLowerCase())) continue;
    seen.add(dir.toLowerCase());
    const binJs = path.join(dir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
    if (!existsSync(binJs)) continue;
    return {
      kind: 'path',
      label: 'PATH 上的 dsh',
      path: binJs,
      displayPath: binJs,
      command: process.execPath,
      args: [binJs, '--profile', 'acp'],
      versionArgs: [binJs, '--version'],
      env: process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {},
    };
  }
  return null;
}

/** 由显式字符串/对象构造运行时描述符（宿主直接指定时使用）。 */
function explicitDescriptor(value) {
  if (typeof value === 'string') {
    if (value.toLowerCase().endsWith('.cmd') || value.toLowerCase().endsWith('.bat')) {
      // 直接给 shim 时退回到 cmd.exe 调用；宿主更推荐给安装目录或 bin.js。
      return {
        kind: 'explicit',
        label: '宿主指定的 dsh',
        path: value,
        displayPath: value,
        command: process.env.ComSpec || 'cmd.exe',
        args: ['/d', '/s', '/c', `"${value}"`, '--profile', 'acp'],
        versionArgs: ['/d', '/s', '/c', `"${value}"`, '--version'],
        env: {},
      };
    }
    // 安装目录或 bin.js 都可能被传入。
    if (fsSync.existsSync(value) && fsSync.statSync(value).isDirectory()) {
      const desktop = desktopDescriptorFromInstall(value);
      if (desktop) return desktop;
    }
    return {
      kind: 'explicit',
      label: '宿主指定的 dsh',
      path: value,
      displayPath: value,
      command: process.execPath,
      args: [value, '--profile', 'acp'],
      versionArgs: [value, '--version'],
      env: process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {},
    };
  }
  if (value && typeof value === 'object' && value.command) {
    return {
      kind: 'explicit',
      label: value.label || '宿主指定的 dsh',
      path: value.path || value.command,
      displayPath: value.displayPath || value.command,
      command: value.command,
      args: Array.isArray(value.args) ? value.args : ['--profile', 'acp'],
      versionArgs: Array.isArray(value.versionArgs) ? value.versionArgs : ['--version'],
      env: value.env && typeof value.env === 'object' ? value.env : {},
    };
  }
  return null;
}

/**
 * 从 Windows 卸载注册表条目文本中解析 DSH Desktop 的安装目录。
 * 抽成纯函数以便单测，避免在测试里真的读注册表。
 * 只认 DisplayName 以 “DeepSeek Harness” 开头的条目，然后依次尝试
 * InstallLocation / DisplayIcon / UninstallString 推断安装目录。
 * @param {string} text `reg query ... /s` 的输出
 * @returns {string[]} 去重后的安装目录
 */
function parseDesktopInstallLocations(text) {
  const found = [];
  let pending = false;
  const push = (value) => {
    const trimmed = String(value || '').trim().replace(/^"|"$/g, '');
    if (!trimmed) return;
    if (!found.includes(trimmed)) found.push(trimmed);
  };
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (/^HKEY_/i.test(line) || /^\[/i.test(line)) { pending = false; continue; }
    const entry = /^(DisplayName|InstallLocation|DisplayIcon|UninstallString)\s+REG_SZ\s+(.*)$/i.exec(line);
    if (!entry) continue;
    const [, key, rawValue] = entry;
    if (key.toLowerCase() === 'displayname') {
      // 形如 “DeepSeek Harness 0.2.0-rc.2” 与裸 “DeepSeek Harness” 都接受；
      // 同名的 Chrome 快捷方式条目会被后续目录校验自然排除。
      pending = /^DeepSeek Harness\b/i.test(rawValue.trim());
      continue;
    }
    if (!pending) continue;
    if (key.toLowerCase() === 'installlocation') {
      push(rawValue);
      continue;
    }
    if (key.toLowerCase() === 'displayicon') {
      // 形如 "D:\dsh\DeepSeek Harness.exe,0"（可带引号与图标索引后缀）。
      const withoutIconIndex = rawValue.replace(/,\s*-?\d+\s*$/, '');
      const exe = /"([^"]+)"\s*$/.exec(withoutIconIndex);
      const candidate = exe ? exe[1] : withoutIconIndex.trim();
      if (/\.exe$/i.test(candidate)) push(path.dirname(candidate));
      continue;
    }
    if (key.toLowerCase() === 'uninstallstring') {
      // 形如 "\"D:\dsh\Uninstall DeepSeek Harness.exe\" /currentuser"。
      const quoted = /"([^"]+)"/.exec(rawValue);
      const candidate = quoted ? quoted[1] : rawValue.split(/\s+/)[0];
      if (/\.exe$/i.test(candidate)) push(path.dirname(candidate));
    }
  }
  return found;
}

/** 读取注册表里登记的 DSH Desktop 安装目录（仅 Windows；失败返回空数组）。 */
function registeredDesktopInstallRoots() {
  if (process.platform !== 'win32') return [];
  try {
    const result = spawnSync('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', '/s', '/f', 'DeepSeek Harness'], {
      windowsHide: true,
      encoding: 'utf8',
      timeout: 5000,
    });
    if (!result || result.status !== 0 || !result.stdout) return [];
    return parseDesktopInstallLocations(result.stdout);
  } catch {
    return [];
  }
}

/** 常见的 DSH Desktop 安装根；可用 STG_DSH_DESKTOP_ROOTS 追加（分号分隔）。 */
function desktopInstallRoots() {
  const roots = [];
  const push = (value) => { if (value && !roots.includes(value)) roots.push(value); };
  push(process.env.DSH_DESKTOP_HOME);
  for (const extra of String(process.env.STG_DSH_DESKTOP_ROOTS || '').split(';')) push(extra.trim());
  const local = process.env.LOCALAPPDATA;
  const roaming = process.env.APPDATA;
  const pf = process.env.ProgramFiles;
  const pf86 = process.env['ProgramFiles(x86)'];
  for (const base of [local, roaming, pf, pf86]) {
    if (!base) continue;
    push(path.join(base, 'DeepSeek Harness'));
    push(path.join(base, 'Programs', 'DeepSeek Harness'));
  }
  // 用户可能装到 D:\dsh 之类的自定义目录；注册表是唯一可靠来源。
  for (const registered of registeredDesktopInstallRoots()) push(registered);
  return roots;
}

// ---------------------------------------------------------------------------
// DshService
// ---------------------------------------------------------------------------

class DshService {
  /**
   * @param {object} [options]
   * @param {(event:object)=>void} [options.onEvent] 异步事件回调（status/text/done/error/session/tool）。
   * @param {string} [options.storagePath] 宿主给出的会话映射 JSON 路径；只保存 id / 运行时 / 选型等非密钥信息。
   * @param {object|Function} [options.transport] 注入传输（测试或自定义启动方式）；提供后不再自动发现运行时。
   * @param {object|string} [options.runtime] 显式指定 DSH 运行时（安装目录 / bin.js / 命令对象）。
   * @param {'allow'|'reject'|Function} [options.permission] 工具授权策略，默认 allow（用户已授权真实 Agent 按学习规则写文档）。
   * @param {object} [options.timeouts] 覆盖默认超时。
   */
  constructor({ onEvent, storagePath, transport, runtime, permission, timeouts } = {}) {
    this.onEvent = typeof onEvent === 'function' ? onEvent : () => {};
    this.storagePath = typeof storagePath === 'string' && storagePath.trim() !== '' ? storagePath : null;
    this.injectedTransport = transport || null;
    this.runtimeOption = runtime || null;
    this.permission = permission === undefined ? 'allow' : permission;
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...(timeouts && typeof timeouts === 'object' ? timeouts : {}) };

    /** cwd -> 会话记录 */
    this.sessions = new Map();
    /** cwd -> 串行化的建立/切换锁（prompt 生命周期不在锁内） */
    this.locks = new Map();
    /** 当前唯一的 ACP 连接 */
    this.connection = null;
    this.connectionPromise = null;
    this.activeRuntime = null;
    this.runtimeFailure = null;
    this.runtimeFailureAt = 0;
    this.disposed = false;
    this.mapCache = null;
    this.mapLoaded = false;
    this.storageQueue = Promise.resolve();
  }

  // -- 事件 -----------------------------------------------------------------

  _emit(event) {
    try { this.onEvent(event); } catch { /* 宿主回调异常不得影响协议处理 */ }
  }

  // -- 会话映射持久化（只存非密钥信息） --------------------------------------

  async _loadMap() {
    if (this.mapLoaded) return this.mapCache;
    this.mapLoaded = true;
    this.mapCache = { version: 1, runtimes: {}, sessions: {} };
    if (!this.storagePath) return this.mapCache;
    try {
      const raw = await fs.readFile(this.storagePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        this.mapCache = {
          version: 1,
          runtimes: parsed.runtimes && typeof parsed.runtimes === 'object' ? parsed.runtimes : {},
          sessions: parsed.sessions && typeof parsed.sessions === 'object' ? parsed.sessions : {},
        };
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        // 映射损坏不阻塞连接：以空映射继续，但留下准确说明。
        this.mapCache.readError = `会话映射读取失败（${error.code || describeError(error)}），已按空映射继续。`;
      }
    }
    return this.mapCache;
  }

  /** 原子写回映射，串行化避免并发写坏文件。 */
  _persistMap() {
    if (!this.storagePath) return Promise.resolve();
    const snapshot = JSON.stringify(this.mapCache, null, 2);
    const job = this.storageQueue.catch(() => {}).then(async () => {
      const file = this.storagePath;
      const temp = `${file}.${crypto.randomUUID()}.tmp`;
      await fs.mkdir(path.dirname(file), { recursive: true });
      try {
        await fs.writeFile(temp, snapshot, { flag: 'w' });
        await fs.rename(temp, file);
      } finally {
        await fs.unlink(temp).catch(() => {});
      }
    });
    this.storageQueue = job.catch(() => {});
    return job;
  }

  async _rememberSession(cwd, sessionId, model) {
    const map = await this._loadMap();
    map.sessions[cwdKey(cwd)] = {
      cwd,
      sessionId,
      runtimeKey: this.activeRuntime ? runtimeKey(this.activeRuntime) : null,
      model: model === undefined ? null : model,
      updatedAt: new Date().toISOString(),
    };
    await this._persistMap();
  }

  async _forgetSession(cwd) {
    const map = await this._loadMap();
    if (map.sessions[cwdKey(cwd)]) {
      delete map.sessions[cwdKey(cwd)];
      await this._persistMap();
    }
  }

  async _recallSession(cwd) {
    const map = await this._loadMap();
    return map.sessions[cwdKey(cwd)] || null;
  }

  async _rememberRuntime(descriptor, version) {
    const map = await this._loadMap();
    map.runtimes[runtimeKey(descriptor)] = {
      kind: descriptor.kind,
      path: descriptor.displayPath || descriptor.path || null,
      version: version || null,
      lastUsedAt: new Date().toISOString(),
    };
    await this._persistMap();
  }

  // -- 运行时解析 -----------------------------------------------------------

  /** 按优先级列出候选运行时；不在这里判定“可用”，可用性由真实 initialize 决定。 */
  _runtimeCandidates() {
    const candidates = [];
    const seen = new Set();
    const add = (descriptor) => {
      if (!descriptor) return;
      const key = `${descriptor.kind}|${descriptor.command}|${(descriptor.args || []).join(' ')}`;
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push(descriptor);
    };
    // 显式指定优先；其次是环境变量，便于部署时固定。
    add(explicitDescriptor(process.env.STG_DSH_RUNTIME));
    add(explicitDescriptor(process.env.STG_DSH_CLI));
    add(explicitDescriptor(this.runtimeOption));
    for (const root of desktopInstallRoots()) add(desktopDescriptorFromInstall(root));
    add(pathDshDescriptor());
    return candidates;
  }

  /** 读取运行时版本，仅用于展示（失败不影响可用性）。 */
  async _probeVersion(descriptor) {
    if (!descriptor.versionArgs) return null;
    return new Promise((resolve) => {
      let child;
      try {
        child = spawn(descriptor.command, descriptor.versionArgs, {
          env: { ...process.env, ...descriptor.env },
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch {
        resolve(null);
        return;
      }
      let out = '';
      const timer = setTimeout(() => { try { child.kill(); } catch {} resolve(null); }, this.timeouts.versionMs);
      if (timer.unref) timer.unref();
      child.stdout.on('data', (chunk) => { out += chunk.toString(); if (out.length > 4096) out = out.slice(-4096); });
      child.stderr.on('data', () => {});
      child.on('error', () => { clearTimeout(timer); resolve(null); });
      child.on('exit', () => {
        clearTimeout(timer);
        const line = out.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)[0];
        resolve(line && line.length <= 64 && /^[0-9]/.test(line) ? line : null);
      });
    });
  }

  /** 建立（或复用）到某个运行时的连接，并完成 ACP initialize。 */
  _openConnection(descriptor) {
    const transportFactory = this.injectedTransport;
    let transport;
    if (transportFactory) {
      // 注入模式：函数 / {start()} / 直接对象 三种写法都支持。
      if (typeof transportFactory === 'function') transport = transportFactory(descriptor);
      else if (typeof transportFactory.start === 'function') transport = transportFactory.start(descriptor);
      else transport = transportFactory;
    } else {
      const child = spawn(descriptor.command, descriptor.args, {
        env: { ...process.env, ...descriptor.env, DSH_TELEMETRY_DISABLED: process.env.DSH_TELEMETRY_DISABLED || '1' },
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const exited = new Promise((resolve, reject) => {
        child.on('exit', (code, signal) => resolve({ code, signal }));
        child.on('error', reject);
      });
      transport = {
        stdin: child.stdin,
        stdout: child.stdout,
        stderr: child.stderr,
        kill: () => { try { child.kill(); } catch {} },
        exited,
        pid: child.pid,
      };
    }
    return Promise.resolve(transport).then((resolved) => {
      if (!resolved || !resolved.stdin || !resolved.stdout) {
        throw new Error('DSH 传输无效：需要提供 stdin 与 stdout 流。');
      }
      const connection = new AcpConnection({ transport: resolved, timeouts: this.timeouts, onClose: (error) => this._onConnectionClosed(connection, error) });
      connection.attach();
      connection.onNotification((message) => this._onNotification(connection, message));
      connection.onRequest((message) => this._onRequest(connection, message));
      return connection;
    });
  }

  /** 依次尝试候选运行时，第一个完成真实 initialize 的即为 active。 */
  async _ensureConnection({ force = false } = {}) {
    if (this.disposed) throw new Error('DSH 连接已释放，请重新创建服务。');
    if (this.connection && this.connection.alive) return this.connection;
    if (this.connectionPromise) return this.connectionPromise;
    if (!force && this.runtimeFailure && Date.now() - this.runtimeFailureAt < this.timeouts.retryMs) {
      throw new Error(this.runtimeFailure);
    }
    this.connectionPromise = (async () => {
      const candidates = [];
      if (this.injectedTransport) {
        // 注入传输时仍允许宿主声明它代表哪个运行时，便于会话映射按运行时隔离
        // （不同 runtime 的 session 格式可能不同，v3/v4 之间不可混用）。
        const declared = explicitDescriptor(this.runtimeOption) || {
          kind: 'injected',
          label: '注入的传输',
          path: null,
          displayPath: '注入传输',
          command: null,
          args: [],
          env: {},
        };
        candidates.push({ ...declared, kind: 'injected' });
      } else {
        candidates.push(...this._runtimeCandidates());
      }
      if (candidates.length === 0) {
        const reason = '未找到可用的 DSH 运行时：本机 PATH 上没有 dsh，也没有在常见位置发现 DSH Desktop 安装。可通过 STG_DSH_RUNTIME 或 DSH_DESKTOP_HOME 指定。';
        this.runtimeFailure = reason;
        this.runtimeFailureAt = Date.now();
        throw new Error(reason);
      }
      const failures = [];
      for (const descriptor of candidates) {
        let connection = null;
        try {
          connection = await this._openConnection(descriptor);
          const initialize = connection.request(METHODS.initialize, {
            protocolVersion: ACP_PROTOCOL_VERSION,
            clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
            clientInfo: { name: 'stg-desk', version: '0.3.0' },
          });
          await withBudget(initialize, this.timeouts.startupMs, `连接 ${descriptor.label} 超时（${Math.round(this.timeouts.startupMs / 1000)} 秒内未完成 ACP initialize）。`);
          const version = descriptor.kind === 'injected' ? null : await this._probeVersion(descriptor);
          this.connection = connection;
          this.activeRuntime = { ...descriptor, version };
          this.runtimeFailure = null;
          await this._rememberRuntime(this.activeRuntime, version);
          return connection;
        } catch (error) {
          if (connection) await connection.stop({ graceMs: 500 });
          failures.push(`${descriptor.label}：${describeError(error)}`);
        }
      }
      const reason = `无法连接 DSH 运行时。已尝试 ${failures.length} 个候选：${failures.join('；')}`;
      this.runtimeFailure = reason;
      this.runtimeFailureAt = Date.now();
      throw new Error(reason);
    })().finally(() => { this.connectionPromise = null; });
    return this.connectionPromise;
  }

  /** 连接失效时清理所有会话状态，并给正在运行的任务一个准确的 error + done。 */
  _onConnectionClosed(connection, error) {
    if (this.connection !== connection) return;
    this.connection = null;
    this.runtimeFailure = `与 DSH 的连接已断开：${describeError(error)}`;
    this.runtimeFailureAt = Date.now();
    for (const [cwd, record] of this.sessions) {
      record.state = 'closed';
      if (record.running) {
        // 统一走 _settle，确保 error/done 只发一次；promise 的后续拒绝会因 settled 变为空操作。
        this._settle(record, record.running, {
          ok: false,
          error: Object.assign(new Error(`DSH 连接中断：${describeError(error)}`), { code: 'DshTransportClosed' }),
          forceCancelled: true,
        });
      }
    }
    this.sessions.clear();
  }

  // -- 会话 -----------------------------------------------------------------

  /** 同一 cwd 的建立/切换串行化；prompt 的运行期不占锁，重复发送由 running 标记拒绝。 */
  _withLock(cwd, work) {
    const previous = this.locks.get(cwd) || Promise.resolve();
    const next = previous.then(work, work);
    this.locks.set(cwd, next.then(() => {}, () => {}));
    return next;
  }

  async _ensureSession(cwd) {
    const connection = await this._ensureConnection();
    const existing = this.sessions.get(cwd);
    if (existing && existing.state === 'active' && existing.connection === connection && connection.alive) return existing;

    // 连接换代或旧会话已关闭：先尽力收尾旧会话，再重建。
    if (existing) {
      await this._closeRecord(existing, '会话重建').catch(() => {});
      this.sessions.delete(cwd);
    }

    let sessionId = null;
    let configOptions = null;
    let restored = false;
    let notice = null;
    const remembered = await this._recallSession(cwd);
    const keyMatches = remembered && remembered.runtimeKey === runtimeKey(this.activeRuntime || { kind: 'injected' });

    if (remembered && remembered.sessionId) {
      if (!keyMatches) {
        notice = '上次会话由另一个 DSH 运行时创建，当前运行时无法恢复，已为本课程创建新会话。';
      } else {
        try {
          const resumed = await connection.request(METHODS.sessionResume, { sessionId: remembered.sessionId, cwd, mcpServers: [] }, { timeoutMs: this.timeouts.requestMs });
          sessionId = remembered.sessionId;
          configOptions = (resumed && resumed.configOptions) || null;
          restored = true;
        } catch (error) {
          notice = `上次会话无法恢复（${describeError(error)}），已为本课程创建新会话。`;
        }
      }
    }

    if (!sessionId) {
      const created = await connection.request(METHODS.sessionNew, { cwd, mcpServers: [] }, { timeoutMs: this.timeouts.requestMs });
      if (!created || typeof created.sessionId !== 'string' || created.sessionId === '') {
        throw new Error('DSH 未返回有效的会话 id，无法继续。');
      }
      sessionId = created.sessionId;
      configOptions = (created && created.configOptions) || null;
    }

    const record = {
      cwd,
      sessionId,
      connection,
      state: 'active',
      configOptions,
      running: null,
      restored,
    };
    this.sessions.set(cwd, record);
    await this._rememberSession(cwd, sessionId, remembered ? remembered.model : null);
    this._emit({ type: 'session', cwd, sessionId, message: notice || (restored ? '已恢复上次会话。' : '已创建新会话。'), restored });
    return record;
  }

  /** 关闭一个会话记录（协议 session/close），失败只记录不影响后续。 */
  async _closeRecord(record, reason) {
    const connection = record.connection;
    record.state = 'closed';
    record.running = null;
    if (!connection || !connection.alive) return;
    try {
      await connection.request(METHODS.sessionClose, { sessionId: record.sessionId }, { timeoutMs: this.timeouts.requestMs });
    } catch (error) {
      if (reason) this._emit({ type: 'status', cwd: record.cwd, sessionId: record.sessionId, message: `关闭旧会话未成功（${reason}）：${describeError(error)}` });
    }
  }

  // -- 配置项（模型 / 推理强度） --------------------------------------------

  /** 从 configOptions 中提取模型与推理强度；只做映射，不发明任何选项。 */
  _describeOptions(configOptions) {
    const options = Array.isArray(configOptions) ? configOptions : [];
    const modelOption = options.find((option) => option && option.id === MODEL_CONFIG_ID && option.type === 'select') || null;
    const effortOption = options.find((option) => option && option.id === REASONING_CONFIG_ID && option.type === 'select') || null;

    const models = [];
    if (modelOption) {
      const groups = Array.isArray(modelOption.options) ? modelOption.options : [];
      for (const entry of groups) {
        if (!entry) continue;
        if (Array.isArray(entry.options)) {
          for (const child of entry.options) {
            if (!child || typeof child.value !== 'string') continue;
            models.push({ id: child.value, label: typeof child.name === 'string' && child.name ? child.name : child.value, provider: typeof entry.name === 'string' && entry.name ? entry.name : entry.group || '' });
          }
        } else if (typeof entry.value === 'string') {
          models.push({ id: entry.value, label: typeof entry.name === 'string' && entry.name ? entry.name : entry.value, provider: '' });
        }
      }
    }
    const efforts = [];
    if (effortOption) {
      const entries = Array.isArray(effortOption.options) ? effortOption.options : [];
      for (const entry of entries) {
        if (entry && Array.isArray(entry.options)) {
          for (const child of entry.options) if (child && typeof child.value === 'string') efforts.push({ id: child.value, label: typeof child.name === 'string' ? child.name : child.value });
        } else if (entry && typeof entry.value === 'string') {
          efforts.push({ id: entry.value, label: typeof entry.name === 'string' ? entry.name : entry.value });
        }
      }
    }
    return {
      models,
      selectedModel: modelOption ? modelOption.currentValue ?? null : null,
      effort: effortOption ? { id: REASONING_CONFIG_ID, label: typeof effortOption.name === 'string' ? effortOption.name : 'Reasoning effort', selected: effortOption.currentValue ?? null, options: efforts } : null,
      hasModelOption: Boolean(modelOption),
    };
  }

  /** 应用模型 / 推理强度；prompt 前调用，只影响下一次请求。 */
  async _applySelection(connection, record, { model, effort }) {
    if (model !== undefined && model !== null && model !== '') {
      if (typeof model !== 'string') throw new Error('模型参数必须是字符串 id。');
      const result = await connection.request(METHODS.sessionSetConfigOption, { sessionId: record.sessionId, configId: MODEL_CONFIG_ID, value: model }, { timeoutMs: this.timeouts.requestMs });
      record.configOptions = (result && result.configOptions) || record.configOptions;
    }
    if (effort !== undefined && effort !== null && effort !== '') {
      if (typeof effort !== 'string') throw new Error('推理强度参数必须是字符串 id。');
      const result = await connection.request(METHODS.sessionSetConfigOption, { sessionId: record.sessionId, configId: REASONING_CONFIG_ID, value: effort }, { timeoutMs: this.timeouts.requestMs });
      record.configOptions = (result && result.configOptions) || record.configOptions;
    }
    return this._describeOptions(record.configOptions);
  }

  // -- 通知与请求派发 --------------------------------------------------------

  _recordBySessionId(sessionId) {
    for (const record of this.sessions.values()) if (record.sessionId === sessionId) return record;
    return null;
  }

  _onNotification(connection, message) {
    if (message.method !== METHODS.sessionUpdate) return; // DSH 只用 session/update 承载语义更新。
    const params = message.params || {};
    const record = this._recordBySessionId(params.sessionId);
    if (!record) return;
    const update = params.update;
    if (!update || typeof update !== 'object') return;
    const requestId = record.running ? record.running.requestId : undefined;
    const base = { cwd: record.cwd, sessionId: record.sessionId, requestId };
    const snapshot=(channel,text)=>{
      if(!record.running||!update.messageId)return text;
      const blocks=record.running.textBlocks||(record.running.textBlocks=new Map());
      const key=channel+':'+update.messageId;
      const complete=(blocks.get(key)||'')+text;
      blocks.set(key,complete);
      return complete;
    };

    switch (update.sessionUpdate) {
      case 'agent_message_chunk': {
        const text = update.content && update.content.type === 'text' ? update.content.text : null;
        if (typeof text !== 'string' || text === '') return;
        // ACP 每个通知是一个已提交文本块；同一消息可能包含多个块，合并后发完整快照。
        this._emit({ ...base, type: 'text', text:snapshot('answer',text), isSnapshot: true, channel: 'answer', messageId: update.messageId });
        return;
      }
      case 'agent_thought_chunk': {
        const text = update.content && update.content.type === 'text' ? update.content.text : null;
        if (typeof text !== 'string' || text === '') return;
        this._emit({ ...base, type: 'text', text:snapshot('thought',text), isSnapshot: true, channel: 'thought', messageId: update.messageId });
        return;
      }
      case 'tool_call':
      case 'tool_call_update': {
        this._emit({
          ...base,
          type: 'tool',
          toolCallId: update.toolCallId,
          status: update.status || (update.sessionUpdate === 'tool_call' ? 'in_progress' : undefined),
          title: update.title,
          kind: update.kind,
          rawInput: update.rawInput,
        });
        return;
      }
      case 'usage_update': {
        this._emit({ ...base, type: 'status', usage: { used: update.used, size: update.size, cost: update.cost ?? null }, message: '上下文用量已更新。' });
        return;
      }
      case 'config_option_update': {
        record.configOptions = Array.isArray(update.configOptions) ? update.configOptions : record.configOptions;
        const described = this._describeOptions(record.configOptions);
        this._emit({ ...base, type: 'status', message: '模型配置已更新。', configOptions: record.configOptions, selectedModel: described.selectedModel });
        return;
      }
      default:
        // plan / modes / commands / compaction 等 DSH ACP 不上报；未知类型静默忽略以保持前向兼容。
        return;
    }
  }

  /** agent 侧请求：目前只有授权询问需要应答，必须应答否则会挂住 turn。 */
  _onRequest(connection, message) {
    if (message.method !== METHODS.sessionRequestPermission) {
      connection.respondError ? connection.respondError(message.id, -32601, `未实现的方法：${message.method}`) : connection.respond(message.id, null);
      return;
    }
    const params = message.params || {};
    const record = this._recordBySessionId(params.sessionId);
    const decide = async () => {
      if (typeof this.permission === 'function') return await this.permission({ cwd: record ? record.cwd : null, sessionId: params.sessionId, toolCall: params.toolCall, options: params.options });
      return this.permission;
    };
    const fallback = (() => {
      // 无权限回调时，只能选一个协议允许的选项；拒绝比误放行更安全。
      const options = Array.isArray(params.options) ? params.options : [];
      const rejected = options.find((option) => option && option.kind === 'reject_once') || options.find((option) => option && option.kind === 'reject_always');
      return rejected ? { outcome: 'selected', optionId: rejected.optionId } : { outcome: 'cancelled' };
    })();

    Promise.resolve()
      .then(decide)
      .then((decision) => {
        const options = Array.isArray(params.options) ? params.options : [];
        const allowOptions = options.filter((option) => option && (option.kind === 'allow_once' || option.kind === 'allow_always'));
        const rejectOptions = options.filter((option) => option && (option.kind === 'reject_once' || option.kind === 'reject_always'));
        let outcome = fallback;
        if (decision === 'allow' && allowOptions.length > 0) outcome = { outcome: 'selected', optionId: allowOptions[0].optionId };
        else if (decision === 'reject' && rejectOptions.length > 0) outcome = { outcome: 'selected', optionId: rejectOptions[0].optionId };
        else if (decision === 'cancel') outcome = { outcome: 'cancelled' };
        else if (decision && typeof decision === 'object' && typeof decision.optionId === 'string') outcome = { outcome: 'selected', optionId: decision.optionId };
        if (record) {
          this._emit({
            cwd: record.cwd,
            sessionId: record.sessionId,
            requestId: record.running ? record.running.requestId : undefined,
            type: 'tool',
            toolCallId: params.toolCall ? params.toolCall.toolCallId : undefined,
            status: 'permission',
            title: params.toolCall ? params.toolCall.title : undefined,
            permission: outcome.outcome === 'selected' ? (allowOptions.some((option) => option.optionId === outcome.optionId) ? 'allowed' : 'rejected') : 'cancelled',
          });
        }
        connection.respond(message.id, { outcome });
      })
      .catch((error) => {
        connection.respond(message.id, { outcome: { outcome: 'cancelled' } });
        this._emit({ type: 'status', cwd: record ? record.cwd : null, sessionId: params.sessionId, message: `授权处理失败，已按拒绝处理：${describeError(error)}` });
      });
  }

  // -- 公共 API -------------------------------------------------------------

  /**
   * 运行时可用性。只有真实完成 ACP initialize 才算 available/connected，绝不谎报。
   * @returns {Promise<{available:boolean,runtime:string|null,version:string|null,connected:boolean,message:string}>}
   */
  async getStatus() {
    if (this.disposed) {
      return { available: false, runtime: null, version: null, connected: false, message: 'DSH 连接已释放。' };
    }
    try {
      await this._ensureConnection();
      const descriptor = this.activeRuntime || {};
      return {
        available: true,
        runtime: descriptor.displayPath || descriptor.path || '注入传输',
        version: descriptor.version || null,
        connected: true,
        message: descriptor.kind === 'injected' ? '已连接注入的 DSH 传输（测试/自定义）。' : `已连接 ${descriptor.label || 'DSH 运行时'}。`,
      };
    } catch (error) {
      const descriptor = this.activeRuntime || {};
      return {
        available: false,
        runtime: descriptor.displayPath || descriptor.path || null,
        version: descriptor.version || null,
        connected: false,
        message: describeError(error),
      };
    }
  }

  /**
   * 列出该课程会话可选的模型（原生 configOption 值，不臆造）。
   * 失败不抛异常，而是给出可读中文原因与空列表。
   * @param {{cwd:string}} params
   */
  async getModels({ cwd } = {}) {
    try {
      const directory = assertCwd(cwd);
      const record = await this._withLock(directory, () => this._ensureSession(directory));
      const described = this._describeOptions(record.configOptions);
      const result = {
        models: described.models,
        selectedModel: described.selectedModel,
        sessionId: record.sessionId,
        effort: described.effort,
      };
      if (!described.hasModelOption) {
        result.message = 'DSH 未为该会话公布 model 配置项，暂时无法切换模型。';
      } else if (described.models.length === 0) {
        result.message = 'DSH 当前没有公布任何可选模型（可能未配置凭据或 provider 目录不可用）。';
      }
      return result;
    } catch (error) {
      return { models: [], selectedModel: null, sessionId: null, message: `无法获取模型列表：${describeError(error)}` };
    }
  }

  /**
   * 提交一次请求：确保会话与模型配置就绪后立即返回，后续通过 onEvent 异步汇报。
   * 同一 cwd 同时只允许一条在跑，重复提交直接拒绝。
   * @param {{cwd:string,text:string,model?:string,effort?:string,context?:object}} params
   * @returns {Promise<{requestId:number,sessionId:string}>}
   */
  async send({ cwd, text, model, effort, context } = {}) {
    const directory = assertCwd(cwd);
    if (typeof text !== 'string' || text.trim() === '') throw new Error('请输入要发送给 DSH 的内容。');
    return this._withLock(directory, async () => {
      const record = await this._ensureSession(directory);
      if (record.running) {
        throw new Error('该课程已有一条正在生成的回复，请等待完成或先取消，再发送新内容。');
      }
      await this._applySelection(record.connection, record, { model, effort });
      await this._rememberSession(directory, record.sessionId, model === undefined ? null : model);

      const prompt = buildPrompt({ text, context });
      const { id, promise } = record.connection.beginRequest(
        METHODS.sessionPrompt,
        { sessionId: record.sessionId, prompt: [{ type: 'text', text: prompt }] },
        { timeoutMs: 0 }, // 真实对话耗时不可预估，由 cancel / 断连负责结束。
      );
      if (id === null) throw new Error('DSH 连接不可用，请稍后重试。');

      const running = { requestId: id, cancelled: false, settled: false, graceTimer: null };
      record.running = running;

      promise.then(
        (result) => this._settle(record, running, { ok: true, result }),
        (error) => this._settle(record, running, { ok: false, error }),
      );

      this._emit({ type: 'status', cwd: directory, sessionId: record.sessionId, requestId: id, message: '已提交给 DSH，正在生成。' });
      return { requestId: id, sessionId: record.sessionId };
    });
  }

  /** prompt 收尾：只结算一次，并保证 done 一定发出。 */
  _settle(record, running, outcome) {
    if (running.settled) return;
    running.settled = true;
    if (running.graceTimer) clearTimeout(running.graceTimer);
    if (record.running === running) record.running = null;

    if (outcome.ok) {
      const stopReason = outcome.result && outcome.result.stopReason ? outcome.result.stopReason : 'end_turn';
      this._emit({
        type: 'done',
        cwd: record.cwd,
        sessionId: record.sessionId,
        requestId: running.requestId,
        stopReason,
        cancelled: stopReason === 'cancelled',
        message: stopReason === 'cancelled' ? '已取消。' : '回复完成。',
      });
      return;
    }
    const message = describeError(outcome.error);
    const cancelled = Boolean(running.cancelled) || Boolean(outcome.forceCancelled) || (outcome.error && outcome.error.code === 'DshTransportClosed');
    this._emit({ type: 'error', cwd: record.cwd, sessionId: record.sessionId, requestId: running.requestId, message, cancelled });
    this._emit({
      type: 'done',
      cwd: record.cwd,
      sessionId: record.sessionId,
      requestId: running.requestId,
      stopReason: cancelled ? 'cancelled' : 'error',
      cancelled,
      message: cancelled ? '已取消。' : '任务失败。',
    });
  }

  /**
   * 通过协议取消该课程当前 prompt。
   * @param {{cwd:string}} params
   * @returns {Promise<{cancelled:boolean,message:string}>}
   */
  async cancel({ cwd } = {}) {
    const directory = assertCwd(cwd);
    const record = this.sessions.get(directory);
    if (!record || record.state !== 'active') return { cancelled: false, message: '该课程当前没有活动会话。' };
    if (!record.running) return { cancelled: false, message: '该课程当前没有正在生成的任务。' };
    if (!record.connection.alive) {
      this._settle(record, record.running, { ok: false, error: Object.assign(new Error('DSH 连接已断开。'), { code: 'DshTransportClosed' }) });
      return { cancelled: false, message: 'DSH 连接已断开，任务已终止。' };
    }
    record.running.cancelled = true;
    const sent = record.connection.notify(METHODS.sessionCancel, { sessionId: record.sessionId });
    if (!sent) {
      this._settle(record, record.running, { ok: false, error: new Error('无法向 DSH 发送取消通知。') });
      return { cancelled: false, message: '无法向 DSH 发送取消通知。' };
    }
    // 宽限兜底：即使对端不返回 stopReason，也要让 UI 收到 done，避免挂死。
    const running = record.running;
    running.graceTimer = setTimeout(() => {
      if (!running.settled) this._settle(record, running, { ok: false, error: new Error('取消后 DSH 未在宽限时间内结束该轮次。'), forceCancelled: true });
    }, this.timeouts.cancelGraceMs);
    if (running.graceTimer.unref) running.graceTimer.unref();
    return { cancelled: true, message: '已发送取消请求。' };
  }

  /**
   * 宿主菜单“新会话”：取消并关闭旧会话，再为同一 cwd 建立全新会话。
   * 旧会话处理失败会如实汇报，不伪装成功。
   * @param {{cwd:string}} params
   */
  async newSession({ cwd } = {}) {
    const directory = assertCwd(cwd);
    return this._withLock(directory, async () => {
      const notes = [];
      const existing = this.sessions.get(directory);
      if (existing) {
        if (existing.running) {
          const running = existing.running;
          existing.running.cancelled = true;
          if (existing.connection.alive) existing.connection.notify(METHODS.sessionCancel, { sessionId: existing.sessionId });
          const settled = await this._waitForSettle(existing, running, this.timeouts.cancelGraceMs);
          if (!settled) {
            this._settle(existing, running, { ok: false, error: new Error('取消旧任务未在宽限时间内结束。') });
            notes.push('旧任务未能及时取消，已强制结束本地状态。');
          }
        }
        await this._closeRecord(existing, '新建会话').catch(() => {});
        this.sessions.delete(directory);
      }
      await this._forgetSession(directory);
      const record = await this._ensureSession(directory);
      return { sessionId: record.sessionId, message: notes.length ? notes.join(' ') : '已创建新会话。' };
    });
  }

  /** 等待某个运行中的请求结算；返回是否已结算。 */
  _waitForSettle(record, running, timeoutMs) {
    if (running.settled) return Promise.resolve(true);
    return new Promise((resolve) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (running.settled) { clearInterval(timer); resolve(true); return; }
        if (Date.now() - started >= timeoutMs) { clearInterval(timer); resolve(false); }
      }, 50);
      if (timer.unref) timer.unref();
    });
  }

  /**
   * 释放全部资源：取消在跑任务、关闭会话、结束子进程、安全落盘。
   * 任何一步失败都不会让 dispose 挂住。
   */
  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const records = [...this.sessions.values()];
    this.sessions.clear();

    await Promise.all(records.map(async (record) => {
      if (record.running) {
        const running = record.running;
        running.cancelled = true;
        if (record.connection && record.connection.alive) record.connection.notify(METHODS.sessionCancel, { sessionId: record.sessionId });
        await this._waitForSettle(record, running, Math.min(this.timeouts.cancelGraceMs, 5000));
        if (!running.settled) this._settle(record, running, { ok: false, error: new Error('释放时任务尚未结束。'), forceCancelled: true });
      }
      await this._closeRecord(record, '释放').catch(() => {});
    }));

    const connection = this.connection;
    this.connection = null;
    if (connection) await connection.stop({ graceMs: this.timeouts.shutdownMs }).catch(() => {});

    await this.storageQueue.catch(() => {});
    await this._persistMap().catch(() => {});
  }
}

/** 给 promise 套一个整体预算（用于启动阶段）。 */
function withBudget(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    if (timer.unref) timer.unref();
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

/**
 * 组装 prompt：把宿主给出的课程上下文明确写进正文，并约束学习行为。
 * 本模块不读取工作区文件，只用宿主提交的内容，避免自读整个仓库。
 */
function buildPrompt({ text, context }) {
  const ctx = context && typeof context === 'object' ? context : {};
  const documents = Array.isArray(ctx.documents) ? ctx.documents.filter((doc) => doc && typeof doc.path === 'string' && typeof doc.content === 'string') : [];
  const lines = [];

  lines.push('你是 STG Desk 学习工作台的课程辅导助手。请严格遵守以下学习规则：');
  lines.push('1. 只有当学生已经“提交”的作答才可用于评估与讲解；未提交的草稿不得评价、不得继续作答。');
  lines.push('2. 不要替学生写出本应由学生独立完成的答案；用提问、提示、反例和讲解引导。');
  lines.push('3. 需要读写文件时，只操作下面列出的课程文件路径，不要改动其它文件。');
  lines.push('4. 用中文回答，简洁准确。');

  if (ctx.subject || ctx.lesson) {
    lines.push('');
    lines.push(`当前课程：${ctx.subject ? `学科 ${ctx.subject}` : ''}${ctx.subject && ctx.lesson ? '，' : ''}${ctx.lesson ? `课节 ${ctx.lesson}` : ''}`);
  }
  if (ctx.round !== undefined && ctx.round !== null && ctx.round !== '') lines.push(`当前轮次：${ctx.round}`);

  if (documents.length > 0) {
    lines.push('');
    lines.push('【课程文件】（已由宿主提交，语义以 role 为准：submitted-answer=学生已提交作答，可用于评估；某轮次草稿=draft，不得代为完成）');
    let budget = DOCUMENT_BUDGET_CHARS;
    for (const doc of documents) {
      const role = doc.role ? `角色：${doc.role}` : '角色未标注';
      lines.push(`--- 文件：${doc.path}（${role}）---`);
      let content = doc.content;
      if (content.length > budget) {
        content = `${content.slice(0, Math.max(0, budget))}\n…（内容过长已截断）`;
      }
      budget -= content.length;
      lines.push(content);
      if (budget <= 0) {
        lines.push('（其余文件因长度预算已省略）');
        break;
      }
    }
  }

  lines.push('');
  lines.push('【学生本次输入】');
  lines.push(text);
  return lines.join('\n');
}

module.exports = { DshService, parseDesktopInstallLocations };
