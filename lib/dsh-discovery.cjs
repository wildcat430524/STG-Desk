const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');

// Discover custom Windows installations without executing shell text from a path.
module.exports=function discoverDshDesktop(){
  if(process.platform!=='win32'||process.env.STG_DSH_RUNTIME||process.env.DSH_DESKTOP_HOME)return undefined;
  try{
    const script="$paths=@(); $paths+=@(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue | ForEach-Object { $_.Path }); foreach($key in @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*')) { $paths+=@(Get-ItemProperty -Path $key -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like '*DeepSeek Harness*' } | ForEach-Object { $_.InstallLocation }) }; ConvertTo-Json -Compress -InputObject @($paths | Where-Object { $_ } | Select-Object -Unique)";
    const output=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,encoding:'utf8'});
    for(const candidate of JSON.parse(output)||[]){
      const root=candidate.toLowerCase().endsWith('.exe')?path.dirname(candidate):candidate;
      if(fs.existsSync(path.join(root,'DeepSeek Harness.exe'))&&fs.existsSync(path.join(root,'resources','app.asar')))return root;
    }
  }catch{}
  return undefined;
};
