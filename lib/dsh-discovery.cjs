'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile, execFileSync } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const LEGACY_DESKTOP_PORT = 19387;
const DEFAULT_WEB_PORT = 3080;

function expandTilde(value) {
  if (typeof value !== 'string') return value;
  if (value === '~') return os.homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function resolveDshHome(customHome, env = process.env) {
  const raw = customHome || env.DSH_HOME;
  if (typeof raw === 'string' && raw.trim()) return path.resolve(expandTilde(raw.trim()));
  return path.join(os.homedir(), '.dsh');
}

function extractInstallDir(rawValue) {
  if (typeof rawValue !== 'string') return null;
  const withoutIconIndex = rawValue.trim().replace(/,\s*-?\d+\s*$/, '').trim();
  if (!withoutIconIndex) return null;
  const quoted = /"([^"]+)"/.exec(withoutIconIndex);
  const candidate = (quoted ? quoted[1] : withoutIconIndex.replace(/^"|"$/g, '')).trim();
  if (!candidate) return null;
  if (/\.exe$/i.test(candidate)) return path.dirname(candidate);
  const firstToken = candidate.split(/\s+/)[0];
  if (/\.exe$/i.test(firstToken)) return path.dirname(firstToken);
  return candidate;
}

function isDesktopInstallDir(dir) {
  if (typeof dir !== 'string' || !dir.trim()) return false;
  try {
    if (!fs.existsSync(path.join(dir, 'resources', 'app.asar'))) return false;
    return fs.readdirSync(dir).some(name => /^DeepSeek Harness\.exe$/i.test(name));
  } catch {
    return false;
  }
}

function extractDesktopExecutable(installOrExe) {
  if (typeof installOrExe !== 'string' || !installOrExe.trim()) return null;
  const resolved = path.resolve(expandTilde(installOrExe.trim()));
  if (/\.exe$/i.test(resolved)) return resolved;
  return path.join(resolved, 'DeepSeek Harness.exe');
}

function standardInstallRoots(env = process.env) {
  const roots = [];
  const push = value => {
    const dir = extractInstallDir(value);
    if (dir && !roots.some(existing => existing.toLowerCase() === dir.toLowerCase())) roots.push(dir);
  };
  push(env.DSH_DESKTOP_HOME);
  for (const extra of String(env.STG_DSH_DESKTOP_ROOTS || '').split(';')) push(extra.trim());
  for (const base of [env.LOCALAPPDATA, env.APPDATA, env.ProgramFiles, env['ProgramFiles(x86)']]) {
    if (!base) continue;
    push(path.join(base, 'Programs', 'DeepSeek Harness'));
    push(path.join(base, 'DeepSeek Harness'));
  }
  return roots;
}

function normalizeLoopbackEndpoint(address, port) {
  const num = Number(port);
  if (!Number.isInteger(num) || num < 1 || num > 65535) return null;
  const host = String(address || '').trim().replace(/^\[|\]$/g, '').toLowerCase();
  if (host === '127.0.0.1' || host === 'localhost' || host === '0.0.0.0' || host === '::ffff:127.0.0.1') {
    return `http://127.0.0.1:${num}`;
  }
  if (host === '::1' || host === '::') {
    return `http://[::1]:${num}`;
  }
  return null;
}

function parseNetstatListeningPorts(output, pidSet) {
  const endpoints = [];
  const seen = new Set();
  for (const rawLine of String(output || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!/^TCP\s+/i.test(line)) continue;
    const parts = line.split(/\s+/);
    // TCP    127.0.0.1:19387    0.0.0.0:0    LISTENING    12345
    if (parts.length < 5) continue;
    const state = parts[3].toUpperCase();
    if (state !== 'LISTENING') continue;
    const pid = Number(parts[4]);
    if (!Number.isInteger(pid) || (pidSet && !pidSet.has(pid))) continue;
    const local = parts[1];
    const colon = local.lastIndexOf(':');
    if (colon <= 0) continue;
    const endpoint = normalizeLoopbackEndpoint(local.slice(0, colon), local.slice(colon + 1));
    if (endpoint && !seen.has(endpoint)) {
      seen.add(endpoint);
      endpoints.push(endpoint);
    }
  }
  return endpoints;
}

// Discover custom Windows installations without executing shell text from a path.
function discoverDshDesktop(options = {}) {
  if (process.platform !== 'win32') return undefined;
  if (!options.ignoreEnv && (process.env.STG_DSH_RUNTIME || process.env.DSH_DESKTOP_HOME)) return undefined;
  for (const root of standardInstallRoots()) {
    if (isDesktopInstallDir(root)) return root;
  }
  try {
    const script = [
      '$paths = @()',
      "$paths += @(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue | ForEach-Object { $_.Path })",
      "foreach ($key in @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*')) {",
      "  $items = Get-ItemProperty -Path $key -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like '*DeepSeek Harness*' }",
      '  foreach ($item in $items) {',
      '    if ($item.InstallLocation) { $paths += $item.InstallLocation }',
      '    if ($item.DisplayIcon) { $paths += $item.DisplayIcon }',
      '    if ($item.UninstallString) { $paths += $item.UninstallString }',
      '  }',
      '}',
      'ConvertTo-Json -Compress -InputObject @($paths | Where-Object { $_ } | Select-Object -Unique)',
    ].join('; ');
    const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      encoding: 'utf8',
      timeout: 5000,
    });
    const parsed = JSON.parse(output || '[]');
    const candidates = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
    for (const candidate of candidates) {
      const root = extractInstallDir(candidate);
      if (root && isDesktopInstallDir(root)) return root;
    }
  } catch {}
  return undefined;
}

/**
 * Inspect running DSH Desktop / Web processes and their listening loopback TCP
 * endpoints in a single call. Covers:
 *   - DSH Desktop 0.2.0 (fixed port 19387)
 *   - DSH Desktop 0.2.1 / 0.2.2+ (ephemeral --port 0, windowed or tray-minimized)
 *   - DSH Web 0.1.x / 0.2.x (`dsh web`, default 3080 or custom --port)
 */
async function discoverDesktopProcessState() {
  if (process.platform !== 'win32') {
    return { running: false, hasWindow: false, hasDshWeb: false, endpoints: [], pids: [] };
  }
  const script = [
    '$desktop = @(Get-Process -Name "DeepSeek Harness" -ErrorAction SilentlyContinue)',
    '$desktopPids = @($desktop | ForEach-Object { [int]$_.Id })',
    '$hasWindow = [bool]($desktop | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1)',
    '$hostPids = [System.Collections.Generic.HashSet[int]]::new()',
    'foreach ($p in $desktopPids) { [void]$hostPids.Add($p) }',
    '$hasWeb = $false',
    'try {',
    '  $cim = @(Get-CimInstance Win32_Process -Filter "Name=\'DeepSeek Harness.exe\' OR Name=\'node.exe\'" -ErrorAction SilentlyContinue)',
    '  foreach ($proc in $cim) {',
    '    $pidInt = [int]$proc.ProcessId',
    '    $parentInt = [int]$proc.ParentProcessId',
    '    $cmd = [string]$proc.CommandLine',
    '    if ($hostPids.Contains($parentInt) -or $cmd -match "dsh-desktop-host") { [void]$hostPids.Add($pidInt) }',
    '    elseif ($cmd -match "@deepseek-ai[/\\\\]dsh\\b" -and $cmd -match "\\b(?:web|desktop)\\b") { [void]$hostPids.Add($pidInt); $hasWeb = $true }',
    '  }',
    '} catch {}',
    '$listeners = @()',
    'if ($hostPids.Count -gt 0) {',
    '  try {',
    '    $conns = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $hostPids.Contains([int]$_.OwningProcess) })',
    '    foreach ($c in $conns) {',
    '      $listeners += [pscustomobject]@{ address = [string]$c.LocalAddress; port = [int]$c.LocalPort; pid = [int]$c.OwningProcess }',
    '    }',
    '  } catch {}',
    '}',
    '[pscustomobject]@{ hasWindow = $hasWindow; hasWeb = $hasWeb; pids = @($hostPids); listeners = $listeners } | ConvertTo-Json -Compress -Depth 4',
  ].join('\n');

  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 6000 },
    );
    const data = JSON.parse(String(stdout || '').trim() || '{}');
    const pids = Array.isArray(data.pids) ? data.pids.map(Number).filter(Number.isInteger) : [];
    const hasWindow = Boolean(data.hasWindow);
    const hasDshWeb = Boolean(data.hasWeb);
    const rawListeners = Array.isArray(data.listeners) ? data.listeners : (data.listeners ? [data.listeners] : []);
    const endpoints = [];
    const seen = new Set();
    const pushEndpoint = url => {
      if (url && !seen.has(url)) {
        seen.add(url);
        endpoints.push(url);
      }
    };
    for (const item of rawListeners) {
      pushEndpoint(normalizeLoopbackEndpoint(item?.address, item?.port));
    }
    // Fallback to netstat when Get-NetTCPConnection returned nothing but DSH PIDs exist.
    if (endpoints.length === 0 && pids.length > 0) {
      try {
        const { stdout: netOut } = await execFileAsync('netstat.exe', ['-ano', '-p', 'TCP'], { windowsHide: true, timeout: 4000 });
        for (const ep of parseNetstatListeningPorts(netOut, new Set(pids))) pushEndpoint(ep);
      } catch {}
    }
    if (hasWindow) pushEndpoint(`http://127.0.0.1:${LEGACY_DESKTOP_PORT}`);
    if (hasDshWeb) pushEndpoint(`http://127.0.0.1:${DEFAULT_WEB_PORT}`);
    // A running DSH host has either an open Desktop window or an active loopback listener.
    const running = hasWindow || endpoints.length > 0;
    return { running, hasWindow, hasDshWeb, endpoints, pids };
  } catch {
    return { running: false, hasWindow: false, hasDshWeb: false, endpoints: [], pids: [] };
  }
}

discoverDshDesktop.LEGACY_DESKTOP_PORT = LEGACY_DESKTOP_PORT;
discoverDshDesktop.DEFAULT_WEB_PORT = DEFAULT_WEB_PORT;
discoverDshDesktop.expandTilde = expandTilde;
discoverDshDesktop.resolveDshHome = resolveDshHome;
discoverDshDesktop.extractInstallDir = extractInstallDir;
discoverDshDesktop.isDesktopInstallDir = isDesktopInstallDir;
discoverDshDesktop.extractDesktopExecutable = extractDesktopExecutable;
discoverDshDesktop.standardInstallRoots = standardInstallRoots;
discoverDshDesktop.normalizeLoopbackEndpoint = normalizeLoopbackEndpoint;
discoverDshDesktop.parseNetstatListeningPorts = parseNetstatListeningPorts;
discoverDshDesktop.discoverDesktopProcessState = discoverDesktopProcessState;

module.exports = discoverDshDesktop;
