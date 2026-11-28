'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const yaml = require('js-yaml');
const WebSocket = require('ws');
const discovery = require('./dsh-discovery.cjs');
const { atomicRename } = require('./settings-store.cjs');

const COOKIE_TTL_MS = 3600000;
const COOKIE_REFRESH_MARGIN_MS = 300000;
const RPC_TIMEOUT_MS = 15000;
const PROBE_TIMEOUT_MS = 3500;
const FOLLOW_TIMEOUT_MS = 15000;
const HEALTH_INTERVAL_MS = 12000;
const DESKTOP_DOCUMENT_BUDGET_CHARS = 120000;

const modelId = s => (s && s.provider && s.model ? JSON.stringify([s.provider, s.model]) : null);

const docFingerprint = d => crypto.createHash('sha256')
  .update(`${d.role || ''}\0${d.access || ''}\0${d.content || ''}`)
  .digest('hex');

function buildDesktopContext(documents, sentMap) {
  if (!documents.length) return { block: '', nextHashes: new Map() };
  const changedLines = [];
  const unchangedPaths = [];
  const nextHashes = new Map();
  let budget = DESKTOP_DOCUMENT_BUDGET_CHARS;
  for (const d of documents) {
    if (!d || typeof d.path !== 'string' || typeof d.content !== 'string') continue;
    const hash = docFingerprint(d);
    if (sentMap?.get(d.path) === hash) {
      unchangedPaths.push(d.path);
      nextHashes.set(d.path, hash);
      continue;
    }
    if (budget <= 0) {
      changedLines.push(`\n文档：${d.path} (${d.role}, ${d.access}) [超出本轮字符预算，请按需读取本地文件]`);
      continue;
    }
    let content = d.content;
    let truncated = false;
    if (content.length > budget) {
      content = `${content.slice(0, Math.max(0, budget))}\n…（内容过长已截断，需要完整内容请直接读取本地文件）`;
      truncated = true;
    }
    budget -= content.length;
    changedLines.push(`\n文档：${d.path} (${d.role}, ${d.access})\n${content}`);
    if (!truncated) nextHashes.set(d.path, hash);
  }
  const lines = ['<STG学习上下文>'];
  if (!changedLines.length && unchangedPaths.length) {
    lines.push(`以下课程文档内容与本会话前文一致，未重复附带（需核对时直读本地文件）：${unchangedPaths.join('、')}`);
  } else {
    lines.push('以下为已保存、与当前课程相关的文档；学生作答仅使用已提交内容。');
    if (unchangedPaths.length) {
      lines.push(`其余未变更文档（内容与本会话前文一致，未重复附带）：${unchangedPaths.join('、')}`);
    }
    lines.push(...changedLines);
  }
  lines.push('</STG学习上下文>');
  return { block: lines.join('\n'), nextHashes };
}

function workspaceCwd(cwd) {
  if (typeof cwd !== 'string' || !cwd.trim() || !path.isAbsolute(cwd)) {
    throw new Error('请提供学习文件夹的绝对路径。');
  }
  return path.resolve(cwd);
}

const sameCwd = (a, b) => (
  typeof a === 'string'
  && path.isAbsolute(a)
  && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
);

function localUrl(value) {
  const u = new URL(value || `http://127.0.0.1:${discovery.LEGACY_DESKTOP_PORT}`);
  if (
    u.protocol !== 'http:'
    || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)
    || u.username
    || u.password
    || u.search
    || u.hash
  ) {
    throw new Error('DSH 桌面连接地址必须是本机 HTTP 地址。');
  }
  return u.origin;
}

function localizedBadgeText(badge) {
  if (!badge) return '';
  const text = typeof badge === 'string' ? badge : badge.text;
  if (typeof text === 'string') return text.trim();
  if (text && typeof text === 'object') {
    const picked = text['zh-cn'] || text.zh || text.en || Object.values(text).find(v => typeof v === 'string' && v.trim());
    return typeof picked === 'string' ? picked.trim() : '';
  }
  return '';
}

function formatModelLabel(model) {
  const base = String(model?.name || model?.id || '').trim();
  const badge = localizedBadgeText(model?.badge);
  if (badge && !base.includes('·')) return `${base} · ${badge}`;
  return base;
}

function extractModelSelection(projections, fallback = null) {
  const ms = projections?.values?.modelSelection;
  if (ms?.next?.provider && ms?.next?.model) return ms.next;
  if (ms?.current?.provider && ms?.current?.model) return ms.current;
  if (ms?.provider && ms?.model) return ms;
  return fallback;
}

function extractSessionTitle(summary) {
  const title = summary?.projections?.values?.title || summary?.title;
  return typeof title === 'string' && title.trim() ? title.trim() : 'DSH 会话';
}

function parseCredentialsSecret(raw) {
  const document = yaml.load(raw);
  const record = document?.records?.['client-connection/browser-session'];
  if (record?.kind !== 'grant' || record.payload?.version !== 1 || typeof record.payload.secret !== 'string') {
    throw Object.assign(new Error('DSH 尚未建立桌面连接授权，请先打开 DSH。'), { code: 'DSH_GRANT_MISSING' });
  }
  const secret = Buffer.from(record.payload.secret, 'base64url');
  if (secret.length !== 32) {
    throw Object.assign(new Error('DSH 桌面连接授权格式不兼容。'), { code: 'DSH_GRANT_INVALID' });
  }
  return secret;
}

function signCookie(base, secret, ttlMs = COOKIE_TTL_MS) {
  const authority = new URL(base).host;
  const issuedAt = Date.now();
  const expiresAt = issuedAt + ttlMs;
  const body = Buffer.from(JSON.stringify({ version: 1, authority, issuedAt, expiresAt })).toString('base64url');
  const name = 'dsh-auth-' + crypto.createHash('sha256').update(authority).digest('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return { cookie: `${name}=v1.${body}.${sig}`, expiresAt };
}

// Reuse the local user's Desktop browser grant. Never export, log or persist it.
async function desktopCookie(base, home, options = {}) {
  const resolvedHome = discovery.resolveDshHome(home);
  let raw;
  try {
    raw = await fs.readFile(path.join(resolvedHome, '.credentials.yaml'), 'utf8');
  } catch {
    throw Object.assign(new Error('无法读取 DSH 桌面连接授权，请先打开 DSH。'), { code: 'DSH_CREDENTIALS_UNREADABLE' });
  }
  const secret = parseCredentialsSecret(raw);
  return signCookie(base, secret, options.ttlMs).cookie;
}

async function desktopRunning() {
  const state = await discovery.discoverDesktopProcessState();
  return state.running;
}

function isReplacementSurfaceOp(surfaceOp) {
  return Boolean(
    surfaceOp
    && typeof surfaceOp === 'object'
    && (surfaceOp.kind === 'replace' || surfaceOp.op === 'replace'),
  );
}

function messagesFromEvents(events) {
  const visible = [];
  for (const e of events) {
    if (!['user/message', 'assistant/message'].includes(e.type) || e.surfaceOp === undefined) continue;
    if (e.surfaceOp !== 'append') continue;
    const data = e.data?.message || e.data;
    const content = Array.isArray(data?.content) ? data.content : [];
    const text = content
      .filter(b => b && b.type === 'text' && typeof b.text === 'string')
      .map(b => b.text)
      .join('\n\n')
      .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
      .replace(/\n\n<STG学习上下文>[\s\S]*<\/STG学习上下文>\s*$/, '')
      .trim();
    if (text) {
      visible.push({
        seq: e.seq,
        id: 'dsh:' + e.seq,
        role: e.type === 'user/message' ? 'user' : 'assistant',
        text,
      });
    }
  }
  return visible;
}

function extractStreamText(records) {
  return (records || []).map(r => {
    if (!r || typeof r !== 'object') return '';
    if (r.type === 'text-chunks' && Array.isArray(r.texts)) return r.texts.join('');
    if (r.type === 'chunk' && r.chunk?.type === 'text-delta' && typeof r.chunk.text === 'string') return r.chunk.text;
    if (r.type === 'text-delta' && typeof r.text === 'string') return r.text;
    return '';
  }).join('');
}

function isUnknownMethodError(error) {
  if (!error) return false;
  if (error.httpStatus === 404) return true;
  const code = String(error.code || '').toLowerCase();
  if (code.includes('unknown-method') || (code.includes('not-found') && code.startsWith('gateway/'))) return true;
  return /unknown method|method not found|not found/i.test(String(error.message || '')) && !/workspace|session/i.test(String(error.message || ''));
}

function isBadRequestError(error) {
  if (!error) return false;
  return String(error.code || '') === 'gateway/bad-request' || error.httpStatus === 400;
}

class DshDesktopService {
  constructor(options = {}) {
    this.onEvent = options.onEvent || (() => {});
    this.storagePath = options.storagePath;
    this.home = discovery.resolveDshHome(options.home);
    const configuredBase = options.base || process.env.STG_DSH_DESKTOP_URL;
    this.explicitBase = configuredBase ? localUrl(configuredBase) : null;
    this.base = this.explicitBase || localUrl();
    this.verifiedBase = null;
    this.customRunning = typeof options.running === 'function' ? options.running : null;
    this.running = this.customRunning || desktopRunning;
    this.discoverEndpoints = typeof options.discoverEndpoints === 'function' ? options.discoverEndpoints : null;
    this.customFetch = typeof options.fetch === 'function';
    this.fetch = options.fetch || globalThis.fetch;
    this.WebSocket = options.WebSocket || WebSocket;
    this.sessions = new Map();
    this.sentDocuments = new Map();
    this.events = [];
    this.disposed = false;
    this.cookie = null;
    this.cookieExpiresAt = 0;
    this.authMode = 'cookie';
    this.supportsWorkspace = true;
    this.listArgsShape = '_request';
    this.probedCatalog = null;
    this.probedCatalogAt = 0;
    this.healthChecking = false;
    this.restored = this.restore();
  }

  emit(event) {
    if (!this.disposed) this.onEvent({ ...event, cwd: this.cwd });
  }

  async restore() {
    if (!this.storagePath) return;
    try {
      const d = JSON.parse(await fs.readFile(this.storagePath, 'utf8'));
      for (const [cwd, record] of Object.entries(d)) {
        if (record?.version === 2 && typeof record.sessionId === 'string') {
          this.sessions.set(cwd, record);
        }
      }
    } catch {}
  }

  async persist() {
    if (!this.storagePath) return;
    await fs.mkdir(path.dirname(this.storagePath), { recursive: true });
    const tmp = `${this.storagePath}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, JSON.stringify(Object.fromEntries(this.sessions)));
      await atomicRename(tmp, this.storagePath);
    } finally {
      await fs.unlink(tmp).catch(() => {});
    }
  }

  async _tryBuildCookie(base) {
    try {
      const resolvedHome = discovery.resolveDshHome(this.home);
      let raw;
      try {
        raw = await fs.readFile(path.join(resolvedHome, '.credentials.yaml'), 'utf8');
      } catch {
        throw Object.assign(new Error('无法读取 DSH 桌面连接授权，请先打开 DSH。'), { code: 'DSH_CREDENTIALS_UNREADABLE' });
      }
      const secret = parseCredentialsSecret(raw);
      return { ...signCookie(base, secret), error: null };
    } catch (error) {
      return { cookie: null, expiresAt: 0, error };
    }
  }

  async _candidateEndpoints({ forceRediscover = false } = {}) {
    const candidates = [];
    const push = raw => {
      if (!raw) return;
      try {
        const origin = localUrl(raw);
        if (!candidates.includes(origin)) candidates.push(origin);
      } catch {}
    };

    if (this.explicitBase) {
      push(this.explicitBase);
      return { candidates, multi: false };
    }

    if (this.discoverEndpoints) {
      if (this.customRunning && !(await this.customRunning())) {
        throw new Error('DSH 未打开，请打开 DSH 桌面应用后连接。');
      }
      if (!forceRediscover && this.verifiedBase) push(this.verifiedBase);
      const discovered = await this.discoverEndpoints();
      for (const ep of Array.isArray(discovered) ? discovered : []) push(ep);
      if (candidates.length === 0) push(this.base);
      return { candidates, multi: candidates.length > 1 || forceRediscover };
    }

    if (this.customRunning) {
      if (!(await this.customRunning())) {
        throw new Error('DSH 未打开，请打开 DSH 桌面应用后连接。');
      }
      push(this.verifiedBase || this.base);
      return { candidates, multi: false };
    }

    if (this.customFetch) {
      push(this.verifiedBase || this.base);
      return { candidates, multi: false };
    }

    const state = await discovery.discoverDesktopProcessState();
    if (!state.running) {
      throw new Error('DSH 未打开，请打开 DSH 桌面应用后连接。');
    }
    if (!forceRediscover && this.verifiedBase && state.endpoints.includes(this.verifiedBase)) {
      push(this.verifiedBase);
    }
    for (const ep of state.endpoints) push(ep);
    if (candidates.length === 0) push(this.base);
    return { candidates, multi: true };
  }

  async _probeEndpoint(base) {
    const built = await this._tryBuildCookie(base);
    const attempts = built.cookie
      ? [{ cookie: built.cookie, expiresAt: built.expiresAt, mode: 'cookie' }]
      : [{ cookie: null, expiresAt: 0, mode: 'loopback' }];

    let lastError = built.error;
    for (const attempt of attempts) {
      const headers = { 'content-type': 'application/json' };
      if (attempt.cookie) headers.cookie = attempt.cookie;
      let response;
      try {
        response = await this.fetch(`${base}/api/session/modelCatalog`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            type: 'client-request',
            rpcId: crypto.randomUUID(),
            method: 'session/modelCatalog',
            payload: { args: {} },
          }),
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
      } catch {
        continue;
      }
      if (response.status === 401) {
        lastError = built.error || new Error('DSH 连接授权已失效，请重新连接。');
        continue;
      }
      if (!response.ok) {
        lastError = new Error('DSH 桌面接口暂时不可用。');
        continue;
      }
      let data;
      try {
        data = await response.json();
      } catch {
        continue;
      }
      if (data?.result?.ok) {
        return {
          ok: true,
          base,
          cookie: attempt.cookie,
          expiresAt: attempt.expiresAt,
          mode: attempt.mode,
          catalog: data.result.value,
        };
      }
      if (data?.result?.error?.message) {
        lastError = new Error(data.result.error.message);
      }
    }
    return { ok: false, error: lastError };
  }

  async auth({ forceRediscover = false } = {}) {
    const { candidates, multi } = await this._candidateEndpoints({ forceRediscover });

    if (!multi && candidates.length === 1) {
      const target = candidates[0];
      const built = await this._tryBuildCookie(target);
      if (built.cookie) {
        this.base = target;
        this.verifiedBase = target;
        this.cookie = built.cookie;
        this.cookieExpiresAt = built.expiresAt;
        this.authMode = 'cookie';
        return;
      }
      if (this.explicitBase) {
        const probe = await this._probeEndpoint(target);
        if (probe.ok) {
          this.base = probe.base;
          this.verifiedBase = probe.base;
          this.cookie = probe.cookie;
          this.cookieExpiresAt = probe.expiresAt;
          this.authMode = probe.mode;
          this.probedCatalog = probe.catalog;
          this.probedCatalogAt = Date.now();
          return;
        }
      }
      throw built.error || new Error('无法读取 DSH 桌面连接授权，请先打开 DSH。');
    }

    let lastError = null;
    for (const candidate of candidates) {
      const probe = await this._probeEndpoint(candidate);
      if (probe.ok) {
        this.base = probe.base;
        this.verifiedBase = probe.base;
        this.cookie = probe.cookie;
        this.cookieExpiresAt = probe.expiresAt;
        this.authMode = probe.mode;
        this.probedCatalog = probe.catalog;
        this.probedCatalogAt = Date.now();
        return;
      }
      if (probe.error) lastError = probe.error;
    }

    if (lastError) throw lastError;
    throw new Error('无法连接 DSH 桌面端，请确认 DSH 已打开。');
  }

  async _ensureFreshCookie() {
    if (!this.verifiedBase) {
      await this.auth();
      return;
    }
    if (this.authMode === 'cookie' && (!this.cookie || Date.now() > this.cookieExpiresAt - COOKIE_REFRESH_MARGIN_MS)) {
      const built = await this._tryBuildCookie(this.base);
      if (built.cookie) {
        this.cookie = built.cookie;
        this.cookieExpiresAt = built.expiresAt;
      } else {
        await this.auth({ forceRediscover: true });
      }
    }
  }

  async rpc(method, args = {}, { retried = false } = {}) {
    await this._ensureFreshCookie();
    const headers = { 'content-type': 'application/json' };
    if (this.cookie) headers.cookie = this.cookie;

    let response;
    try {
      response = await this.fetch(`${this.base}/api/${method}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: 'client-request',
          rpcId: crypto.randomUUID(),
          method,
          payload: { args },
        }),
        signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
      });
    } catch {
      if (!retried) {
        this.cookie = null;
        this.verifiedBase = null;
        await this.auth({ forceRediscover: true });
        return this.rpc(method, args, { retried: true });
      }
      throw new Error('无法连接 DSH 桌面端，请确认 DSH 已打开。');
    }

    if (!response.ok) {
      if ((response.status === 401 || response.status === 503) && !retried) {
        this.cookie = null;
        this.verifiedBase = null;
        await this.auth({ forceRediscover: true });
        return this.rpc(method, args, { retried: true });
      }
      this.cookie = null;
      const err = new Error(
        response.status === 401
          ? 'DSH 连接授权已失效，请重新连接。'
          : 'DSH 桌面接口暂时不可用。',
      );
      err.httpStatus = response.status;
      throw err;
    }

    const data = await response.json();
    if (!data.result?.ok) {
      const err = new Error(data.result?.error?.message || 'DSH 桌面请求失败');
      err.code = data.result?.error?.code;
      err.details = data.result?.error?.details;
      throw err;
    }
    return data.result.value;
  }

  async _fetchCatalog() {
    if (this.probedCatalog && Date.now() - this.probedCatalogAt < 2500) {
      const cached = this.probedCatalog;
      this.probedCatalog = null;
      return cached;
    }
    return this.rpc('session/modelCatalog');
  }

  async getStatus() {
    try {
      await this.auth();
      await this._fetchCatalog();
      return { available: true, statusCode: 'connected', endpoint: this.base, message: '已连接 · DSH 桌面同步' };
    } catch (e) {
      return { available: false, message: e.message };
    }
  }

  async learningWorkspace(cwd) {
    const resolved = workspaceCwd(cwd);
    if (!this.supportsWorkspace) return null;
    let result;
    try {
      result = await this.rpc('workspace/create', { request: { path: resolved } });
    } catch (error) {
      if (isUnknownMethodError(error)) {
        this.supportsWorkspace = false;
        return null;
      }
      throw error;
    }
    const workspace = result?.workspace;
    if (!workspace?.workspaceId || !sameCwd(workspace.path, resolved)) {
      throw new Error('DSH 工作区路径与当前学习文件夹不一致。');
    }
    return workspace;
  }

  async createLearningSession(cwd) {
    const resolved = workspaceCwd(cwd);
    const workspace = await this.learningWorkspace(resolved);
    if (workspace) {
      return this.rpc('session/create', { request: { workspaceId: workspace.workspaceId } });
    }
    return this.rpc('session/create', { request: { cwd: resolved } });
  }

  async listSessions({ cwd }) {
    cwd = workspaceCwd(cwd);
    const shapes = [this.listArgsShape, '_request', 'request', 'empty']
      .filter((shape, index, list) => list.indexOf(shape) === index);
    let data = null;
    let lastError = null;
    for (const shape of shapes) {
      const args = shape === '_request' ? { _request: {} } : shape === 'request' ? { request: {} } : {};
      try {
        data = await this.rpc('session/list', args);
        this.listArgsShape = shape;
        break;
      } catch (error) {
        lastError = error;
        if (!isBadRequestError(error)) throw error;
      }
    }
    if (!data) throw lastError || new Error('DSH 桌面请求失败');
    const items = Array.isArray(data.items) ? data.items : [];
    return items
      .filter(s => s && !s.parentSessionId && s.origin !== 'subagent' && sameCwd(s.cwd, cwd))
      .map(s => ({
        id: s.sessionId,
        title: extractSessionTitle(s),
        running: Boolean(s.running),
        blank: s.blank,
        updatedAt: s.updatedAt,
      }));
  }

  async getModels({ cwd }) {
    cwd = workspaceCwd(cwd);
    await this.restored;
    await this.auth();
    const [catalog, sessions] = await Promise.all([this._fetchCatalog(), this.listSessions({ cwd })]);
    const groups = Array.isArray(catalog?.groups) ? catalog.groups : [];
    this.models = groups.flatMap(g => (Array.isArray(g.models) ? g.models : []).map(m => ({
      id: modelId({ provider: g.id, model: m.id }),
      label: formatModelLabel(m),
      provider: g.name || g.id,
      providerId: g.id,
      modelId: m.id,
      reasoning: m.reasoning,
      badge: localizedBadgeText(m.badge) || null,
    })));
    this.defaultSelection = catalog?.default || null;
    // Only restore a dedicated or explicitly selected learning conversation. Legacy
    // bindings may have silently adopted an unrelated project task in the same cwd.
    let id = [...this.sessions].find(([root]) => sameCwd(root, cwd))?.[1]?.sessionId;
    if (!sessions.some(s => s.id === id)) id = null;
    if (!id) {
      const created = await this.createLearningSession(cwd);
      id = created.sessionId;
    }
    await this.attach(cwd, id);
    return {
      models: this.models,
      selectedModel: modelId(this.selection || this.defaultSelection),
      sessionId: id,
      sessions: await this.listSessions({ cwd }),
      endpoint: this.base,
      statusCode: 'connected',
      message: '已连接 · DSH 桌面同步',
    };
  }

  async attach(cwd, id) {
    cwd = workspaceCwd(cwd);
    const sessions = await this.listSessions({ cwd });
    const targetSession = sessions.find(s => s.id === id);
    if (!targetSession) throw new Error('请选择当前学习文件夹的 DSH 会话。');
    const workspace = await this.learningWorkspace(cwd);
    // On DSH 0.2.2+, `session/create({ workspaceId, sessionId })` only reuses blank
    // unarchived sessions and mints an extra blank session for non-blank history.
    if (workspace && !workspace.sessionIds.includes(id) && targetSession.blank !== false) {
      await this.rpc('session/create', { request: { workspaceId: workspace.workspaceId, sessionId: id } });
    }
    const previous = this.socket;
    this.socket = null;
    previous?.close();
    this.partial = null;
    this.cwd = cwd;
    this.id = id;
    let projections = null;
    try {
      projections = await this.rpc('session/projections', { request: { sessionId: id } });
    } catch {
      projections = null;
    }
    this.events = [];
    this.selection = extractModelSelection(projections, this.defaultSelection);
    await this.follow(id);
    this.sessions.set(cwd, { version: 2, sessionId: id });
    await this.persist();
    clearInterval(this.health);
    this.health = setInterval(() => this.checkHealth().catch(() => {}), HEALTH_INTERVAL_MS);
    this.health.unref?.();
  }

  async checkHealth() {
    if (this.disposed || this.healthChecking) return;
    this.healthChecking = true;
    try {
      const wsOpen = this.socket && this.socket.readyState === WebSocket.OPEN;
      if (!this.customRunning && wsOpen) return;
      if (!(await this.running())) {
        const socket = this.socket;
        this.socket = null;
        socket?.close();
        this.verifiedBase = null;
        this.cookie = null;
        this.emit({
          type: 'sync',
          connected: false,
          busy: false,
          statusCode: 'closed',
          status: 'DSH 已关闭，打开后重新连接',
        });
        clearInterval(this.health);
      }
    } finally {
      this.healthChecking = false;
    }
  }

  follow(id) {
    return new Promise((resolve, reject) => {
      const headers = {};
      if (this.cookie) headers.cookie = this.cookie;
      const socket = new this.WebSocket(this.base.replace(/^http/, 'ws') + '/api/remote.mux', { headers });
      this.socket = socket;
      const streamId = crypto.randomUUID();
      let opened = false;
      let settled = false;
      const finish = (ok, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (ok) resolve(value);
        else reject(value);
      };
      const timer = setTimeout(() => {
        if (this.socket === socket) {
          this.socket = null;
          socket.close?.();
        }
        finish(false, new Error('DSH 实时会话同步超时，请重新连接'));
      }, FOLLOW_TIMEOUT_MS);
      timer.unref?.();

      socket.on('open', () => {
        opened = true;
        socket.send(JSON.stringify({
          type: 'open',
          streamId,
          endpoint: 'session/follow',
          payload: {
            args: {
              request: {
                address: { kind: 'session', sessionId: id },
                assistantStream: true,
                maxMessages: Number.MAX_SAFE_INTEGER,
              },
            },
          },
        }));
      });

      socket.on('message', bytes => {
        if (this.socket !== socket) return;
        try {
          const text = typeof bytes === 'string' ? bytes : Buffer.from(bytes).toString('utf8');
          const envelope = JSON.parse(text);
          if (envelope.type === 'error') {
            const msg = envelope.error?.message || 'DSH 同步失败';
            this.emit({ type: 'sync', connected: false, busy: false, status: msg });
            finish(false, new Error(msg));
            return;
          }
          if (envelope.type === 'item') {
            this.accept(envelope.value);
            if (envelope.value?.type === 'snapshot') finish(true);
          }
        } catch (e) {
          this.emit({ type: 'error', message: 'DSH 同步数据无法解析：' + e.message });
        }
      });

      socket.on('error', () => {
        if (!opened || !settled) finish(false, new Error('DSH 实时会话连接失败'));
      });

      socket.on('close', () => {
        if (!opened || !settled) finish(false, new Error('DSH 实时会话连接失败'));
        if (this.socket === socket && !this.disposed) {
          this.socket = null;
          this.verifiedBase = null;
          this.cookie = null;
          clearInterval(this.health);
          this.emit({
            type: 'sync',
            connected: false,
            busy: false,
            statusCode: 'disconnected',
            status: 'DSH 连接已断开，请重新连接',
          });
        }
      });
    });
  }

  accept(value) {
    if (value?.type === 'snapshot') {
      this.events = (value.records || []).map(r => r.event || r).filter(r => typeof r.seq === 'number');
      this.selection = extractModelSelection(value.projections)
        || this.events.findLast(e => e.type === 'model/selection')?.data
        || this.events.findLast(e => e.type === 'request/header')?.data?.header?.config
        || this.selection;
      const attempt = value.assistantStream?.activeAttempt;
      this.partial = attempt
        ? { id: 'live:' + attempt.attemptId, role: 'assistant', attemptId: attempt.attemptId, text: extractStreamText(attempt.stream) }
        : null;
      this.emit({
        type: 'sync',
        sessionId: this.id,
        messages: [...messagesFromEvents(this.events), ...(this.partial?.text ? [this.partial] : [])],
        model: modelId(this.selection),
        title: value.projections?.values?.title,
        busy: !!attempt || this.events.findLast(e => ['turn/start', 'turn/end'].includes(e.type))?.type === 'turn/start',
        connected: true,
      });
      return;
    }

    if (value?.type === 'assistant-stream') {
      const f = value.frame;
      if (!f) return;
      if (f.type === 'start') {
        this.partial = { id: 'live:' + f.attemptId, role: 'assistant', text: '', attemptId: f.attemptId };
      } else if (f.type === 'chunk' && this.partial?.attemptId === f.attemptId && f.chunk?.type === 'text-delta' && typeof f.chunk.text === 'string') {
        this.partial.text += f.chunk.text;
      } else if (f.type === 'end') {
        this.partial = null;
      }
      if (this.partial?.text) {
        this.emit({
          type: 'sync',
          messages: [...messagesFromEvents(this.events), this.partial],
          busy: true,
          connected: true,
        });
      }
      return;
    }

    const event = value?.event || value?.record?.event || value?.record;
    if (event?.type) {
      if (typeof event.seq === 'number' && !this.events.some(e => e.seq === event.seq)) {
        this.events.push(event);
      }
      if (isReplacementSurfaceOp(event.surfaceOp) && this.id) {
        this.sentDocuments.delete(this.id);
      }
      if (event.type === 'model/selection') this.selection = event.data;
      if (['assistant/message', 'turn/end'].includes(event.type)) this.partial = null;
      if (['user/message', 'assistant/message', 'model/selection', 'session/title', 'turn/start', 'turn/end'].includes(event.type)) {
        this.emit({
          type: 'sync',
          messages: [...messagesFromEvents(this.events), ...(this.partial?.text ? [this.partial] : [])],
          model: modelId(this.selection),
          title: event.type === 'session/title' ? event.data?.title : undefined,
          busy: this.events.findLast(e => ['turn/start', 'turn/end'].includes(e.type))?.type === 'turn/start',
          connected: true,
        });
      }
    }
  }

  async selectModel({ cwd, model }) {
    if (!this.models?.some(m => m.id === model)) throw new Error('这个模型当前不可用');
    if (this.cwd !== cwd) await this.getModels({ cwd });
    if (modelId(this.selection) === model) return;
    const [provider, selected] = JSON.parse(model);
    const m = this.models.find(item => item.id === model);
    const effort = this.selection?.reasoningEffort;
    const reasoningEffort = m.reasoning?.efforts?.some(e => e.id === effort) ? effort : m.reasoning?.defaultEffort;
    const result = await this.rpc('session/selectModel', {
      request: {
        sessionId: this.id,
        provider,
        model: selected,
        ...(reasoningEffort ? { reasoningEffort } : {}),
      },
    });
    this.selection = result.selected;
    this.emit({ type: 'sync', model: modelId(this.selection), connected: true });
  }

  async send({ cwd, text, model, context }) {
    cwd = workspaceCwd(cwd);
    await this.auth();
    if (this.cwd !== cwd || !this.id) await this.getModels({ cwd });
    if (!(await this.listSessions({ cwd })).some(s => s.id === this.id)) {
      throw new Error('当前 DSH 会话已不属于学习文件夹，请重新连接。');
    }
    if (model) await this.selectModel({ cwd, model });
    const requestId = crypto.randomUUID();
    const documents = context?.documents || [];
    const sentMap = this.sentDocuments.get(this.id);
    const { block, nextHashes } = buildDesktopContext(documents, sentMap);
    const prompt = block ? `${text}\n\n${block}` : text;
    await this.rpc('session/prompt', {
      request: {
        sessionId: this.id,
        requestId,
        mode: 'queue',
        content: [{ type: 'text', text: prompt }],
        clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    });
    if (nextHashes.size) {
      const merged = new Map(sentMap || []);
      for (const [k, v] of nextHashes) merged.set(k, v);
      this.sentDocuments.set(this.id, merged);
    }
    return { sessionId: this.id, requestId };
  }

  async cancel() {
    if (!this.id) return;
    await this.rpc('session/cancel', { request: { sessionId: this.id } });
  }

  async selectSession({ cwd, sessionId }) {
    const list = await this.listSessions({ cwd });
    if (!list.some(s => s.id === sessionId)) throw new Error('请选择当前学习文件夹的 DSH 会话。');
    await this.attach(cwd, sessionId);
  }

  async newSession({ cwd }) {
    cwd = workspaceCwd(cwd);
    await this.restored;
    await this.auth();
    const result = await this.createLearningSession(cwd);
    await this.attach(cwd, result.sessionId);
    return { ...result, sessions: await this.listSessions({ cwd }) };
  }

  async dispose() {
    this.disposed = true;
    clearInterval(this.health);
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.cookie = null;
    this.verifiedBase = null;
  }
}

module.exports = {
  DshDesktopService,
  desktopCookie,
  localUrl,
  messagesFromEvents,
  modelId,
  buildDesktopContext,
  formatModelLabel,
  extractModelSelection,
  extractSessionTitle,
  parseCredentialsSecret,
};
