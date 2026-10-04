'use strict';
/**
 * lib/dsh-service.cjs 的行为测试。
 *
 * 全部使用注入的假传输（fake ACP stdio 传输），因此：
 *   - 不启动真实 DSH，不调用真实模型；
 *   - 不写入任何学习文档，不触碰用户 DSH_HOME / 全局设置。
 * 假传输严格按真实 ACP v1 线格式收发（换行分隔 JSON-RPC），以覆盖协议边界。
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DshService, parseDesktopInstallLocations } = require('../lib/dsh-service.cjs');

// ---------------------------------------------------------------------------
// 假 ACP 传输：模拟 dsh --profile acp 的 stdio 行为
// ---------------------------------------------------------------------------

const MODEL_VALUES = [
  { value: '["deepseek-official","deepseek-v4-flash"]', name: 'deepseek-v4-flash' },
  { value: '["deepseek-official","deepseek-v4-pro"]', name: 'DeepSeek-V4-Pro' },
  { value: '["local-ollama","qwen3"]', name: 'qwen3' },
];

function configOptions(modelCurrent = MODEL_VALUES[0].value, effortCurrent = 'high', { withEffort = true } = {}) {
  const options = [
    {
      id: 'model',
      name: 'Model',
      category: 'model',
      type: 'select',
      currentValue: modelCurrent,
      options: [
        { group: 'deepseek-official', name: 'DeepSeek Official', options: MODEL_VALUES.slice(0, 2) },
        { group: 'local-ollama', name: 'Local Ollama', options: MODEL_VALUES.slice(2) },
      ],
    },
  ];
  if (withEffort) {
    options.push({
      id: 'reasoning_effort',
      name: 'Reasoning effort',
      category: 'thought_level',
      type: 'select',
      currentValue: effortCurrent,
      options: [
        { value: 'off', name: 'Off' },
        { value: 'low', name: 'Low' },
        { value: 'high', name: 'High' },
        { value: 'max', name: 'Max' },
      ],
    });
  }
  return options;
}

class FakeAcpServer {
  constructor(options = {}) {
    this.calls = [];
    this.notifications = [];
    this.resumeSessions = new Map();
    this.configOptions = options.configOptions || configOptions();
    this.neverRespondToPrompt = Boolean(options.neverRespondToPrompt);
    this.resumeFails = Boolean(options.resumeFails);
    this.promptHandler = options.promptHandler || null;
    this.permissionRequests = 0;
    this.sessionSeq = 0;
    this._pendingPromptBySession = new Map();
    this.failInitialize = Boolean(options.failInitialize);
    this.stdoutLines = [];
    this.stderrLines = [];
    this.exited = null;
    this._closed = false;

    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const stdin = new EventEmitter();
    stdin.setMaxListeners = () => {};
    stdout.setMaxListeners = () => {};
    this.stdout = stdout;
    this.stderr = stderr;

    stdin.write = (chunk) => {
      const line = String(chunk).trim();
      if (!line) return true;
      // 真实子进程不会在 write 调用栈内同步回包。
      setImmediate(() => this._handle(line));
      return true;
    };
    stdin.end = () => { this._closed = true; };

    this.transport = {
      stdin,
      stdout,
      stderr,
      kill: () => this.crash(1, null),
      exited: new Promise((resolve) => { this._resolveExit = resolve; }),
      pid: 4242,
    };
  }

  emitStdout(object) {
    this.stdoutLines.push(object);
    this.stdout.emit('data', Buffer.from(`${JSON.stringify(object)}\n`));
  }

  emitRaw(text) {
    this.stdout.emit('data', Buffer.from(text));
  }

  emitStderr(text) {
    this.stderrLines.push(text);
    this.stderr.emit('data', Buffer.from(text));
  }

  crash(code, signal) {
    if (this._exited) return;
    this._exited = true;
    if (this._resolveExit) this._resolveExit({ code, signal });
  }

  _handle(line) {
    if (this._closed) return;
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.method === 'initialize') {
      if (this.failInitialize) {
        this.emitStdout({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: '内部错误：插件树加载失败' } });
        return;
      }
      this.calls.push({ method: 'initialize', params: message.params });
      this.emitStdout({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: 1,
          agentInfo: { name: 'deepseek-harness-acp', version: '0.0.1' },
          agentCapabilities: { sessionCapabilities: { list: {}, resume: {}, close: {} } },
          authMethods: [],
        },
      });
      return;
    }
    if (message.method === 'session/new') {
      this.calls.push({ method: 'session/new', params: message.params });
      this.sessionSeq += 1;
      const sessionId = `sess-${this.sessionSeq}-${Math.random().toString(16).slice(2, 8)}`;
      this.emitStdout({ jsonrpc: '2.0', id: message.id, result: { sessionId, configOptions: this.configOptions } });
      return;
    }
    if (message.method === 'session/resume') {
      this.calls.push({ method: 'session/resume', params: message.params });
      if (this.resumeFails) {
        this.emitStdout({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: '会话不存在或 cwd 不匹配' } });
        return;
      }
      this.emitStdout({ jsonrpc: '2.0', id: message.id, result: { configOptions: this.configOptions } });
      return;
    }
    if (message.method === 'session/set_config_option') {
      this.calls.push({ method: 'session/set_config_option', params: message.params });
      const { configId, value } = message.params || {};
      const known = this.configOptions.find((option) => option.id === configId);
      if (!known) {
        this.emitStdout({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: `unknown session config option: ${configId}` } });
        return;
      }
      let valid = false;
      const values = [];
      const walk = (entries) => {
        for (const entry of entries || []) {
          if (Array.isArray(entry.options)) walk(entry.options);
          else values.push(entry.value);
        }
      };
      walk(known.options);
      valid = values.includes(value);
      if (!valid) {
        const noun = configId === 'model' ? 'model option' : configId === 'reasoning_effort' ? 'reasoning effort' : configId;
        this.emitStdout({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: `unknown ${noun}: ${value}` } });
        return;
      }
      known.currentValue = value;
      this.emitStdout({ jsonrpc: '2.0', id: message.id, result: { configOptions: this.configOptions } });
      return;
    }
    if (message.method === 'session/prompt') {
      this.calls.push({ method: 'session/prompt', params: message.params });
      const sessionId = message.params.sessionId;
      const id = message.id;
      // 按会话记录在跑的 prompt id：真实 DSH 允许一条连接上多个会话各自在跑。
      this._pendingPromptBySession.set(sessionId, id);
      if (this.promptHandler) { this.promptHandler(this, { id, sessionId, params: message.params }); return; }
      if (this.neverRespondToPrompt) return;
      this.notifyUpdate(sessionId, { sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: '第一段完整回复。' } });
      this.notifyUpdate(sessionId, { sessionUpdate: 'agent_thought_chunk', messageId: 'm1', content: { type: 'text', text: '先看已提交作答。' } });
      this.notifyUpdate(sessionId, { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'read_file', kind: 'other', status: 'in_progress' });
      this.notifyUpdate(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed' });
      this._pendingPromptBySession.delete(sessionId);
      this.emitStdout({ jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } });
      return;
    }
    if (message.method === 'session/cancel') {
      this.calls.push({ method: 'session/cancel', params: message.params });
      // 真实 DSH 之后会以 stopReason: cancelled 结束该会话对应的 session/prompt。
      const sessionId = message.params.sessionId;
      const pendingId = this._pendingPromptBySession.get(sessionId);
      if (pendingId !== undefined) {
        this._pendingPromptBySession.delete(sessionId);
        this.emitStdout({ jsonrpc: '2.0', id: pendingId, result: { stopReason: 'cancelled' } });
      }
      return;
    }
    if (message.method === 'session/close') {
      this.calls.push({ method: 'session/close', params: message.params });
      this.emitStdout({ jsonrpc: '2.0', id: message.id, result: {} });
      return;
    }
    // 未知方法：按 JSON-RPC 规范回 method not found，避免对端挂死。
    if (message.id !== undefined) {
      this.emitStdout({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `未知方法 ${message.method}` } });
    }
  }

  notifyUpdate(sessionId, update) {
    this.emitStdout({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update } });
  }

  /** 记录某会话待取消的 prompt id（session/prompt 已自动登记，此方法供测试显式补齐）。 */
  trackPrompt(id, sessionId) { this._pendingPromptBySession.set(sessionId, id); }

  callsOf(method) { return this.calls.filter((call) => call.method === method); }
}

/** 构造一个使用假传输的服务与事件收集器。 */
async function makeService(t, serverOptions = {}, serviceOptions = {}) {
  const server = new FakeAcpServer(serverOptions);
  const events = [];
  const service = new DshService({
    onEvent: (event) => events.push(event),
    transport: { start: () => server.transport },
    ...serviceOptions,
  });
  t.after(async () => { await service.dispose().catch(() => {}); });
  return { server, service, events, eventsOf: (type) => events.filter((event) => event.type === type) };
}

async function tempDir(t, prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

/** 等待某个条件成立（事件驱动，不依赖固定 sleep 时长）。 */
async function waitFor(predicate, { timeoutMs = 5000, label = '条件' } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`等待超时：${label}`);
}

// ---------------------------------------------------------------------------
// getStatus
// ---------------------------------------------------------------------------

test('getStatus 在真实 initialize 成功后才会报告 connected', async (t) => {
  const { service, server } = await makeService(t);
  const status = await service.getStatus();
  assert.equal(status.available, true);
  assert.equal(status.connected, true);
  assert.equal(status.runtime, '注入传输', 'runtime 应给出可读标识');
  assert.match(status.message, /已连接/);
  assert.equal(server.callsOf('initialize').length, 1, '必须真实完成一次 ACP initialize');
  // runtime 字段是绝对路径或固定标识，且不得包含凭据。
  assert.ok(!/sk-|Bearer\s/i.test(String(status.runtime)));
});

test('getStatus 在 initialize 失败时如实报错，不假连接', async (t) => {
  const { service } = await makeService(t, { failInitialize: true });
  const status = await service.getStatus();
  assert.equal(status.available, false);
  assert.equal(status.connected, false);
  assert.match(status.message, /无法连接 DSH 运行时/);
  assert.match(status.message, /插件树加载失败/, '应保留协议侧可读原因');
});

test('getStatus 在释放后报告不可用', async (t) => {
  const { service } = await makeService(t);
  await service.getStatus();
  await service.dispose();
  const status = await service.getStatus();
  assert.equal(status.available, false);
  assert.equal(status.connected, false);
  assert.match(status.message, /已释放/);
});

test('连接串行：并发 getStatus 只建立一条连接', async (t) => {
  const { service, server } = await makeService(t);
  await Promise.all([service.getStatus(), service.getStatus(), service.getStatus()]);
  assert.equal(server.callsOf('initialize').length, 1);
});

// ---------------------------------------------------------------------------
// getModels
// ---------------------------------------------------------------------------

test('getModels 映射原生 provider 分组模型，不捏造可选模型', async (t) => {
  const cwd = await tempDir(t, 'dsh-models-');
  const { service } = await makeService(t);
  const result = await service.getModels({ cwd });
  assert.equal(result.message, undefined, '成功时不应带错误说明');
  assert.equal(result.models.length, 3);
  assert.deepEqual(result.models.map((model) => model.label), ['deepseek-v4-flash', 'DeepSeek-V4-Pro', 'qwen3']);
  assert.deepEqual(result.models.map((model) => model.provider), ['DeepSeek Official', 'DeepSeek Official', 'Local Ollama']);
  // id 必须是原生 configOption value，可原样回传。
  assert.equal(result.models[0].id, MODEL_VALUES[0].value);
  assert.equal(result.selectedModel, MODEL_VALUES[0].value);
  assert.ok(result.sessionId);
  // 原生 effort 选项作为附加信息暴露，不混入 models。
  assert.equal(result.effort.id, 'reasoning_effort');
  assert.deepEqual(result.effort.options.map((option) => option.id), ['off', 'low', 'high', 'max']);
  assert.equal(result.effort.selected, 'high');
});

test('getModels 在 DSH 未公布 model 选项时给出可读说明而非空成功', async (t) => {
  const cwd = await tempDir(t, 'dsh-nomodel-');
  const { service } = await makeService(t, { configOptions: [] });
  const result = await service.getModels({ cwd });
  assert.deepEqual(result.models, []);
  assert.equal(result.selectedModel, null);
  assert.match(result.message, /未为该会话公布 model 配置项/);
});

test('getModels 缺 cwd 或相对路径时返回可读中文原因', async (t) => {
  const { service } = await makeService(t);
  const missing = await service.getModels({});
  assert.deepEqual(missing.models, []);
  assert.match(missing.message, /缺少课程目录/);
  const relative = await service.getModels({ cwd: 'relative/dir' });
  assert.deepEqual(relative.models, []);
  assert.match(relative.message, /必须是绝对路径/);
});

test('getModels 在同 cwd 复用会话，不重复 session/new', async (t) => {
  const cwd = await tempDir(t, 'dsh-reuse-');
  const { service, server } = await makeService(t);
  const first = await service.getModels({ cwd });
  const second = await service.getModels({ cwd });
  assert.equal(server.callsOf('session/new').length, 1, '同 cwd 应只有一个会话');
  assert.equal(first.sessionId, second.sessionId);
});

test('不同 cwd 各自建立独立会话', async (t) => {
  const a = await tempDir(t, 'dsh-a-');
  const b = await tempDir(t, 'dsh-b-');
  const { service, server } = await makeService(t);
  const first = await service.getModels({ cwd: a });
  const second = await service.getModels({ cwd: b });
  assert.notEqual(first.sessionId, second.sessionId);
  assert.equal(server.callsOf('session/new').length, 2);
});

// ---------------------------------------------------------------------------
// send / onEvent
// ---------------------------------------------------------------------------

test('send 立即返回 requestId 与 sessionId，随后异步上报快照文本与 done', async (t) => {
  const cwd = await tempDir(t, 'dsh-send-');
  const { service, server, events } = await makeService(t);
  const ack = await service.send({ cwd, text: '请评估我提交的作答。' });
  assert.ok(Number.isInteger(ack.requestId), 'requestId 必须是 JSON-RPC id');
  assert.ok(ack.sessionId);

  await waitFor(() => events.some((event) => event.type === 'done'), { label: 'done 事件' });

  const texts = events.filter((event) => event.type === 'text');
  assert.ok(texts.length >= 2, '应至少收到正文与思考两类文本事件');
  for (const event of texts) {
    assert.equal(event.isSnapshot, true, 'DSH 发的是整段消息块，必须标记为快照');
    assert.equal(event.cwd, cwd);
    assert.equal(event.sessionId, ack.sessionId);
    assert.equal(event.requestId, ack.requestId);
    assert.equal(typeof event.text, 'string');
  }
  const answer = texts.filter((event) => event.channel === 'answer');
  const thought = texts.filter((event) => event.channel === 'thought');
  assert.deepEqual(answer.map((event) => event.text), ['第一段完整回复。']);
  assert.deepEqual(thought.map((event) => event.text), ['先看已提交作答。']);

  const tools = events.filter((event) => event.type === 'tool');
  assert.ok(tools.some((event) => event.toolCallId === 't1' && event.status === 'in_progress'));
  assert.ok(tools.some((event) => event.toolCallId === 't1' && event.status === 'completed'));

  const done = events.filter((event) => event.type === 'done');
  assert.equal(done.length, 1, 'done 必须恰好发一次');
  assert.equal(done[0].stopReason, 'end_turn');
  assert.equal(done[0].cancelled, false);
});

test('同一消息的多个已提交文本块组合成完整快照', async (t) => {
  const cwd = await tempDir(t, 'dsh-snap-');
  const { service, events } = await makeService(t, {
    configOptions: configOptions(),
    promptHandler: (server, { id, sessionId }) => {
      server.notifyUpdate(sessionId, { sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: 'A' } });
      server.notifyUpdate(sessionId, { sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: 'B' } });
      server.emitStdout({ jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } });
    },
  });
  await service.send({ cwd, text: 'hi' });
  await waitFor(() => events.some((event) => event.type === 'done'));
  assert.deepEqual(events.filter((event) => event.type === 'text').map((event) => event.text), ['A', 'AB']);
  assert.ok(events.filter((event) => event.type === 'text').every((event) => event.isSnapshot === true));
});

test('同 cwd 同时只允许一条运行，重复 send 被拒绝', async (t) => {
  const cwd = await tempDir(t, 'dsh-busy-');
  const { service, server } = await makeService(t, { neverRespondToPrompt: true });
  await service.send({ cwd, text: '第一次' });
  await waitFor(() => server.callsOf('session/prompt').length === 1, { label: '第一条 prompt' });
  await assert.rejects(service.send({ cwd, text: '第二次' }), /正在生成/);
  assert.equal(server.callsOf('session/prompt').length, 1, '被拒绝的请求不得进入协议');
});

test('不同 cwd 互不阻塞，可并行运行', async (t) => {
  const a = await tempDir(t, 'dsh-p1-');
  const b = await tempDir(t, 'dsh-p2-');
  const { service, server } = await makeService(t, { neverRespondToPrompt: true });
  const first = await service.send({ cwd: a, text: '一' });
  const second = await service.send({ cwd: b, text: '二' });
  assert.notEqual(first.sessionId, second.sessionId);
  await waitFor(() => server.callsOf('session/prompt').length === 2, { label: '两条 prompt' });
});

test('send 拒绝空内容与非法 cwd', async (t) => {
  const cwd = await tempDir(t, 'dsh-invalid-');
  const { service } = await makeService(t);
  await assert.rejects(service.send({ cwd, text: '   ' }), /请输入要发送/);
  await assert.rejects(service.send({ text: 'x' }), /缺少课程目录/);
  await assert.rejects(service.send({ cwd: 'rel', text: 'x' }), /必须是绝对路径/);
});

// ---------------------------------------------------------------------------
// 模型切换
// ---------------------------------------------------------------------------

test('模型选择对下一次请求生效：prompt 之前先 set_config_option', async (t) => {
  const cwd = await tempDir(t, 'dsh-model-');
  const { service, server } = await makeService(t);
  const target = MODEL_VALUES[1].value;
  await service.send({ cwd, text: '用 Pro 回答', model: target });
  await waitFor(() => server.callsOf('session/prompt').length === 1, { label: 'prompt' });

  const order = server.calls.map((call) => call.method);
  const setIndex = order.indexOf('session/set_config_option');
  const promptIndex = order.indexOf('session/prompt');
  assert.ok(setIndex >= 0, '必须先调用 set_config_option');
  assert.ok(setIndex < promptIndex, `set_config_option 必须早于 prompt，实际：${order.join(' > ')}`);
  assert.equal(server.callsOf('session/set_config_option')[0].params.value, target);

  const models = await service.getModels({ cwd });
  assert.equal(models.selectedModel, target, '切换后 currentValue 应更新');
});

test('模型切换只影响下一次请求，已有会话与消息保留', async (t) => {
  const cwd = await tempDir(t, 'dsh-keep-');
  const { service, server } = await makeService(t);
  const firstSend = await service.send({ cwd, text: '第一次' });
  await waitFor(() => server.callsOf('session/prompt').length === 1);
  const secondSend = await service.send({ cwd, text: '第二次', model: MODEL_VALUES[2].value });
  await waitFor(() => server.callsOf('session/prompt').length === 2);
  assert.equal(secondSend.sessionId, firstSend.sessionId, '同一 cwd 应复用会话，历史不丢');
  assert.equal(server.callsOf('session/new').length, 1, '不得因为换模型而新建会话');
});

test('无效模型 id 时如实报错，不静默退回', async (t) => {
  const cwd = await tempDir(t, 'dsh-badmodel-');
  const { service, server } = await makeService(t);
  await assert.rejects(service.send({ cwd, text: 'x', model: '["fake","nope"]' }), /unknown model option/);
  assert.equal(server.callsOf('session/prompt').length, 0, '配置失败不得发出 prompt');
  const models = await service.getModels({ cwd });
  assert.equal(models.selectedModel, MODEL_VALUES[0].value, '失败后选型保持原值');
});

test('推理强度可作为独立选项切换', async (t) => {
  const cwd = await tempDir(t, 'dsh-effort-');
  const { service, server } = await makeService(t);
  await service.send({ cwd, text: 'x', effort: 'max' });
  await waitFor(() => server.callsOf('session/prompt').length === 1);
  const effortCall = server.callsOf('session/set_config_option').find((call) => call.params.configId === 'reasoning_effort');
  assert.ok(effortCall, '应调用 reasoning_effort');
  assert.equal(effortCall.params.value, 'max');
  const models = await service.getModels({ cwd });
  assert.equal(models.effort.selected, 'max');
});

test('推理强度非法值报错且不发 prompt', async (t) => {
  const cwd = await tempDir(t, 'dsh-badeffort-');
  const { service, server } = await makeService(t);
  await assert.rejects(service.send({ cwd, text: 'x', effort: 'ultra' }), /unknown reasoning effort/);
  assert.equal(server.callsOf('session/prompt').length, 0);
});

// ---------------------------------------------------------------------------
// cancel
// ---------------------------------------------------------------------------

test('cancel 通过协议取消并最终发出 done(cancelled)', async (t) => {
  const cwd = await tempDir(t, 'dsh-cancel-');
  const { service, server, events } = await makeService(t, {
    promptHandler: (fake, { sessionId }) => {
      // 真实 DSH 会等到 session/cancel 才以 cancelled 结束（id 已由 server 自动登记）。
      fake.notifyUpdate(sessionId, { sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: '部分内容' } });
    },
  });
  await service.send({ cwd, text: '长任务' });
  await waitFor(() => events.some((event) => event.type === 'text'), { label: '首个文本事件' });

  const result = await service.cancel({ cwd });
  assert.equal(result.cancelled, true);
  assert.match(result.message, /已发送取消请求/);
  await waitFor(() => server.callsOf('session/cancel').length === 1, { label: '取消通知' });
  const newSessionCall = server.callsOf('session/new')[0];
  const createdId = newSessionCall ? newSessionCall.params && newSessionCall.params.cwd : undefined;
  assert.equal(createdId, cwd, 'session/new 必须携带该课程 cwd');

  await waitFor(() => events.some((event) => event.type === 'done'), { label: '取消后的 done' });
  const done = events.filter((event) => event.type === 'done');
  assert.equal(done.length, 1);
  assert.equal(done[0].stopReason, 'cancelled');
  assert.equal(done[0].cancelled, true);
  assert.ok(!events.some((event) => event.type === 'error'), '协议正常取消不应报 error');
});

test('cancel 在没有运行任务时如实说明', async (t) => {
  const cwd = await tempDir(t, 'dsh-idle-');
  const { service } = await makeService(t);
  await service.getModels({ cwd });
  const result = await service.cancel({ cwd });
  assert.equal(result.cancelled, false);
  assert.match(result.message, /没有正在生成的任务/);
});

test('cancel 对未知 cwd 返回可读说明而非抛错', async (t) => {
  const cwd = await tempDir(t, 'dsh-unknown-');
  const { service } = await makeService(t);
  const result = await service.cancel({ cwd });
  assert.equal(result.cancelled, false);
  assert.match(result.message, /没有活动会话/);
});

// ---------------------------------------------------------------------------
// 会话恢复 / storagePath
// ---------------------------------------------------------------------------

test('storagePath 只保存非密钥的会话映射，且可按 cwd 恢复会话', async (t) => {
  const cwd = await tempDir(t, 'dsh-store-');
  const store = path.join(await tempDir(t, 'dsh-store-file-'), 'sessions.json');
  const first = await makeService(t, {}, { storagePath: store });
  const created = await first.service.getModels({ cwd });
  await first.service.dispose();

  const raw = await fs.readFile(store, 'utf8');
  const parsed = JSON.parse(raw);
  assert.equal(parsed.version, 1);
  const entries = Object.values(parsed.sessions);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].cwd, cwd);
  assert.equal(entries[0].sessionId, created.sessionId);
  assert.ok(entries[0].runtimeKey, '必须记录运行时标识以便判断能否恢复');
  // 映射里不得出现课程正文、凭据或消息内容。
  assert.ok(!/第一段|sk-|Bearer|api[_-]?key/i.test(raw), '映射不得包含消息正文或凭据');

  const second = new FakeAcpServer({});
  const service2 = new DshService({ onEvent: () => {}, storagePath: store, transport: { start: () => second.transport } });
  t.after(async () => { await service2.dispose().catch(() => {}); });
  const resumed = await service2.getModels({ cwd });
  assert.equal(second.callsOf('session/resume').length, 1, '应优先尝试协议恢复');
  assert.equal(second.callsOf('session/new').length, 0, '恢复成功不应新建会话');
  assert.equal(resumed.sessionId, created.sessionId);
});

test('恢复失败时创建新会话，并明确告知未恢复成功', async (t) => {
  const cwd = await tempDir(t, 'dsh-resumefail-');
  const store = path.join(await tempDir(t, 'dsh-resumefail-file-'), 'sessions.json');
  const first = await makeService(t, {}, { storagePath: store });
  await first.service.getModels({ cwd });
  await first.service.dispose();

  const { service, server, events } = await makeService(t, { resumeFails: true }, { storagePath: store });
  const result = await service.getModels({ cwd });
  assert.equal(server.callsOf('session/resume').length, 1);
  assert.equal(server.callsOf('session/new').length, 1, '恢复失败必须新建会话');
  await waitFor(() => events.some((event) => event.type === 'session'), { label: 'session 事件' });
  const sessionEvent = events.filter((event) => event.type === 'session')[0];
  assert.equal(sessionEvent.restored, false);
  assert.match(sessionEvent.message, /无法恢复/);
  assert.ok(result.sessionId);
  assert.notEqual(sessionEvent.sessionId, null);
});

test('损坏的会话映射不会阻塞连接，只留可读说明', async (t) => {
  const cwd = await tempDir(t, 'dsh-corrupt-');
  const store = path.join(await tempDir(t, 'dsh-corrupt-file-'), 'sessions.json');
  await fs.writeFile(store, '{ this is not json', 'utf8');
  const { service, server } = await makeService(t, {}, { storagePath: store });
  const result = await service.getModels({ cwd });
  assert.ok(result.sessionId, '仍应能建立会话');
  assert.equal(server.callsOf('session/new').length, 1);
});

// ---------------------------------------------------------------------------
// newSession
// ---------------------------------------------------------------------------

test('newSession 取消并关闭旧会话后建立全新会话', async (t) => {
  const cwd = await tempDir(t, 'dsh-new-');
  const { service, server, events } = await makeService(t, {
    promptHandler: (fake, { sessionId }) => {
      fake.notifyUpdate(sessionId, { sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: '生成中' } });
    },
  });
  const before = await service.getModels({ cwd });
  await service.send({ cwd, text: '旧任务' });
  await waitFor(() => events.some((event) => event.type === 'text'));

  const result = await service.newSession({ cwd });
  assert.ok(result.sessionId);
  assert.equal(server.callsOf('session/cancel').length, 1, '应取消旧任务');
  assert.equal(server.callsOf('session/close').length, 1, '应关闭旧会话');
  assert.equal(server.callsOf('session/new').length, 2, '应新建会话');
  assert.notEqual(result.sessionId, before.sessionId);
  assert.match(result.message, /已创建新会话/);
});

// ---------------------------------------------------------------------------
// 断连 / 退出
// ---------------------------------------------------------------------------

test('子进程退出时 pending 请求被拒绝，运行中的任务收到 error 与 done', async (t) => {
  const cwd = await tempDir(t, 'dsh-crash-');
  const { service, server, events } = await makeService(t, { neverRespondToPrompt: true });
  await service.send({ cwd, text: '待崩溃' });
  await waitFor(() => server.callsOf('session/prompt').length === 1);

  server.emitStderr('fatal: worker crashed with api_key=sk-live-abcdef123456\n');
  server.crash(1, null);

  await waitFor(() => events.some((event) => event.type === 'done'), { label: '崩溃后的 done' });
  const errors = events.filter((event) => event.type === 'error');
  const done = events.filter((event) => event.type === 'done');
  assert.equal(errors.length, 1);
  assert.equal(done.length, 1);
  assert.equal(done[0].stopReason, 'cancelled');
  assert.equal(done[0].cancelled, true);
  // 诊断信息里不得泄露 stderr 中的凭据。
  assert.ok(!/sk-live-abcdef123456/.test(errors[0].message), '不得回显凭据');
  assert.ok(!/sk-live/.test(errors[0].message));
});

test('断连后 getStatus 如实报告断开，不假连接', async (t) => {
  const { service, server } = await makeService(t);
  await service.getStatus();
  server.crash(0, null);
  await waitFor(() => service.connection === null, { label: '连接清理' });
  const status = await service.getStatus();
  // 允许重建（注入传输仍可 start），但绝不能声称还连着旧连接。
  assert.equal(typeof status.message, 'string');
  assert.ok(status.message.length > 0);
});

test('stdout 中的非 JSON 帧被容忍，不影响后续协议', async (t) => {
  const cwd = await tempDir(t, 'dsh-garbage-');
  const { service, server } = await makeService(t);
  await service.getStatus();
  server.emitRaw('this is not json\n');
  const result = await service.getModels({ cwd });
  assert.ok(result.sessionId, '脏帧后仍应能继续工作');
});

test('中文 UTF-8 字符跨 stdout 数据块仍完整显示', async t=>{
  const cwd=await tempDir(t,'dsh-utf8-');
  const {service,events}=await makeService(t,{promptHandler:(fake,{id,sessionId})=>{
    const frame=Buffer.from(JSON.stringify({jsonrpc:'2.0',method:'session/update',params:{sessionId,update:{sessionUpdate:'agent_message_chunk',messageId:'unicode',content:{type:'text',text:'学习继续'}}}})+'\n');
    const split=frame.indexOf(Buffer.from('学'))+1;
    fake.stdout.emit('data',frame.subarray(0,split));fake.stdout.emit('data',frame.subarray(split));
    fake.emitStdout({jsonrpc:'2.0',id,result:{stopReason:'end_turn'}});
  }});
  await service.send({cwd,text:'继续'});await waitFor(()=>events.some(e=>e.type==='done'));
  assert.equal(events.find(e=>e.type==='text').text,'学习继续');
});

test('未知通知类型被静默忽略', async (t) => {
  const cwd = await tempDir(t, 'dsh-unknown-notif-');
  const { service, server, events } = await makeService(t, {
    promptHandler: (fake, { id, sessionId }) => {
      fake.notifyUpdate(sessionId, { sessionUpdate: 'plan', entries: [] });
      fake.notifyUpdate(sessionId, { sessionUpdate: 'some_future_update', foo: 1 });
      fake.emitStdout({ jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } });
    },
  });
  await service.send({ cwd, text: 'x' });
  await waitFor(() => events.some((event) => event.type === 'done'));
  assert.equal(events.filter((event) => event.type === 'error').length, 0);
});

test('未知 id 的响应被忽略，不误结算其它请求', async (t) => {
  const cwd = await tempDir(t, 'dsh-stray-');
  const { service, server, events } = await makeService(t);
  await service.send({ cwd, text: 'x' });
  server.emitStdout({ jsonrpc: '2.0', id: 99999, result: { stopReason: 'end_turn' } });
  await waitFor(() => events.some((event) => event.type === 'done'));
  assert.equal(events.filter((event) => event.type === 'done').length, 1);
});

// ---------------------------------------------------------------------------
// 授权（agent -> client 请求）
// ---------------------------------------------------------------------------

test('session/request_permission 必须被应答，不能挂住 turn', async (t) => {
  const cwd = await tempDir(t, 'dsh-perm-');
  const received = [];
  const { service, server, events } = await makeService(t, {
    promptHandler: (fake, { id, sessionId }) => {
      // 模拟 DSH 在工具执行前发起的授权请求。
      const permissionId = 90001;
      // 先装好观察者，再发出请求，避免应答先于观察者到达。
      const originalWrite = fake.transport.stdin.write;
      fake.transport.stdin.write = (chunk) => {
        const text = String(chunk);
        if (text.includes(`"id":${permissionId}`)) {
          received.push(JSON.parse(text.trim()));
          fake.transport.stdin.write = originalWrite;
          fake.emitStdout({ jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } });
        }
        return true;
      };
      fake.emitStdout({
        jsonrpc: '2.0',
        id: permissionId,
        method: 'session/request_permission',
        params: {
          sessionId,
          toolCall: { toolCallId: 't1', title: 'write_file' },
          options: [
            { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
          ],
        },
      });
    },
  });
  await service.send({ cwd, text: 'x' });
  await waitFor(() => events.some((event) => event.type === 'done'), { label: '授权后完成' });
  assert.equal(received.length, 1, '客户端必须应答授权请求');
  assert.deepEqual(received[0].result, { outcome: { outcome: 'selected', optionId: 'allow-once' } });
  const permissionEvents = events.filter((event) => event.type === 'tool' && event.status === 'permission');
  assert.equal(permissionEvents.length, 1);
  assert.equal(permissionEvents[0].permission, 'allowed');
});

test('permission 策略为 reject 时选择拒绝选项', async (t) => {
  const cwd = await tempDir(t, 'dsh-permreject-');
  const captured = [];
  const { service, events } = await makeService(t, {
    promptHandler: (fake, { id, sessionId }) => {
      const permissionId = 90002;
      const originalWrite = fake.transport.stdin.write;
      fake.transport.stdin.write = (chunk) => {
        const text = String(chunk);
        if (text.includes(`"id":${permissionId}`)) {
          captured.push(JSON.parse(text.trim()));
          fake.transport.stdin.write = originalWrite;
          fake.emitStdout({ jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } });
        }
        return true;
      };
      fake.emitStdout({
        jsonrpc: '2.0',
        id: permissionId,
        method: 'session/request_permission',
        params: {
          sessionId,
          toolCall: { toolCallId: 't1' },
          options: [
            { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
          ],
        },
      });
    },
  }, { permission: 'reject' });
  await service.send({ cwd, text: 'x' });
  await waitFor(() => events.some((event) => event.type === 'done'));
  assert.equal(captured.length, 1);
  assert.deepEqual(captured[0].result, { outcome: { outcome: 'selected', optionId: 'reject-once' } });
});

test('未知的 agent 请求被以 JSON-RPC 错误应答，不静默挂起', async (t) => {
  const captured = [];
  const { service, events } = await makeService(t, {
    promptHandler: (fake, { id, sessionId }) => {
      const unknownId = 90003;
      const originalWrite = fake.transport.stdin.write;
      fake.transport.stdin.write = (chunk) => {
        const text = String(chunk);
        if (text.includes(`"id":${unknownId}`)) {
          captured.push(JSON.parse(text.trim()));
          fake.transport.stdin.write = originalWrite;
          fake.emitStdout({ jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } });
        }
        return true;
      };
      fake.emitStdout({ jsonrpc: '2.0', id: unknownId, method: 'fs/read_text_file', params: { sessionId, path: 'x' } });
    },
  });
  const cwd = await tempDir(t, 'dsh-unknownreq-');
  await service.send({ cwd, text: 'x' });
  await waitFor(() => events.some((event) => event.type === 'done'), { label: '未知请求后完成' });
  assert.equal(captured.length, 1, '未知请求必须被应答');
  assert.equal(captured[0].error.code, -32601);
});

// ---------------------------------------------------------------------------
// prompt 组装（context）
// ---------------------------------------------------------------------------

test('prompt 明确包含已提交作答才用于评估、未提交草稿不得代写', async (t) => {
  const cwd = await tempDir(t, 'dsh-prompt-');
  const { service, server } = await makeService(t);
  await service.send({
    cwd,
    text: '请看我的第一轮作答。',
    context: {
      subject: 'Python',
      lesson: '01-认识变量',
      round: '第一轮',
      documents: [
        { path: '我的学习/学科/Python/01-认识变量/01_学生回答.md', content: '### 问题 1\n**我的回答**\nprice 是变量名', role: 'submitted-answer' },
        { path: '我的学习/学科/Python/01-认识变量/01_教学引导.md', content: '引导正文', role: 'guide' },
      ],
    },
  });
  await waitFor(() => server.callsOf('session/prompt').length === 1);
  const prompt = server.callsOf('session/prompt')[0].params.prompt;
  assert.equal(prompt.length, 1);
  assert.equal(prompt[0].type, 'text');
  const body = prompt[0].text;
  assert.match(body, /已“提交”的作答|已提交的作答|已提交/, '必须写明只有已提交作答才用于评估');
  assert.match(body, /不要替学生写出/, '必须写明不得替学生写答案');
  assert.match(body, /学科 Python/);
  assert.match(body, /课节 01-认识变量/);
  assert.match(body, /当前轮次：第一轮/);
  assert.match(body, /01_学生回答\.md/);
  assert.match(body, /submitted-answer/);
  assert.match(body, /引导正文/);
  assert.match(body, /请看我的第一轮作答。/);
});

test('prompt 在缺少 context 时仍然可用', async (t) => {
  const cwd = await tempDir(t, 'dsh-nocontext-');
  const { service, server } = await makeService(t);
  await service.send({ cwd, text: '只有正文' });
  await waitFor(() => server.callsOf('session/prompt').length === 1);
  const body = server.callsOf('session/prompt')[0].params.prompt[0].text;
  assert.match(body, /只有正文/);
  assert.match(body, /不要替学生写出/);
});

test('超长文档按预算截断，不会无限膨胀 prompt', async (t) => {
  const cwd = await tempDir(t, 'dsh-budget-');
  const { service, server } = await makeService(t);
  const huge = 'x'.repeat(300000);
  await service.send({ cwd, text: 'x', context: { documents: [{ path: 'a.md', content: huge, role: 'draft' }] } });
  await waitFor(() => server.callsOf('session/prompt').length === 1);
  const body = server.callsOf('session/prompt')[0].params.prompt[0].text;
  assert.ok(body.length < 260000, `prompt 应被预算约束，实际长度 ${body.length}`);
});

// ---------------------------------------------------------------------------
// dispose
// ---------------------------------------------------------------------------

test('dispose 取消运行中任务、关闭会话并落盘，且不挂住宿主', async (t) => {
  const cwd = await tempDir(t, 'dsh-dispose-');
  const store = path.join(await tempDir(t, 'dsh-dispose-file-'), 'sessions.json');
  const { service, server, events } = await makeService(t, { neverRespondToPrompt: true }, { storagePath: store });
  await service.send({ cwd, text: '长任务' });
  await waitFor(() => server.callsOf('session/prompt').length === 1);

  await service.dispose();
  assert.equal(server.callsOf('session/cancel').length, 1, 'dispose 应取消在跑任务');
  assert.ok(server.callsOf('session/close').length >= 1, 'dispose 应关闭会话');
  const done = events.filter((event) => event.type === 'done');
  assert.equal(done.length, 1, 'dispose 必须给出 done');
  assert.equal(done[0].cancelled, true);

  // 落盘必须完成且可解析。
  const parsed = JSON.parse(await fs.readFile(store, 'utf8'));
  assert.ok(parsed.sessions);
});

test('dispose 之后 send 被拒绝且不会产生协议流量', async (t) => {
  const cwd = await tempDir(t, 'dsh-disposed-');
  const { service, server } = await makeService(t);
  await service.dispose();
  await assert.rejects(service.send({ cwd, text: 'x' }), /已释放/);
  assert.equal(server.callsOf('session/prompt').length, 0);
});

test('重复 dispose 是安全的', async (t) => {
  const { service } = await makeService(t);
  await service.getStatus();
  await service.dispose();
  await service.dispose();
});

// ---------------------------------------------------------------------------
// 错误可读性
// ---------------------------------------------------------------------------

test('协议错误被转成可读中文描述并保留原始原因', async (t) => {
  const cwd = await tempDir(t, 'dsh-proterr-');
  const { service } = await makeService(t);
  await service.getModels({ cwd });
  await assert.rejects(service.send({ cwd, text: 'x', model: '["nope","nope"]' }), (error) => {
    assert.match(error.message, /DSH 返回错误/);
    assert.match(error.message, /unknown model option/);
    return true;
  });
});

test('stderr 诊断不会出现在 getStatus 的 runtime 字段中', async (t) => {
  const { service, server } = await makeService(t);
  server.emitStderr('token=sk-secret-value-999\n');
  const status = await service.getStatus();
  assert.ok(!/sk-secret-value-999/.test(JSON.stringify(status)));
});

// ---------------------------------------------------------------------------
// 跨运行时（v3 / v4）会话隔离
// ---------------------------------------------------------------------------

test('运行时变更时不假装恢复成功，而是明确告知并新建会话', async (t) => {
  const cwd = await tempDir(t, 'dsh-crossruntime-');
  const store = path.join(await tempDir(t, 'dsh-crossruntime-file-'), 'sessions.json');

  // 运行时 A（模拟 PATH 上的 0.1.6-alpha.1 / session v3）
  const first = await makeService(t, {}, { storagePath: store, runtime: { command: 'node', path: 'C:\\runtime-a\\bin.js', args: [] } });
  const created = await first.service.getModels({ cwd });
  await first.service.dispose();

  // 运行时 B（模拟 Desktop 0.2.0-rc.2 / session v4）：同一 storagePath、不同运行时
  const { service, server, events } = await makeService(t, {}, { storagePath: store, runtime: { command: 'node', path: 'D:\\runtime-b\\bin.js', args: [] } });
  const result = await service.getModels({ cwd });
  assert.equal(server.callsOf('session/resume').length, 0, '不允许把别的运行时的会话拿去 resume');
  assert.equal(server.callsOf('session/new').length, 1, '应为当前运行时新建会话');
  assert.notEqual(result.sessionId, created.sessionId);
  await waitFor(() => events.some((event) => event.type === 'session'));
  const sessionEvent = events.filter((event) => event.type === 'session')[0];
  assert.equal(sessionEvent.restored, false);
  assert.match(sessionEvent.message, /另一个 DSH 运行时/);
});

test('parseDesktopInstallLocations 从注册表文本解析安装目录', () => {
  const sample = [
    '',
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\1bf39983',
    '    DisplayName    REG_SZ    DeepSeek Harness 0.2.0-rc.2',
    '    UninstallString    REG_SZ    "D:\\dsh\\Uninstall DeepSeek Harness.exe" /currentuser',
    '    DisplayIcon    REG_SZ    D:\\dsh\\DeepSeek Harness.exe,0',
    '',
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\d40a3227',
    '    DisplayIcon    REG_SZ    C:\\Users\\x\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Web Applications\\_crx_x\\DeepSeek Harness.ico',
    '    DisplayName    REG_SZ    DeepSeek Harness',
    '',
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\other',
    '    DisplayName    REG_SZ    Some Unrelated App',
    '    InstallLocation    REG_SZ    C:\\Nope',
  ].join('\r\n');

  const dirs = parseDesktopInstallLocations(sample);
  assert.ok(dirs.includes('D:\\dsh'), `应解析出 D:\\dsh，实际 ${JSON.stringify(dirs)}`);
  assert.ok(!dirs.includes('C:\\Nope'), '不得把无关应用算进来');
  // Chrome 的 .ico 快捷方式不应被当作安装目录。
  assert.ok(!dirs.some((dir) => /AppData/.test(dir)), `不得把 Chrome 图标目录算进来：${JSON.stringify(dirs)}`);
  assert.equal(dirs.filter((dir) => dir === 'D:\\dsh').length, 1, '同一目录只出现一次');
});

test('parseDesktopInstallLocations 只认 InstallLocation 的普通形态', () => {
  const sample = [
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\x',
    '    DisplayName    REG_SZ    DeepSeek Harness 1.2.3',
    '    InstallLocation    REG_SZ    E:\\apps\\dsh',
  ].join('\r\n');
  assert.deepEqual(parseDesktopInstallLocations(sample), ['E:\\apps\\dsh']);
});

test('parseDesktopInstallLocations 对空输入与畸形文本安全返回空数组', () => {
  assert.deepEqual(parseDesktopInstallLocations(''), []);
  assert.deepEqual(parseDesktopInstallLocations('garbage\r\nlines only'), []);
  assert.deepEqual(parseDesktopInstallLocations(undefined), []);
});
