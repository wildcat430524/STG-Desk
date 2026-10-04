const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { appendAnswers, parseQuestions } = require('./stg.cjs');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const IGNORE = new Set(['node_modules', '.git', '.stg-desk', '.dsh', 'vendor', 'release']);
const isMarkdown = p => /\.(md|markdown|txt)$/i.test(p);
class Workspace {
  constructor() { this.writes=new Map(); this.retention=20; }
  async open(root) {
    const real = await fs.realpath(root);
    if (!(await fs.stat(real)).isDirectory()) throw new Error('请导入文件夹，而不是单个文件。');
    this.root = real;
    return this.tree();
  }
  async resolve(relative) {
    if (!this.root) throw new Error('请先导入文件夹。');
    if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.includes('\0')) throw new Error('无效文件路径。');
    const target = path.resolve(this.root, relative);
    const rel = path.relative(this.root,target);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('文件必须位于导入的文件夹内。');
    const real = await fs.realpath(target);
    const realRel = path.relative(this.root,real);
    if (realRel.startsWith('..') || path.isAbsolute(realRel)) throw new Error('不允许访问文件夹之外的链接。');
    return real;
  }
  async tree() {
    let count=0; const warnings=[];
    const walk = async (dir, depth=0) => {
      if (depth > 24) { warnings.push('目录层级过深，部分目录未展开。'); return []; }
      const entries = await fs.readdir(dir,{withFileTypes:true});
      entries.sort((a,b)=>Number(b.isDirectory())-Number(a.isDirectory()) || a.name.localeCompare(b.name,'zh-CN',{numeric:true}));
      const result=[];
      for (const entry of entries) {
        if (IGNORE.has(entry.name) || entry.name.startsWith('.')) continue;
        const absolute=path.join(dir,entry.name);
        const relative=path.relative(this.root,absolute).split(path.sep).join('/');
        if (entry.isSymbolicLink()) { warnings.push(`跳过链接：${relative}`); continue; }
        if (entry.isDirectory()) {
          try { const children=await walk(absolute,depth+1); if(children.length) result.push({name:entry.name,path:relative,type:'directory',children}); }
          catch { warnings.push(`无法读取目录：${relative}`); }
        } else if (entry.isFile()) {
          count++; result.push({name:entry.name,path:relative,type:'file',readable:isMarkdown(entry.name)});
        }
      }
      return result;
    };
    const children=await walk(this.root);
    let stg=false;
    try { await fs.access(path.join(this.root,'我的学习','00-学习档案.md')); stg=true; } catch {}
    return {root:this.root,name:path.basename(this.root),children,count,stg,warnings};
  }
  async read(relative) {
    if (!isMarkdown(relative)) throw new Error('当前版本可查看编辑 Markdown 和 TXT 文件。');
    const target=await this.resolve(relative);
    const stat=await fs.stat(target);
    if(!stat.isFile())throw new Error('此路径是文件夹，请选择文档。');
    if (stat.size > 8*1024*1024) throw new Error('文档超过 8 MB，请用其他编辑器打开。');
    const bytes=await fs.readFile(target);
    try { new TextDecoder('utf-8',{fatal:true}).decode(bytes); } catch { throw new Error('文档不是 UTF-8 编码，请先转换编码以避免损坏。'); }
    const content=bytes.toString('utf8');
    return {path:relative,content,version:hash(content),questions:parseQuestions(content)};
  }
  async save(relative,content,version) {
    const previous=this.writes.get(relative)||Promise.resolve();
    const task=previous.catch(()=>{}).then(()=>this.saveUnlocked(relative,content,version));
    this.writes.set(relative,task);
    try{return await task;}finally{if(this.writes.get(relative)===task)this.writes.delete(relative);}
  }
  async saveUnlocked(relative,content,version) {
    if (typeof content !== 'string' || Buffer.byteLength(content)>8*1024*1024) throw new Error('文档内容无效或超过 8 MB。');
    const current=await this.read(relative);
    if (current.version !== version) throw new Error('文件已被其他程序修改。请保留当前草稿并重新加载，避免覆盖外部修改。');
    const target=await this.resolve(relative);
    // App-owned backups never replace student history or protocol evidence.
    const appDir=path.join(this.root,'.stg-desk');
    const backupDir=path.join(appDir,'backups');
    for (const dir of [appDir,backupDir]) {
      try { const entry=await fs.lstat(dir); if(entry.isSymbolicLink() || !entry.isDirectory()) throw new Error('备份目录不是普通目录，已取消保存。'); }
      catch(error) { if(error.code==='ENOENT'){await fs.mkdir(dir).catch(e=>{if(e.code!=='EEXIST')throw e;});const entry=await fs.lstat(dir);if(entry.isSymbolicLink()||!entry.isDirectory())throw new Error('备份目录不是普通目录，已取消保存。');} else throw error; }
    }
    const rootReal=await fs.realpath(backupDir);
    const backupRel=path.relative(this.root,rootReal);
    if(backupRel.startsWith('..') || path.isAbsolute(backupRel)) throw new Error('备份目录链接越界，已取消保存。');
    const backup=path.join(rootReal,`${hash(relative).slice(0,16)}-${Date.now()}-${crypto.randomUUID()}.bak`);
    await fs.writeFile(backup,current.content,{flag:'wx'});
    const tmp=path.join(path.dirname(target),`.${path.basename(target)}.${crypto.randomUUID()}.tmp`);
    try {
      const mode=(await fs.stat(target)).mode;
      await fs.writeFile(tmp,content,{flag:'wx',mode});
      if (hash(await fs.readFile(target,'utf8')) !== version) throw new Error('保存时检测到外部修改，已取消写入。');
      await fs.rename(tmp,target);
    } finally { await fs.unlink(tmp).catch(()=>{}); }
    const history=await this.backups(relative);
    for(const old of history.slice(this.retention))await fs.unlink(await this.backupPath(relative,old.id)).catch(()=>{});
    return this.read(relative);
  }
  async backupPath(relative,id) {
    await this.resolve(relative);
    const prefix=hash(relative).slice(0,16);
    if(typeof id!=='string'||!new RegExp('^'+prefix+'-\\d+-[a-f0-9-]+\\.bak$').test(id))throw new Error('备份标识无效。');
    const file=await this.resolve('.stg-desk/backups/'+id);return file;
  }
  async backups(relative) {
    await this.resolve(relative);const prefix=hash(relative).slice(0,16)+'-';
    let directory;try{directory=await this.resolve('.stg-desk/backups');}catch(e){try{await fs.access(path.join(this.root,'.stg-desk/backups'));}catch{return [];}throw e;}
    const entries=await fs.readdir(directory,{withFileTypes:true});const result=[];
    for(const e of entries){if(!e.isFile()||!e.name.startsWith(prefix)||!e.name.endsWith('.bak'))continue;const stat=await fs.stat(await this.backupPath(relative,e.name));result.push({id:e.name,date:new Date(Number(e.name.slice(prefix.length).split('-')[0])).toISOString(),bytes:stat.size});}
    return result.sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id));
  }
  async readBackup(relative,id){return fs.readFile(await this.backupPath(relative,id),'utf8');}
  async restoreBackup(relative,id,version){const content=await this.readBackup(relative,id);return this.save(relative,content,version);}
  async search(query) {
    if(typeof query!=='string'||!query.trim())return {results:[],truncated:false};query=query.trim();
    if(query.length>200)throw new Error('搜索文字过长。');
    const info=await this.tree();const files=[];const walk=nodes=>{for(const n of nodes){if(n.children)walk(n.children);else if(n.readable)files.push(n.path);}};walk(info.children);
    const results=[];let truncated=false;
    for(const file of files){try{const doc=await this.read(file);const lines=doc.content.split(/\r?\n/);for(let i=0;i<lines.length;i++){if(lines[i].toLocaleLowerCase().includes(query.toLocaleLowerCase())){results.push({path:file,line:i+1,text:lines[i].trim().slice(0,240)});if(results.length>=200){truncated=true;break;}}}}catch{}if(truncated)break;}
    return {results,truncated};
  }
  async submit(relative, answers, version) {
    if (!/学生回答\.md$/i.test(relative)) throw new Error('答题只能写入学生回答文档。');
    const current=await this.read(relative);
    if (current.version!==version) throw new Error('回答文档已变化，请重新加载再提交。');
    return this.save(relative,appendAnswers(current.content,answers),version);
  }
  async companion(relative) {
    if (/教学引导\.md$/i.test(relative)) {
      const answer=relative.replace(/教学引导\.md$/i,'学生回答.md');
      try { return await this.read(answer); } catch { return null; }
    }
    if (/学生回答\.md$/i.test(relative)) return this.read(relative);
    return null;
  }
}
module.exports={Workspace,isMarkdown,hash};
