const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell, nativeImage, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const STORE_FILE = path.join(app.getPath('userData'), 'jarvis-store.json');

// ---------- tiny JSON key/value store (replaces Android SharedPreferences) ----------
function loadStore() {
  try { return JSON.parse(fs.readFileSync(STORE_FILE, 'utf-8')); } catch { return {}; }
}
function saveStore(obj) { fs.writeFileSync(STORE_FILE, JSON.stringify(obj, null, 2), 'utf-8'); }
let store = loadStore();

ipcMain.handle('store:get', (_e, key, def) => (key in store ? store[key] : def ?? null));
ipcMain.handle('store:set', (_e, key, val) => { store[key] = val; saveStore(store); return true; });
ipcMain.handle('store:delete', (_e, key) => { delete store[key]; saveStore(store); return true; });

// ---------- developer PIN: PBKDF2 + random salt, stored locally only (never plaintext) ----------
// Changing the PIN here changes it for every install; it is hashed, so it can't be read back out of this file.
const DEV_PIN_DEFAULT = '3993';

function pbkdf2(pin, salt) {
  return crypto.pbkdf2Sync(pin, salt, 180000, 32, 'sha256').toString('hex');
}
function ensureDevPinInitialised() {
  if (!store.devPinSalt || !store.devPinHash) {
    const salt = crypto.randomBytes(16).toString('hex');
    store.devPinSalt = salt;
    store.devPinHash = pbkdf2(DEV_PIN_DEFAULT, salt);
    saveStore(store);
  }
}
ipcMain.handle('dev:verify', (_e, pin) => {
  ensureDevPinInitialised();
  const hash = pbkdf2(String(pin || '').trim(), store.devPinSalt);
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(store.devPinHash));
});
ipcMain.handle('dev:setPin', (_e, newPin) => {
  const salt = crypto.randomBytes(16).toString('hex');
  store.devPinSalt = salt;
  store.devPinHash = pbkdf2(String(newPin || '').trim(), salt);
  saveStore(store);
  return true;
});

// ---------- OpenAI-compatible API client (runs in main process: no CORS issues) ----------
function cleanBase(raw) {
  let b = String(raw || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(b)) b = 'https://' + b;
  for (const suf of ['/chat/completions', '/models', '/completions']) {
    if (b.endsWith(suf)) b = b.slice(0, -suf.length).replace(/\/+$/, '');
  }
  return b;
}
function cleanKey(k) { return String(k || '').trim().replace(/^Bearer\s+/i, ''); }

async function apiPost(base, path, key, body) {
  const res = await fetch(cleanBase(base) + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Jarvis-Desktop/1.0',
      ...(key ? { Authorization: 'Bearer ' + cleanKey(key) } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 200);
    try { const j = JSON.parse(text); msg = (j.error && (j.error.message || j.error)) || j.message || msg; } catch {}
    const hint = { 401: ' (کلید نامعتبر)', 403: ' (کلید نامعتبر)', 404: ' (آدرس یا مدل اشتباه)', 429: ' (سقف درخواست)' }[res.status] || '';
    throw new Error(`HTTP ${res.status}${hint}: ${msg}`);
  }
  return JSON.parse(text);
}
async function apiGet(base, path, key) {
  const res = await fetch(cleanBase(base) + path, {
    headers: { 'Accept': 'application/json', ...(key ? { Authorization: 'Bearer ' + cleanKey(key) } : {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

ipcMain.handle('api:chat', async (_e, { base, key, model, messages, maxTokens }) => {
  let budget = maxTokens || 380;
  let text = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const j = await apiPost(base, '/chat/completions', key, {
      model, messages, max_tokens: budget, temperature: 0.6,
    });
    text = (j.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    if (text) break;
    budget = Math.min(budget * 6, 4000);
  }
  if (!text) throw new Error('پاسخ خالی بود (ممکنه مدل reasoning باشه؛ مدل دیگه‌ای امتحان کن)');
  return text;
});

ipcMain.handle('api:analyze', async (_e, { base, key, model, text, images, maxTokens }) => {
  async function once(withImages) {
    const content = [{ type: 'text', text }];
    if (withImages) for (const url of (images || []).slice(0, 6)) content.push({ type: 'image_url', image_url: { url } });
    const j = await apiPost(base, '/chat/completions', key, {
      model, messages: [{ role: 'user', content }], max_tokens: maxTokens || 900,
    });
    const t = (j.choices?.[0]?.message?.content || '').trim();
    if (!t) throw new Error('empty answer');
    return t;
  }
  try { return await once(true); }
  catch (e) {
    if (images && images.length) {
      try { return await once(false); } catch (e2) { throw e; }
    }
    throw e;
  }
});

ipcMain.handle('api:test', async (_e, { base, key, model }) => {
  const j = await apiPost(base, '/chat/completions', key, {
    model, messages: [{ role: 'user', content: 'Reply with the single word: OK' }], max_tokens: 64,
  });
  const t = (j.choices?.[0]?.message?.content || '').trim();
  if (!t) throw new Error('پاسخ خالی بود');
  return t;
});

ipcMain.handle('api:models', async (_e, { base, key }) => {
  const j = await apiGet(base, '/models', key);
  const arr = Array.isArray(j) ? j : (j.data || j.models || []);
  const out = new Set();
  for (const e of arr) {
    const id = typeof e === 'string' ? e : (e.id || e.name || '');
    if (id) out.add(String(id).replace(/^models\//, ''));
  }
  return [...out].sort();
});

// ---------- file dialogs (attachments, zip export) ----------
ipcMain.handle('dialog:openFiles', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openFile', 'multiSelections'] });
  if (r.canceled) return [];
  return r.filePaths.map((p) => ({
    path: p,
    name: path.basename(p),
    ext: path.extname(p).toLowerCase(),
    sizeMB: fs.statSync(p).size / (1024 * 1024),
  }));
});
ipcMain.handle('file:readBase64', (_e, filePath) => fs.readFileSync(filePath).toString('base64'));
ipcMain.handle('file:readText', (_e, filePath, maxChars) => {
  const buf = fs.readFileSync(filePath, 'utf-8');
  return buf.slice(0, maxChars || 180000);
});
// ---------- minimal ZIP writer (store-only, no deps) for the "export code as project" feature ----------
function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xFF;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function buildZip(parts) {
  const chunks = []; const central = []; let offset = 0;
  for (const { name, body } of parts) {
    const nameBuf = Buffer.from(name, 'utf-8');
    const dataBuf = Buffer.from(body, 'utf-8');
    const crc = crc32(dataBuf);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8); local.writeUInt16LE(0, 10); local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(dataBuf.length, 18); local.writeUInt32LE(dataBuf.length, 22);
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, dataBuf);
    const centralRec = Buffer.alloc(46);
    centralRec.writeUInt32LE(0x02014b50, 0); centralRec.writeUInt16LE(20, 4); centralRec.writeUInt16LE(20, 6);
    centralRec.writeUInt16LE(0, 8); centralRec.writeUInt16LE(0, 10); centralRec.writeUInt16LE(0, 12);
    centralRec.writeUInt32LE(crc, 16); centralRec.writeUInt32LE(dataBuf.length, 20); centralRec.writeUInt32LE(dataBuf.length, 24);
    centralRec.writeUInt16LE(nameBuf.length, 28); centralRec.writeUInt32LE(0, 38); centralRec.writeUInt32LE(offset, 42);
    central.push(centralRec, nameBuf);
    offset += local.length + nameBuf.length + dataBuf.length;
  }
  const centralStart = offset;
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(parts.length, 8); end.writeUInt16LE(parts.length, 10);
  end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(centralStart, 16);
  return Buffer.concat([...chunks, centralBuf, end]);
}
ipcMain.handle('export:zip', async (_e, { suggestedName, parts }) => {
  if (!parts || !parts.length) return false;
  const r = await dialog.showSaveDialog(mainWindow, { defaultPath: suggestedName || 'jarvis-project.zip' });
  if (r.canceled || !r.filePath) return false;
  fs.writeFileSync(r.filePath, buildZip(parts));
  shell.showItemInFolder(r.filePath);
  return true;
});
ipcMain.handle('shell:openExternal', (_e, url) => shell.openExternal(url));

// ---------- windows ----------
let mainWindow, overlayWindow, tray;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1180, height: 760, minWidth: 860, minHeight: 560,
    backgroundColor: '#03060C', show: false, autoHideMenuBar: true,
    title: 'Jarvis',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', (e) => {
    if (!app.isQuiting) { e.preventDefault(); mainWindow.hide(); }
  });
}

function createOverlayWindow() {
  overlayWindow = new BrowserWindow({
    width: 360, height: 420, show: false, frame: false, transparent: true,
    alwaysOnTop: true, resizable: false, skipTaskbar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  overlayWindow.loadFile(path.join(__dirname, 'src', 'overlay.html'));
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
}

ipcMain.handle('overlay:show', () => {
  if (!overlayWindow) return;
  const { screen } = require('electron');
  const area = screen.getPrimaryDisplay().workArea;
  overlayWindow.setPosition(area.x + area.width - 380, area.y + area.height - 460);
  overlayWindow.show();
});
ipcMain.handle('overlay:hide', () => overlayWindow && overlayWindow.hide());
ipcMain.handle('overlay:startWakeListening', () => overlayWindow && overlayWindow.webContents.send('wake:start'));
ipcMain.handle('overlay:stopWakeListening', () => overlayWindow && overlayWindow.webContents.send('wake:stop'));
ipcMain.handle('main:openAndFocus', () => { mainWindow.show(); mainWindow.focus(); });

app.whenReady().then(() => {
  ensureDevPinInitialised();
  // auto-allow microphone for our own windows (the desktop equivalent of RECORD_AUDIO)
  const { session } = require('electron');
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'media');
  });

  createMainWindow();
  createOverlayWindow();

  const iconPath = path.join(__dirname, 'assets', 'tray.png');
  const img = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  tray = new Tray(img);
  const rebuildMenu = (wakeOn) => Menu.buildFromTemplate([
    { label: 'باز کردن جارویس', click: () => { mainWindow.show(); mainWindow.focus(); } },
    { label: wakeOn ? 'خاموش کردن گوش‌به‌زنگ' : 'روشن کردن گوش‌به‌زنگ', click: () => mainWindow.webContents.send('tray:toggleWake') },
    { type: 'separator' },
    { label: 'خروج', click: () => { app.isQuiting = true; app.quit(); } },
  ]);
  tray.setToolTip('Jarvis');
  tray.setContextMenu(rebuildMenu(false));
  ipcMain.handle('tray:setWakeState', (_e, on) => tray.setContextMenu(rebuildMenu(on)));
  tray.on('click', () => { mainWindow.show(); mainWindow.focus(); });

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });

  // quick-open shortcut, handy for a desktop assistant (like Spotlight/Siri)
  globalShortcut.register('Control+Space', () => { mainWindow.show(); mainWindow.focus(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { app.isQuiting = true; });
app.on('will-quit', () => globalShortcut.unregisterAll());
