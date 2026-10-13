import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, Menu, protocol, session, webContents, utilityProcess } from 'electron';
import { configureNimiElectronAppHostProfile } from '@nimiplatform/kit/shell/electron/host-profile';
import fs from 'node:fs';
import { sillyTavernDataRoot } from '../../scripts/nimi-data-root.mjs';

declare const __NIMI_ELECTRON_PRODUCTION__: boolean;

// Bind user data, session data and temp to the Host profile Nimi Desktop
// prepared under the selected data root, before any session or window and
// before the rest of Kit loads: a module that failed to load first would
// leave Electron on its default paths in the OS user's profile.
try {
  configureNimiElectronAppHostProfile(app);
} catch (error) {
  process.stderr.write(`[nimi-app-host-profile] ${error instanceof Error ? error.message : String(error)}\n`);
  app.exit(78);
  throw error;
}

const {
  createNimiElectronStandardApplicationMenuTemplate,
  isAllowedElectronRendererUrl,
  registerNimiElectronAppAssetProtocolScheme,
  registerNimiElectronAppBridge,
} = await import('@nimiplatform/kit/shell/electron/main');

const APP_ID = 'org.nimiplatform.sillytavern';
const NATIVE_BUNDLE_IDENTIFIER = "ai.nimi.apps.org.nimiplatform.sillytavern";
const IS_PRODUCTION_BUNDLE = typeof __NIMI_ELECTRON_PRODUCTION__ !== 'undefined'
  && __NIMI_ELECTRON_PRODUCTION__;
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(currentDir, '..');
const preloadPath = path.join(currentDir, 'preload.cjs');
const productionRendererUrl = 'http://127.0.0.1:1476/';
const developmentRendererUrl = readDevelopmentRendererUrl();
const rendererUrl = developmentRendererUrl || productionRendererUrl;
const allowedRendererUrls = [rendererUrl];
let resettingRenderer = false;
let quitting = false;
let businessProcess: ReturnType<typeof utilityProcess.fork> | null = null;

app.setName("SillyTavern");
app.setAppUserModelId(NATIVE_BUNDLE_IDENTIFIER);
// macOS routes Cmd+C/V/X/A/Z and Cmd+Q through application menu roles.
Menu.setApplicationMenu(Menu.buildFromTemplate(
  createNimiElectronStandardApplicationMenuTemplate({ appName: "SillyTavern" }),
));
registerNimiElectronAppAssetProtocolScheme(protocol);

void app.whenReady().then(async () => {
  if (!developmentRendererUrl) await startBusinessServer();
  registerNimiElectronAppBridge({
    appId: APP_ID,
    allowedRendererUrls,
    assetMediaPlatform: { protocol, webRequest: session.defaultSession.webRequest, webContents },
    ipcMain,
    onSessionInvalidated: resetAccountScopedRenderer,
  });
  await createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !resettingRenderer && BrowserWindow.getAllWindows().length === 0) app.quit();
});
app.on('before-quit', () => { quitting = true; businessProcess?.kill(); });

// A revoked/account-changed scope must not leave renderer timers or queued
// promises alive to use the rebound Host. This does not run on normal renewal.
function resetAccountScopedRenderer(): void {
  const windows = BrowserWindow.getAllWindows();
  if (quitting || windows.length === 0) return;
  resettingRenderer = true;
  try {
    for (const window of windows) window.destroy();
    void createMainWindow().catch((error: unknown) => {
      process.stderr.write(`[nimi-app-session-reset] ${error instanceof Error ? error.message : String(error)}\n`);
    });
  } finally { resettingRenderer = false; }
}

async function createMainWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 360,
    minHeight: 560,
    title: "SillyTavern",
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedElectronRendererUrl(url, allowedRendererUrls)) event.preventDefault();
  });
  try {
    await window.loadURL(rendererUrl);
  } catch (error) {
    if (!window.isDestroyed()) throw error;
  }
}

function readDevelopmentRendererUrl(): string {
  const flag = '--nimi-dev-renderer-url';
  const prefix = '--nimi-dev-renderer-url=';
  const hasDevelopmentRendererArgument = process.argv.some((value) => value === flag || value.startsWith(prefix));
  if (IS_PRODUCTION_BUNDLE && hasDevelopmentRendererArgument) {
    throw new Error('The production Electron bundle rejects --nimi-dev-renderer-url.');
  }
  if (process.argv.includes(flag)) throw new Error('Nimi development renderer URL is missing.');
  const values = process.argv.filter((value) => value.startsWith(prefix));
  if (values.length === 0) return '';
  if (values.length !== 1) throw new Error('Nimi development renderer URL must be singular.');
  const selected = values[0];
  if (!selected) throw new Error('Nimi development renderer URL is missing.');
  const raw = selected.slice(prefix.length);
  const parsed = new URL(raw);
  if (
    parsed.protocol !== 'http:'
    || !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(parsed.hostname.toLowerCase())
    || !parsed.port
    || parsed.username
    || parsed.password
    || (parsed.pathname !== '/' && parsed.pathname !== '')
    || parsed.search
    || parsed.hash
  ) {
    throw new Error('Nimi development renderer URL must be exact loopback.');
  }
  return parsed.origin;
}

async function startBusinessServer(): Promise<void> {
  // Fixed business process, with no Host launch/credential/Runtime environment.
  const env: Record<string, string> = {};
  // Electron utility-process networking needs SystemRoot on Windows.
  for (const key of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'PATH', 'LANG', 'LC_ALL']) {
    if (process.env[key]) env[key] = process.env[key]!;
  }
  env.ST_NIMI_PACKAGED = '1';
  const businessTemp = path.join(sillyTavernDataRoot(), 'tmp');
  fs.mkdirSync(businessTemp, { recursive: true });
  for (const key of ['TMPDIR', 'TEMP', 'TMP']) env[key] = businessTemp;
  businessProcess = utilityProcess.fork(path.join(appRoot, 'scripts', 'nimi-server.mjs'), [], {
    cwd: appRoot, env, stdio: 'pipe', serviceName: 'SillyTavern Data',
  });
  businessProcess.stdout?.on('data', (data) => process.stdout.write(data));
  businessProcess.stderr?.on('data', (data) => process.stderr.write(data));
  const child = businessProcess;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('SillyTavern data server startup timed out.')); }, 30000);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`SillyTavern data server exited (${code}).`)); if (!quitting) app.quit(); });
    child.on('message', (message) => {
      if (message?.type !== 'sillytavern-ready') return;
      clearTimeout(timer);
      if (message.url !== productionRendererUrl) { child.kill(); reject(new Error('Unexpected SillyTavern server origin.')); }
      else resolve();
    });
  });
}
