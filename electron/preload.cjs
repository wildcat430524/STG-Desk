const {contextBridge,ipcRenderer,webUtils}=require('electron');
const call=name=>(...args)=>ipcRenderer.invoke(name,...args);
contextBridge.exposeInMainWorld('stg',{
  openDialog:call('open-dialog'),openRoot:call('open-root'),openDemo:call('open-demo'),tree:call('tree'),read:call('read'),save:call('save'),
  companion:call('companion'),submit:call('submit'),lastRoot:call('last-root'),dirty:call('dirty'),confirmLeave:call('confirm-leave'),
  external:call('external'),reveal:call('reveal'),exportDraft:call('export-draft'),
  learning:call('learning'),describe:call('describe'),search:call('search'),
  documents:call('documents'),documentContext:call('document-context'),
  dshPrepareReview:call('dsh-review-prompt'),
  dshSession:call('dsh-session'),dshOpenDesktop:call('dsh-open-desktop'),
  dshMinimize:call('dsh-minimize'),
  dshState:call('dsh-state'),dshVisible:call('dsh-visible'),dshMode:call('dsh-mode'),dshPin:call('dsh-pin'),dshDraft:call('dsh-draft'),dshModel:call('dsh-model'),dshConnect:call('dsh-connect'),dshQuote:call('dsh-quote'),dshCancel:call('dsh-cancel'),dshNew:call('dsh-new'),dshSend:call('dsh-send'),
  onDshState:fn=>ipcRenderer.on('dsh-state',(_e,state)=>fn(state)),
  draftGet:call('draft-get'),draftPut:call('draft-put'),draftRemove:call('draft-remove'),draftList:call('draft-list'),
  backups:call('backups'),backupRead:call('backup-read'),backupRestore:call('backup-restore'),preferences:call('preferences'),closeReady:call('close-ready'),
  droppedPath:file=>webUtils.getPathForFile(file),
  onChange:fn=>ipcRenderer.on('workspace-changed',()=>fn()),
  onWarning:fn=>ipcRenderer.on('workspace-warning',(_e,message)=>fn(message)),
  onShortcut:fn=>ipcRenderer.on('shortcut',(_e,name)=>fn(name)),
  onPrepareClose:fn=>ipcRenderer.on('prepare-close',()=>fn())
});
