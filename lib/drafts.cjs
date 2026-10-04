const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
class DraftStore {
  constructor(directory){this.directory=directory;this.queue=Promise.resolve();}
  key(root,relative){if(typeof root!=='string'||typeof relative!=='string'||!root||!relative)throw new Error('草稿路径无效。');return digest(root+'\0'+relative);}
  file(root,relative){return path.join(this.directory,this.key(root,relative)+'.json');}
  async get(root,relative){try{const record=JSON.parse(await fs.readFile(this.file(root,relative),'utf8'));return record.root===root&&record.path===relative?record:null;}catch(error){if(error.code==='ENOENT')return null;throw new Error('草稿无法读取，请保留当前内容。');}}
  put(root,relative,data){
    const job=this.queue.catch(()=>{}).then(async()=>{
      if(!data||typeof data!=='object'||typeof data.content!=='string'||typeof data.baseVersion!=='string')throw new Error('草稿内容无效。');
      const record={...data,root,path:relative,modifiedAt:new Date().toISOString()};
      const text=JSON.stringify(record);if(Buffer.byteLength(text)>26*1024*1024)throw new Error('草稿内容过大。');
      await fs.mkdir(this.directory,{recursive:true});const file=this.file(root,relative);const temporary=file+'.'+crypto.randomUUID()+'.tmp';
      try{await fs.writeFile(temporary,text,{flag:'wx'});await fs.rename(temporary,file);}finally{await fs.unlink(temporary).catch(()=>{});}return record;
    });this.queue=job;return job;
  }
  remove(root,relative){const job=this.queue.catch(()=>{}).then(()=>fs.unlink(this.file(root,relative)).catch(error=>{if(error.code!=='ENOENT')throw error;}));this.queue=job;return job;}
  async list(root){await this.queue.catch(()=>{});let files;try{files=await fs.readdir(this.directory);}catch(e){if(e.code==='ENOENT')return [];throw e;}const records=[];for(const file of files){if(!/^[a-f0-9]{64}\.json$/.test(file))continue;try{const d=JSON.parse(await fs.readFile(path.join(this.directory,file),'utf8'));if(d.root===root)records.push({path:d.path,modifiedAt:d.modifiedAt});}catch{}}return records.sort((a,b)=>b.modifiedAt.localeCompare(a.modifiedAt));}
}
module.exports={DraftStore};
