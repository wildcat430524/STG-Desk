const fs=require('node:fs/promises');
const path=require('node:path');
const root=path.join(__dirname,'..');
async function main(){
  const out=path.join(root,'licenses');await fs.mkdir(out,{recursive:true});
  const records=[];
  async function packages(dir){
    for(const entry of await fs.readdir(dir,{withFileTypes:true})){
      if(!entry.isDirectory()||entry.name.startsWith('.'))continue;
      if(entry.name.startsWith('@')){await packages(path.join(dir,entry.name));continue;}
      const pkgDir=path.join(dir,entry.name);let pkg;
      try{pkg=JSON.parse(await fs.readFile(path.join(pkgDir,'package.json'),'utf8'));}catch{continue;}
      const files=(await fs.readdir(pkgDir,{withFileTypes:true})).filter(f=>f.isFile()&&/^(license|copying|notice)(\.|$|-)/i.test(f.name));
      for(const file of files){const name=`${pkg.name.replace(/[^\w.-]/g,'_')}-${pkg.version}-${file.name}`;await fs.copyFile(path.join(pkgDir,file.name),path.join(out,name));}
      records.push({name:pkg.name,version:pkg.version,license:pkg.license||null,licenseFiles:files.map(f=>f.name),developmentOrRuntime:'All installed packages; includes build-time tools for completeness.'});
      try{await fs.access(path.join(pkgDir,'node_modules'));await packages(path.join(pkgDir,'node_modules'));}catch{}
    }
  }
  await packages(path.join(root,'node_modules'));
  await fs.writeFile(path.join(out,'inventory.json'),JSON.stringify(records,null,2));
  console.log(`License evidence collected for ${records.length} installed packages.`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
