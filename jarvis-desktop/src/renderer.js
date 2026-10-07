const $ = (id) => document.getElementById(id);

const PROVIDERS = [
  { id: 'llm7', name: 'LLM7', base: 'https://api.llm7.io/v1', models: ['fast', 'default', 'pro'], needsKey: false },
  { id: 'openrouter', name: 'OpenRouter', base: 'https://openrouter.ai/api/v1', models: ['openrouter/auto', 'meta-llama/llama-3.3-70b-instruct:free', 'deepseek/deepseek-chat-v3-0324:free'] },
  { id: 'deepseek', name: 'DeepSeek', base: 'https://api.deepseek.com/v1', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { id: 'gemini', name: 'Gemini', base: 'https://generativelanguage.googleapis.com/v1beta/openai', models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'] },
  { id: 'groq', name: 'Groq', base: 'https://api.groq.com/openai/v1', models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'openai/gpt-oss-20b'] },
  { id: 'custom', name: 'دلخواه', base: '', models: [] },
];

let state = {
  screen: 'chat',
  convos: [],          // [{id, title, msgs:[{role,text}]}]
  activeConvoId: null,
  provider: PROVIDERS[0],
  pendingFiles: [],
};

// ---------- navigation ----------
document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => switchScreen(btn.dataset.screen));
});
function switchScreen(name) {
  state.screen = name;
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.screen === name));
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + name));
  $('topTitle').textContent = {
    chat: 'گفتگو با جارویس', setup: 'اتصال به هوش مصنوعی', shortcuts: 'میانبرهای تماس', settings: 'تنظیمات',
  }[name];
}

// ---------- chat ----------
function activeConvo() { return state.convos.find((c) => c.id === state.activeConvoId); }
function newConvo() {
  const c = { id: Date.now(), title: 'گفتگوی جدید', msgs: [] };
  state.convos.unshift(c); state.activeConvoId = c.id;
  renderHistory(); renderMessages();
}
function renderHistory() {
  const el = $('historyPanel');
  el.innerHTML = '';
  const newBtn = document.createElement('button');
  newBtn.textContent = '+ گفتگوی جدید'; newBtn.style.color = '#FFB300';
  newBtn.addEventListener('click', newConvo);
  el.appendChild(newBtn);
  state.convos.forEach((c) => {
    const b = document.createElement('button');
    b.textContent = c.title;
    b.className = c.id === state.activeConvoId ? 'active' : '';
    b.addEventListener('click', () => { state.activeConvoId = c.id; renderHistory(); renderMessages(); });
    el.appendChild(b);
  });
}
function renderMessages() {
  const el = $('messages'); el.innerHTML = '';
  const c = activeConvo();
  if (!c) return;
  c.msgs.forEach((m) => {
    const div = document.createElement('div');
    div.className = 'msg ' + (m.role === 'user' ? 'user' : 'assistant');
    if (m.role === 'assistant' && window.Artifact.extract(m.text).length) {
      const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = 'شامل فایل قابل خروجی';
      div.appendChild(tag);
      const exportBtn = document.createElement('button');
      exportBtn.className = 'btn'; exportBtn.style.marginBottom = '6px'; exportBtn.textContent = '📦 خروجی zip';
      exportBtn.addEventListener('click', () => exportAsProject(m.text));
      div.appendChild(exportBtn); div.appendChild(document.createElement('br'));
    }
    div.appendChild(document.createTextNode(m.text));
    el.appendChild(div);
  });
  el.scrollTop = el.scrollHeight;
}
async function exportAsProject(text) {
  const parts = window.Artifact.extract(text);
  if (!parts.length) return;
  await window.jarvis.files.exportZip({ suggestedName: 'jarvis-project.zip', parts });
}

async function sendMessage(text) {
  text = (text || '').trim();
  if (!text) return;
  let c = activeConvo();
  if (!c) { newConvo(); c = activeConvo(); }
  if (c.msgs.length === 0) c.title = text.slice(0, 28);
  c.msgs.push({ role: 'user', text });
  renderMessages(); renderHistory();
  c.msgs.push({ role: 'assistant', text: '…' });
  renderMessages();
  try {
    const answer = await window.ChatCore.ask(text, c.msgs.slice(0, -1));
    c.msgs[c.msgs.length - 1] = { role: 'assistant', text: answer };
    const speakTyped = await window.jarvis.store.get('speakTyped', false);
    if (speakTyped) speakText(answer);
  } catch (err) {
    c.msgs[c.msgs.length - 1] = { role: 'assistant', text: 'خطا: ' + (err.message || err) };
  }
  renderMessages();
  persistConvos();
}
function persistConvos() { window.jarvis.store.set('convos', state.convos.slice(0, 40)); }

$('sendBtn').addEventListener('click', () => { const v = $('composerInput').value; $('composerInput').value = ''; sendMessage(v); });
$('composerInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('sendBtn').click(); }
});

// ---------- manual mic (push-to-talk in the chat screen) ----------
const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
let micRecognizer = null, micOn = false;
$('micBtn').addEventListener('click', () => {
  if (!SpeechRecognitionCtor) { alert('مرورگر این کامپیوتر از تشخیص گفتار پشتیبانی نمی‌کنه.'); return; }
  if (micOn) { micRecognizer && micRecognizer.abort(); return; }
  micRecognizer = new SpeechRecognitionCtor();
  micRecognizer.lang = 'fa-IR';
  micRecognizer.onstart = () => { micOn = true; $('micBtn').classList.add('active'); };
  micRecognizer.onend = () => { micOn = false; $('micBtn').classList.remove('active'); };
  micRecognizer.onresult = (e) => { sendMessage(e.results[0][0].transcript); };
  micRecognizer.onerror = () => { micOn = false; $('micBtn').classList.remove('active'); };
  try { micRecognizer.start(); } catch {}
});

// ---------- attachments ----------
$('attachBtn').addEventListener('click', async () => {
  const files = await window.jarvis.files.openPicker();
  if (!files.length) return;
  const names = files.map((f) => f.name).join('، ');
  let c = activeConvo(); if (!c) { newConvo(); c = activeConvo(); }
  c.msgs.push({ role: 'user', text: 'فایل‌ها: ' + names });
  c.msgs.push({ role: 'assistant', text: '…' });
  renderMessages();
  try {
    const payloads = [];
    for (const f of files) {
      if (['.png', '.jpg', '.jpeg', '.webp'].includes(f.ext)) {
        const b64 = await window.jarvis.files.readBase64(f.path);
        const mime = f.ext === '.png' ? 'image/png' : 'image/jpeg';
        payloads.push({ text: `Analyze the attached image: ${f.name}`, image: `data:${mime};base64,${b64}` });
      } else {
        const text = await window.jarvis.files.readText(f.path, 180000);
        payloads.push({ text: `Analyze this file named ${f.name}.\n\n${text}` });
      }
    }
    const cfg = await window.ChatCore.loadCfg();
    if (!window.ChatCore.configured(cfg)) throw new Error('اول باید یه هوش مصنوعی (API) وصل کنی.');
    const prompt = 'Answer in the user\'s language. Analyze the attached files carefully.\n\n' +
      payloads.map((p, i) => `--- Attachment ${i + 1} ---\n${p.text}`).join('\n\n');
    const images = payloads.filter((p) => p.image).map((p) => p.image);
    const answer = await window.jarvis.api.analyze({ base: cfg.base, key: cfg.key, model: cfg.model, text: prompt, images, maxTokens: cfg.devOk ? 1400 : 900 });
    c.msgs[c.msgs.length - 1] = { role: 'assistant', text: answer };
  } catch (err) {
    c.msgs[c.msgs.length - 1] = { role: 'assistant', text: 'خطا: ' + (err.message || err) };
  }
  renderMessages(); persistConvos();
});

// ---------- setup ----------
function renderProviderChips() {
  const el = $('providerChips'); el.innerHTML = '';
  PROVIDERS.forEach((p) => {
    const c = document.createElement('button'); c.className = 'chip' + (p.id === state.provider.id ? ' on' : '');
    c.textContent = p.name;
    c.addEventListener('click', () => {
      state.provider = p;
      $('apiBase').value = p.base;
      $('apiModel').value = p.models[0] || '';
      renderProviderChips();
    });
    el.appendChild(c);
  });
}
$('fetchModelsBtn').addEventListener('click', async () => {
  $('setupStatus').textContent = '...'; $('setupStatus').className = '';
  try {
    const models = await window.jarvis.api.models({ base: $('apiBase').value, key: $('apiKey').value });
    const sel = $('modelList'); sel.innerHTML = ''; sel.style.display = 'block';
    models.forEach((m) => { const o = document.createElement('option'); o.value = m; o.textContent = m; sel.appendChild(o); });
    sel.onchange = () => { $('apiModel').value = sel.value; };
    $('setupStatus').textContent = `${models.length} مدل پیدا شد`; $('setupStatus').className = 'status-ok';
  } catch (err) { $('setupStatus').textContent = err.message; $('setupStatus').className = 'status-err'; }
});
$('testBtn').addEventListener('click', async () => {
  $('setupStatus').textContent = 'در حال تست…'; $('setupStatus').className = '';
  try {
    await window.jarvis.api.test({ base: $('apiBase').value, key: $('apiKey').value, model: $('apiModel').value });
    $('setupStatus').textContent = 'وصل شد ✓'; $('setupStatus').className = 'status-ok';
  } catch (err) { $('setupStatus').textContent = err.message; $('setupStatus').className = 'status-err'; }
});
$('saveApiBtn').addEventListener('click', async () => {
  await window.jarvis.store.set('provider', state.provider.id);
  await window.jarvis.store.set('apiBase', $('apiBase').value.trim());
  await window.jarvis.store.set('apiKey', $('apiKey').value.trim());
  await window.jarvis.store.set('apiModel', $('apiModel').value.trim());
  $('setupStatus').textContent = 'ذخیره شد ✓'; $('setupStatus').className = 'status-ok';
  switchScreen('chat');
});

// ---------- shortcuts (desktop equivalent of call shortcuts: opens WhatsApp Web) ----------
async function renderShortcuts() {
  const map = await window.jarvis.store.get('aliases', {});
  const el = $('shortcutList'); el.innerHTML = '';
  const entries = Object.entries(map);
  if (!entries.length) { el.innerHTML = '<div class="empty-state">هنوز میانبری نداری.</div>'; return; }
  entries.forEach(([alias, number]) => {
    const row = document.createElement('div'); row.className = 'list-item';
    const left = document.createElement('span'); left.textContent = `${alias} → ${number}`;
    const openBtn = document.createElement('button'); openBtn.className = 'btn'; openBtn.textContent = 'باز کردن واتس‌اپ';
    openBtn.addEventListener('click', () => window.jarvis.shell.openExternal(`https://wa.me/${number.replace(/\D/g, '')}`));
    const del = document.createElement('button'); del.className = 'del'; del.textContent = '🗑';
    del.addEventListener('click', async () => { delete map[alias]; await window.jarvis.store.set('aliases', map); renderShortcuts(); });
    row.appendChild(left);
    const right = document.createElement('div'); right.className = 'row'; right.appendChild(openBtn); right.appendChild(del);
    row.appendChild(right);
    el.appendChild(row);
  });
}
$('addShortcutBtn').addEventListener('click', async () => {
  const alias = $('shortcutAlias').value.trim(); const number = $('shortcutNumber').value.trim();
  if (!alias || !number) return;
  const map = await window.jarvis.store.get('aliases', {});
  map[alias] = number;
  await window.jarvis.store.set('aliases', map);
  $('shortcutAlias').value = ''; $('shortcutNumber').value = '';
  renderShortcuts();
});

// ---------- settings ----------
async function loadSettings() {
  $('assistantName').value = await window.jarvis.store.get('assistantName', '');
  $('webOnToggle').checked = await window.jarvis.store.get('webOn', true);
  $('speakTypedToggle').checked = await window.jarvis.store.get('speakTyped', false);
  $('wakeToggle').checked = await window.jarvis.store.get('wakeOn', false);
  $('humorRange').value = await window.jarvis.store.get('humor', 40);
  updateWakeHint();
  refreshDevUI(await window.jarvis.store.get('devOk', false));
  renderMemory();
}
function updateWakeHint() {
  $('wakeHint').textContent = $('wakeToggle').checked
    ? 'جارویس توی پس‌زمینه گوش می‌ده. اگه مرورگر این کامپیوتر تشخیص گفتار نداشته باشه (محدودیت شناخته‌شده‌ی Electron)، به‌جاش می‌تونی تایپ کنی.'
    : '';
}
$('assistantName').addEventListener('change', (e) => window.jarvis.store.set('assistantName', e.target.value.slice(0, 20)));
$('webOnToggle').addEventListener('change', (e) => window.jarvis.store.set('webOn', e.target.checked));
$('speakTypedToggle').addEventListener('change', (e) => window.jarvis.store.set('speakTyped', e.target.checked));
$('humorRange').addEventListener('change', (e) => window.jarvis.store.set('humor', Number(e.target.value)));
$('wakeToggle').addEventListener('change', async (e) => {
  await window.jarvis.store.set('wakeOn', e.target.checked);
  updateWakeHint();
  await window.jarvis.tray.setWakeState(e.target.checked);
  $('wakeStatus').textContent = 'گوش‌به‌زنگ: ' + (e.target.checked ? 'روشن' : 'خاموش');
  if (e.target.checked) await window.jarvis.overlay.startWake(); else await window.jarvis.overlay.stopWake();
});

function refreshDevUI(on) {
  $('devLocked').style.display = on ? 'none' : 'block';
  $('devUnlocked').style.display = on ? 'block' : 'none';
}
$('devUnlockBtn').addEventListener('click', async () => {
  const ok = await window.jarvis.dev.verify($('devPin').value);
  if (ok) { await window.jarvis.store.set('devOk', true); $('devPin').value = ''; $('devMsg').textContent = ''; refreshDevUI(true); }
  else $('devMsg').textContent = 'رمز اشتباه است.';
});
$('devLockBtn').addEventListener('click', async () => { await window.jarvis.store.set('devOk', false); refreshDevUI(false); });
$('changeDevPinBtn').addEventListener('click', async () => {
  const v = $('newDevPin').value.trim();
  if (!v) return;
  await window.jarvis.dev.setPin(v);
  $('newDevPin').value = '';
  $('devMsg').style.color = '#4EE06A'; $('devMsg').textContent = 'رمز جدید ذخیره شد ✓';
});

function renderMemory() {
  window.jarvis.store.get('memory', []).then((memory) => {
    const el = $('memoryList'); el.innerHTML = '';
    memory.forEach((m, i) => {
      const row = document.createElement('div'); row.className = 'list-item';
      const left = document.createElement('span'); left.textContent = m;
      const del = document.createElement('button'); del.className = 'del'; del.textContent = '🗑';
      del.addEventListener('click', async () => { memory.splice(i, 1); await window.jarvis.store.set('memory', memory); renderMemory(); });
      row.appendChild(left); row.appendChild(del); el.appendChild(row);
    });
  });
}
$('memoryAddBtn').addEventListener('click', async () => {
  const v = $('memoryInput').value.trim(); if (!v) return;
  const devOk = await window.jarvis.store.get('devOk', false);
  const memory = await window.jarvis.store.get('memory', []);
  if (memory.length >= (devOk ? 50 : 5)) { alert('حافظه پره (نسخه‌ی دمو ۵ مورد).'); return; }
  memory.push(v); await window.jarvis.store.set('memory', memory);
  $('memoryInput').value = ''; renderMemory();
});

// ---------- TTS voices ----------
function speakText(text) {
  if (!window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(text);
  window.jarvis.store.get('ttsVoice', 'system-default').then((name) => {
    if (name && name !== 'system-default') {
      const v = window.speechSynthesis.getVoices().find((x) => x.name === name);
      if (v) u.voice = v;
    }
    window.speechSynthesis.speak(u);
  });
}
function loadVoiceList() {
  const voices = window.speechSynthesis.getVoices();
  const sel = $('voiceSelect'); sel.innerHTML = '';
  const def = document.createElement('option'); def.value = 'system-default'; def.textContent = 'بهینه / پیش‌فرض سیستم';
  sel.appendChild(def);
  voices.forEach((v) => { const o = document.createElement('option'); o.value = v.name; o.textContent = `${v.lang} — ${v.name}`; sel.appendChild(o); });
  window.jarvis.store.get('ttsVoice', 'system-default').then((v) => { sel.value = v; });
}
if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = loadVoiceList;
$('voiceSelect').addEventListener('change', (e) => window.jarvis.store.set('ttsVoice', e.target.value));

// ---------- startup ----------
async function boot() {
  renderProviderChips();
  const [provider, base, key, model] = await Promise.all([
    window.jarvis.store.get('provider', 'llm7'),
    window.jarvis.store.get('apiBase', PROVIDERS[0].base),
    window.jarvis.store.get('apiKey', ''),
    window.jarvis.store.get('apiModel', PROVIDERS[0].models[0]),
  ]);
  state.provider = PROVIDERS.find((p) => p.id === provider) || PROVIDERS[0];
  renderProviderChips();
  $('apiBase').value = base; $('apiKey').value = key; $('apiModel').value = model;

  state.convos = await window.jarvis.store.get('convos', []);
  if (!state.convos.length) newConvo(); else { state.activeConvoId = state.convos[0].id; renderHistory(); renderMessages(); }

  await loadSettings();
  renderShortcuts();
  loadVoiceList();

  const wakeOn = await window.jarvis.store.get('wakeOn', false);
  $('wakeStatus').textContent = 'گوش‌به‌زنگ: ' + (wakeOn ? 'روشن' : 'خاموش');
  await window.jarvis.tray.setWakeState(wakeOn);
  if (wakeOn) window.jarvis.overlay.startWake();

  if (!window.ChatCore.configured({ base, model })) switchScreen('setup');
}
window.jarvis.on('tray:toggleWake', () => { $('wakeToggle').click(); });
boot();
