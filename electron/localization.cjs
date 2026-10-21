'use strict';
// Native-process localization for window titles and OS dialogs.
//
// The renderer never sends user content here: callers pass a key and plain
// parameters (a file name, a document kind). Unknown keys fall back to the
// Chinese source string so a missing entry can never produce an empty dialog.

const fs=require('node:fs/promises');
const path=require('node:path');

const ZH={
  'app.title':'STG Desk · 学习工作台',
  'app.documentWindowTitle':'{kind} · {name}',
  'app.documentKindGuide':'教学文档',
  'app.documentKindAnswer':'学生文档',
  'app.dshWindowTitle':'DSH · 当前会话',
  'dialog.importTitle':'导入 StepsToGreat 文件夹',
  'dialog.exportDraftTitle':'另存草稿',
  'dialog.exportDocumentDraftTitle':'另存文档草稿',
  'dialog.draftDefaultName':'STG-草稿.md',
  'dialog.keepUnsavedTitle':'保留未保存内容',
  'dialog.keepUnsavedMessage':'当前文档或答案还有未保存的修改。',
  'dialog.keepEditing':'继续编辑',
  'dialog.discard':'放弃本次修改',
  'dialog.closeFailed':'未保存内容尚未成功保留，请点击保存后重试。',
  'warning.draftHandoff':'独立窗口的草稿仍保留在本地，交接失败：{error}',  'error.busyWorkspace':'请先停止 DSH 回复，再切换工作区。',
  'error.illegalRequest':'非法请求。',
  'error.illegalTheme':'非法主题请求。',
  'error.illegalDsh':'非法 DSH 请求。',
  'error.illegalDocumentWindow':'非法文档窗口请求。',
  'error.documentWindowScope':'独立窗口仅用于教学引导或学生回答文档。',
  'error.documentWindowClosed':'独立文档窗口已关闭。',
  'error.documentWindowRoot':'独立文档窗口不能切换学习文件夹。',
  'error.documentWindowUnsupported':'独立文档窗口不支持这个操作。',
  'error.unknownWindowMode':'未知窗口模式。',
  'error.messageText':'消息必须是文字。',
  'error.modelBusy':'请等待当前回复结束后切换模型。',
  'error.modelUnavailable':'这个模型当前不可用。',
  'error.sessionBusy':'请等待当前回复结束后切换会话。',
  'error.dshMissing':'未找到 DSH 桌面应用，请先安装或手动打开 DSH。',
  'error.stopFirst':'请先停止当前回复。',
  'error.importFirst':'请先导入学习文件夹。',
  'error.dshBusy':'DSH 正在回复，请稍后再发。',
  'error.messageEmpty':'请先填写消息。',
  'error.connectFirst':'请先打开 DSH 桌面应用并连接。',
  'error.modelStale':'所选模型当前不可用，请重新连接。',
  'dsh.title.default':'DSH 导师',
  'dsh.status.importFirst':'导入学习文件夹后连接',
  'dsh.status.connecting':'正在连接 DSH 桌面端…',
  'dsh.status.connected':'已连接 · DSH 桌面同步',
  'dsh.status.openDesktop':'打开 DSH 桌面应用后连接',
  'dsh.status.thinking':'DSH 正在思考 · 同步中',
  'dsh.status.replying':'DSH 正在回复 · 同步中',
  'dsh.status.working':'DSH 正在处理',
  'dsh.status.usingTool':'正在使用工具',
  'dsh.status.requestFailed':'本次请求失败，请查看连接提示',
  'dsh.status.stopped':'已停止 · DSH',
  'dsh.status.check':'连接需要检查',
  'dsh.status.notSaved':'对话暂未保存：{error}',
  'dsh.error.interrupted':'DSH 连接中断',
  'dsh.error.credentialsHidden':'[已隐藏凭据]',
  'dsh.status.desktopRequired':'请先打开 DSH 桌面应用',
  'dsh.status.sendFailed':'发送失败，请重试。',
  'dsh.reviewPrompt':'本轮作答已保存，请按教学规则评估我的回答。',
};

const EN={
  'app.title':'STG Desk · Learning Workspace',
  'app.documentWindowTitle':'{kind} · {name}',
  'app.documentKindGuide':'Teaching document',
  'app.documentKindAnswer':'Student document',
  'app.dshWindowTitle':'DSH · Current session',
  'dialog.importTitle':'Import a StepsToGreat folder',
  'dialog.exportDraftTitle':'Save draft as',
  'dialog.exportDocumentDraftTitle':'Save document draft as',
  'dialog.draftDefaultName':'STG-draft.md',
  'dialog.keepUnsavedTitle':'Keep unsaved changes',
  'dialog.keepUnsavedMessage':'The current document or answers have unsaved changes.',
  'dialog.keepEditing':'Keep editing',
  'dialog.discard':'Discard these changes',
  'dialog.closeFailed':'Unsaved content could not be kept. Save first, then try again.',
  'warning.draftHandoff':'A detached window draft is still kept locally; handoff failed: {error}',
  'error.busyWorkspace':'Stop the DSH reply before switching workspaces.',
  'error.illegalRequest':'Invalid request.',
  'error.illegalTheme':'Invalid theme request.',
  'error.illegalDsh':'Invalid DSH request.',
  'error.illegalDocumentWindow':'Invalid document window request.',
  'error.documentWindowScope':'Detached windows only open teaching guides or student answers.',
  'error.documentWindowClosed':'The document window was closed.',
  'error.documentWindowRoot':'A detached document window cannot switch learning folders.',
  'error.documentWindowUnsupported':'A detached document window does not support this action.',
  'error.unknownWindowMode':'Unknown window mode.',
  'error.messageText':'A message must be text.',
  'error.modelBusy':'Wait for the current reply to finish before switching models.',
  'error.modelUnavailable':'That model is not available.',
  'error.sessionBusy':'Wait for the current reply to finish before switching sessions.',
  'error.dshMissing':'DSH desktop was not found. Install it or open it manually.',
  'error.stopFirst':'Stop the current reply first.',
  'error.importFirst':'Import a learning folder first.',
  'error.dshBusy':'DSH is replying; send again when it finishes.',
  'error.messageEmpty':'Write a message first.',
  'error.connectFirst':'Open the DSH desktop app and connect first.',
  'error.modelStale':'The selected model is unavailable. Reconnect and choose again.',
  'dsh.title.default':'DSH Tutor',
  'dsh.status.importFirst':'Connect after importing a learning folder',
  'dsh.status.connecting':'Connecting to DSH desktop…',
  'dsh.status.connected':'Connected · DSH desktop sync',
  'dsh.status.openDesktop':'Open the DSH desktop app to connect',
  'dsh.status.thinking':'DSH is thinking · syncing',
  'dsh.status.replying':'DSH is replying · syncing',
  'dsh.status.working':'DSH is working',
  'dsh.status.usingTool':'Using a tool',
  'dsh.status.requestFailed':'This request failed; check the connection notice',
  'dsh.status.stopped':'Stopped · DSH',
  'dsh.status.check':'Connection needs attention',
  'dsh.status.notSaved':'Conversation not saved: {error}',
  'dsh.error.interrupted':'DSH connection interrupted',
  'dsh.error.credentialsHidden':'[credentials hidden]',
  'dsh.status.desktopRequired':'Open the DSH desktop app first',
  'dsh.status.sendFailed':'Sending failed; try again.',
  'dsh.reviewPrompt':'My answer for this round is saved. Evaluate it using the teaching rules.',
};

const TABLES={'zh-CN':ZH,en:EN};
const STORAGE_KEY='stg-app-language';

function normalize(locale){
  return String(locale||'').toLowerCase().startsWith('en')?'en':'zh-CN';
}

function interpolate(template,params){
  if(params==null)return template;
  return String(template).replace(/\{(\w+)\}/g,(all,name)=>Object.hasOwn(params,name)?String(params[name]):all);
}

function translate(locale,key,params){
  const table=TABLES[normalize(locale)];
  const value=table[key]??ZH[key];
  return value==null?key:interpolate(value,params);
}

function readLocale(raw){
  try{const value=JSON.parse(raw||'{}');return normalize(value.language);}catch{return 'zh-CN';}
}

/** Read the persisted UI language from the renderer-compatible storage file. */
async function languageFromSettings(settingsFile){
  try{return readLocale(await fs.readFile(settingsFile,'utf8'));}catch{return 'zh-CN';}
}

module.exports={translate,normalize,readLocale,languageFromSettings,STORAGE_KEY,ZH,EN};
