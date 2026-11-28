'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { WebSocketServer } = require('ws');
const discovery = require('../lib/dsh-discovery.cjs');
const {
  DshDesktopService,
  formatModelLabel,
  extractModelSelection,
  extractSessionTitle,
} = require('../lib/dsh-desktop-service.cjs');
const attachDsh = require('../electron/dsh-controller.cjs');
const localization = require('../electron/localization.cjs');
const { Workspace } = require('../lib/workspace.cjs');

async function makeTempHome(t, secretByte = 9) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'stg-dsh-mv-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const secret = Buffer.alloc(32, secretByte);
  await fs.writeFile(
    path.join(home, '.credentials.yaml'),
    JSON.stringify({
      version: 1,
      records: {
        'client-connection/browser-session': {
          kind: 'grant',
          payload: { version: 1, secret: secret.toString('base64url') },
        },
      },
    }),
  );
  return { home, secret };
}

function verifyDshCookie(cookieHeader, authority, secret) {
  if (typeof cookieHeader !== 'string') return false;
  const expectedName = 'dsh-auth-' + crypto.createHash('sha256').update(authority).digest('base64url');
  const pair = cookieHeader.split(';').map(s => s.trim()).find(s => s.startsWith(expectedName + '='));
  if (!pair) return false;
  const value = pair.slice(expectedName.length + 1);
  const parts = value.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return false;
  const sig = crypto.createHmac('sha256', secret).update(parts[1]).digest('base64url');
  if (sig !== parts[2]) return false;
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  return payload.version === 1 && payload.authority === authority && payload.expiresAt > Date.now();
}

test('DSH discovery helpers parse netstat ports, loopback URLs, install paths, and DSH_HOME', () => {
  assert.equal(discovery.normalizeLoopbackEndpoint('127.0.0.1', 54321), 'http://127.0.0.1:54321');
  assert.equal(discovery.normalizeLoopbackEndpoint('0.0.0.0', 19387), 'http://127.0.0.1:19387');
  assert.equal(discovery.normalizeLoopbackEndpoint('::1', 3080), 'http://[::1]:3080');
  assert.equal(discovery.normalizeLoopbackEndpoint('192.168.1.5', 19387), null);
  assert.equal(discovery.normalizeLoopbackEndpoint('127.0.0.1', 0), null);

  const sampleNetstat = [
    '  TCP    127.0.0.1:52104        0.0.0.0:0              LISTENING       4100',
    '  TCP    127.0.0.1:9999         0.0.0.0:0              LISTENING       9999',
    '  TCP    [::1]:52105            [::]:0                 LISTENING       4100',
    '  TCP    127.0.0.1:52106        127.0.0.1:60000        ESTABLISHED     4100',
  ].join('\r\n');
  assert.deepEqual(
    discovery.parseNetstatListeningPorts(sampleNetstat, new Set([4100])),
    ['http://127.0.0.1:52104', 'http://[::1]:52105'],
  );

  assert.equal(discovery.extractInstallDir('"D:\\dsh\\DeepSeek Harness.exe",0'), 'D:\\dsh');
  assert.equal(discovery.extractInstallDir('"D:\\dsh\\Uninstall DeepSeek Harness.exe" /currentuser'), 'D:\\dsh');
  assert.equal(discovery.extractInstallDir('D:\\dsh'), 'D:\\dsh');
  assert.equal(discovery.resolveDshHome('~/.dsh-custom'), path.join(os.homedir(), '.dsh-custom'));
});

test('DSH 0.2.2+ model badges, projections, and session titles normalize cleanly', () => {
  assert.equal(formatModelLabel({ id: 'ds-v4', name: 'DeepSeek V4', badge: { text: { zh: '推荐', en: 'Recommended' }, tone: 'info' } }), 'DeepSeek V4 · 推荐');
  assert.equal(formatModelLabel({ id: 'ds-v4', name: 'DeepSeek V4 · 2x', badge: { text: '推荐', tone: 'info' } }), 'DeepSeek V4 · 2x');
  assert.equal(formatModelLabel({ id: 'plain-model' }), 'plain-model');

  assert.deepEqual(extractModelSelection({ kind: 'sequenced', values: { modelSelection: { next: { provider: 'p', model: 'm' } } } }), { provider: 'p', model: 'm' });
  assert.deepEqual(extractModelSelection({ kind: 'migration-required', values: {} }, { provider: 'def', model: 'd' }), { provider: 'def', model: 'd' });
  assert.deepEqual(extractModelSelection(null, { provider: 'def', model: 'd' }), { provider: 'def', model: 'd' });
  assert.equal(extractSessionTitle({ projections: { values: { title: 'Python 第一课' } } }), 'Python 第一课');
  assert.equal(extractSessionTitle({ title: '旧版标题' }), '旧版标题');
  assert.equal(extractSessionTitle({}), 'DSH 会话');
});

test('DSH Desktop 0.2.1/0.2.2+ ephemeral port discovery, port rotation, and real HTTP+WS auth', async t => {
  const { home, secret } = await makeTempHome(t, 11);
  const storagePath = path.join(home, 'sessions.json');
  const workspaceDir = path.join(home, 'course');
  await fs.mkdir(workspaceDir, { recursive: true });

  const makeMockDshServer = async (sessionId, title) => {
    let authority = '';
    const rpcLog = [];
    const server = http.createServer(async (req, res) => {
      if (!verifyDshCookie(req.headers.cookie, authority, secret)) {
        res.writeHead(401);
        res.end('unauthorized');
        return;
      }
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      rpcLog.push(body);
      const method = body.method;
      let value;
      if (method === 'session/modelCatalog') {
        value = {
          default: { provider: 'deepseek', model: 'v4-pro', reasoningEffort: 'high' },
          groups: [{
            id: 'deepseek',
            name: 'DeepSeek',
            models: [{
              id: 'v4-pro',
              name: 'DeepSeek V4 Pro',
              badge: { text: { zh: '旗舰', en: 'Flagship' }, tone: 'info' },
              reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' },
            }],
          }],
        };
      } else if (method === 'workspace/create') {
        value = { workspace: { workspaceId: 'ws-1', path: workspaceDir, sessionIds: [sessionId] }, created: false };
      } else if (method === 'session/list') {
        value = {
          items: [{
            sessionId,
            cwd: workspaceDir,
            blank: false,
            running: false,
            updatedAt: Date.now(),
            projections: { values: { title } },
          }],
        };
      } else if (method === 'session/projections') {
        // 0.2.2-rc.5 may return null when projections are absent.
        value = null;
      } else if (method === 'session/prompt') {
        value = { accepted: true };
      } else {
        value = {};
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value } }));
    });
    const wss = new WebSocketServer({ noServer: true });
    server.on('upgrade', (req, socket, head) => {
      if (!verifyDshCookie(req.headers.cookie, authority, secret) || req.url !== '/api/remote.mux') {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, ws => {
        ws.on('message', raw => {
          const msg = JSON.parse(raw.toString('utf8'));
          if (msg.type === 'open' && msg.endpoint === 'session/follow') {
            ws.send(JSON.stringify({
              type: 'item',
              streamId: msg.streamId,
              value: {
                type: 'snapshot',
                records: [{
                  type: 'event',
                  event: { seq: 1, type: 'assistant/message', surfaceOp: 'append', data: { message: { content: [{ type: 'text', text: '来自 0.2.2 随机端口的欢迎消息' }] } } },
                }],
                projections: { values: { title, modelSelection: { next: { provider: 'deepseek', model: 'v4-pro', reasoningEffort: 'high' } } } },
              },
            }));
          }
        });
      });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    authority = `127.0.0.1:${port}`;
    return {
      url: `http://${authority}`,
      rpcLog,
      close: async () => {
        for (const client of wss.clients) client.terminate();
        await new Promise(resolve => wss.close(resolve));
        await new Promise(resolve => server.close(resolve));
      },
    };
  };

  const serverA = await makeMockDshServer('sess-ephemeral-1', 'DSH 0.2.2 学习会话');
  t.after(() => serverA.close());
  let activeEndpoints = ['http://127.0.0.1:1', serverA.url, 'http://127.0.0.1:19387'];
  const updates = [];
  await fs.writeFile(storagePath, JSON.stringify({ [workspaceDir]: { version: 2, sessionId: 'sess-ephemeral-1' } }));

  const service = new DshDesktopService({
    home,
    storagePath,
    running: async () => true,
    discoverEndpoints: async () => activeEndpoints,
    onEvent: e => updates.push(e),
  });
  t.after(() => service.dispose());

  const models = await service.getModels({ cwd: workspaceDir });
  assert.equal(models.endpoint, serverA.url);
  assert.equal(models.sessionId, 'sess-ephemeral-1');
  assert.equal(models.models[0].label, 'DeepSeek V4 Pro · 旗舰');
  assert.equal(updates.at(-1).messages[0].text, '来自 0.2.2 随机端口的欢迎消息');

  // Simulate DSH Desktop restarting on a brand-new ephemeral port.
  const serverB = await makeMockDshServer('sess-ephemeral-1', 'DSH 0.2.2 重启后会话');
  t.after(() => serverB.close());
  await serverA.close();
  activeEndpoints = [serverB.url];

  const sent = await service.send({ cwd: workspaceDir, text: '继续评估' });
  assert.equal(sent.sessionId, 'sess-ephemeral-1');
  assert.equal(service.base, serverB.url);
  assert.ok(serverB.rpcLog.some(call => call.method === 'session/prompt'));
});

test('DSH 0.2.2+ non-blank session attach skips session/create; 0.1.x falls back on list params, missing workspace/create, and cookie-less web', async t => {
  const { home } = await makeTempHome(t, 13);
  const workspaceDir = path.join(home, 'legacy-course');
  await fs.mkdir(workspaceDir, { recursive: true });

  // 1) DSH 0.2.2+ non-blank session not in workspace.sessionIds must not mint a stray blank session.
  const calls22 = [];
  class FakeSocket extends EventEmitter {
    constructor() { super(); queueMicrotask(() => this.emit('open')); }
    send(raw) {
      const msg = JSON.parse(raw);
      queueMicrotask(() => this.emit('message', JSON.stringify({
        type: 'item',
        streamId: msg.streamId,
        value: { type: 'snapshot', records: [], projections: { values: {} } },
      })));
    }
    close() { this.emit('close'); }
  }
  const s22 = new DshDesktopService({
    home,
    running: async () => true,
    WebSocket: FakeSocket,
    fetch: async (_url, init) => {
      const req = JSON.parse(init.body);
      calls22.push(req);
      let value = {};
      if (req.method === 'session/list') {
        value = { items: [{ sessionId: 'existing-nonblank', cwd: workspaceDir, blank: false }] };
      } else if (req.method === 'workspace/create') {
        value = { workspace: { workspaceId: 'ws-22', path: workspaceDir, sessionIds: [] }, created: false };
      } else if (req.method === 'session/projections') {
        value = null;
      }
      return { ok: true, json: async () => ({ type: 'server-response', rpcId: req.rpcId, result: { ok: true, value } }) };
    },
  });
  t.after(() => s22.dispose());
  await s22.selectSession({ cwd: workspaceDir, sessionId: 'existing-nonblank' });
  assert.equal(calls22.some(c => c.method === 'session/create'), false, 'non-blank existing session should not trigger session/create');

  // 2) DSH 0.1.x Web: no .credentials.yaml, session/list expects `request: {}`, workspace/create returns 404.
  const emptyHome = await fs.mkdtemp(path.join(os.tmpdir(), 'stg-dsh-01x-'));
  t.after(() => fs.rm(emptyHome, { recursive: true, force: true }));
  const calls01 = [];
  const s01 = new DshDesktopService({
    home: emptyHome,
    base: 'http://127.0.0.1:3080',
    WebSocket: FakeSocket,
    fetch: async (_url, init) => {
      const req = JSON.parse(init.body);
      calls01.push({ method: req.method, args: req.payload.args, hasCookie: Boolean(init.headers?.cookie) });
      if (req.method === 'session/modelCatalog') {
        return {
          ok: true,
          json: async () => ({
            type: 'server-response',
            rpcId: req.rpcId,
            result: { ok: true, value: { default: { provider: 'p', model: 'm' }, groups: [{ id: 'p', name: 'P', models: [{ id: 'm', name: 'M' }] }] } },
          }),
        };
      }
      if (req.method === 'session/list' && '_request' in req.payload.args) {
        return {
          ok: true,
          json: async () => ({
            type: 'server-response',
            rpcId: req.rpcId,
            result: { ok: false, error: { code: 'gateway/bad-request', message: 'unexpected _request' } },
          }),
        };
      }
      if (req.method === 'session/list') {
        return {
          ok: true,
          json: async () => ({
            type: 'server-response',
            rpcId: req.rpcId,
            result: { ok: true, value: { items: [{ sessionId: 's-01', cwd: workspaceDir }] } },
          }),
        };
      }
      if (req.method === 'workspace/create') {
        return { ok: false, status: 404, json: async () => ({}) };
      }
      if (req.method === 'session/create') {
        assert.equal(req.payload.args.request.cwd, workspaceDir);
        return {
          ok: true,
          json: async () => ({
            type: 'server-response',
            rpcId: req.rpcId,
            result: { ok: true, value: { sessionId: 's-01' } },
          }),
        };
      }
      if (req.method === 'session/projections') {
        return { ok: true, json: async () => ({ type: 'server-response', rpcId: req.rpcId, result: { ok: true, value: null } }) };
      }
      return { ok: true, json: async () => ({ type: 'server-response', rpcId: req.rpcId, result: { ok: true, value: {} } }) };
    },
  });
  t.after(() => s01.dispose());
  const res = await s01.getModels({ cwd: workspaceDir });
  assert.equal(res.sessionId, 's-01');
  assert.equal(calls01.every(c => !c.hasCookie), true);
  assert.ok(calls01.some(c => c.method === 'session/list' && 'request' in c.args));
  assert.ok(calls01.some(c => c.method === 'session/create' && c.args.request.cwd === workspaceDir));
});

test('DSH controller switches language cleanly in both directions and avoids duplicate reconnect on newSession', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stg-dsh-ctrl-i18n-'));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 40 }));
  const workspaceRoot = path.join(root, 'workspace');
  await fs.cp(path.join(__dirname, '../demo/StepsToGreat'), workspaceRoot, { recursive: true });
  const workspace = new Workspace();
  await workspace.open(workspaceRoot);

  let locale = 'zh-CN';
  let getModelsCalls = 0;
  class FakeWindow extends EventEmitter {
    constructor() { super(); this.webContents = { mainFrame: {}, send() {}, setWindowOpenHandler() {}, on() {} }; }
    isDestroyed() { return false; }
  }
  const win = new FakeWindow();
  const handlers = new Map();
  const backend = {
    async getStatus() { return { available: true, statusCode: 'connected' }; },
    async getModels() {
      getModelsCalls += 1;
      return { models: [{ id: 'm1', label: 'M1' }], selectedModel: 'm1', sessionId: 's1', sessions: [{ id: 's1', title: 'S1' }], statusCode: 'connected', message: '已连接 · DSH 桌面同步' };
    },
    async newSession() {
      return { sessionId: 's2', sessions: [{ id: 's1', title: 'S1' }, { id: 's2', title: 'S2' }] };
    },
    async dispose() {},
  };
  const controller = attachDsh({
    app: { getPath: () => root },
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    BrowserWindow: FakeWindow,
    workspace,
    getWindow: () => win,
    smokeTest: true,
    serviceFactory: () => backend,
    translate: (key, params) => localization.translate(locale, key, params),
  });
  t.after(() => controller.dispose());
  const call = (name, ...args) => handlers.get(name)({ sender: win.webContents, senderFrame: win.webContents.mainFrame }, ...args);

  // Switch ZH -> EN -> ZH before connecting (default title must switch back to Chinese!)
  assert.equal(controller.state.title, localization.ZH['dsh.title.default']);
  locale = 'en';
  controller.applyLanguage();
  assert.equal(controller.state.title, localization.EN['dsh.title.default']);
  locale = 'zh-CN';
  controller.applyLanguage();
  assert.equal(controller.state.title, localization.ZH['dsh.title.default']);

  // Connect in English: localized status must NOT be overwritten by Chinese service message.
  await controller.onWorkspaceOpened(workspace.root);
  locale = 'en';
  controller.applyLanguage();
  await call('dsh-connect');
  assert.equal(controller.state.status, localization.EN['dsh.status.connected']);
  assert.equal(getModelsCalls, 1);

  // New session updates sessions directly without triggering another getModels reconnect.
  await call('dsh-new');
  assert.equal(controller.state.sessionId, 's2');
  assert.equal(controller.state.sessions.length, 2);
  assert.equal(getModelsCalls, 1);

  // Switch back EN -> ZH while connected: connected status translates cleanly.
  locale = 'zh-CN';
  controller.applyLanguage();
  assert.equal(controller.state.status, localization.ZH['dsh.status.connected']);
});
