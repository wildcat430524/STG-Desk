const path=require('node:path');
const fs=require('node:fs');
// STG Desk keeps one original brand mark: build/icon.ico while developing and the
// same file copied to the resources root by build.extraResources when packaged.
// Every native window asks this helper instead of guessing its own path.
function appIconPath(app){
  const resources=process.resourcesPath||path.join(path.dirname(process.execPath),'resources');
  return app?.isPackaged?path.join(resources,'icon.ico'):path.join(__dirname,'../build/icon.ico');
}
function appIcon(app){const file=appIconPath(app);return fs.existsSync(file)?file:undefined;}
module.exports={appIconPath,appIcon};
