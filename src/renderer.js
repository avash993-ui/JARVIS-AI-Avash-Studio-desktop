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
    chat: 'گفتگو با جارویس', setup: 'اتصال به هوش مصنوعی', settings: 'تنظیمات',
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
    if (m.attachments && m.attachments.length) {
      div.appendChild(buildAttachmentChips(m.attachments));
      if (m.text) div.appendChild(document.createElement('br'));
    }
    if (m.role === 'assistant') {
      const parts = window.Artifact.extract(m.text);
      if (parts.length) { div.appendChild(buildFileCards(parts)); div.appendChild(document.createElement('br')); }
      const chart = window.Artifact.extractChart(m.text);
      if (chart) { div.appendChild(buildChartCard(chart)); div.appendChild(document.createElement('br')); }
      const run = parseRunCommand(m.text);
      if (run) { div.appendChild(buildRunCard(run)); div.appendChild(document.createElement('br')); }
    }
    const shownText = m.role === 'assistant'
      ? stripRunLine(window.Artifact.stripChart(m.text))
      : m.text;
    if (shownText) div.appendChild(document.createTextNode(shownText));
    el.appendChild(div);
  });
  el.scrollTop = el.scrollHeight;
}

// ---------- attachment chips: shown instead of a raw "فایل‌ها: a.png، b.pdf" text line ----------
function buildAttachmentChips(files) {
  const wrap = document.createElement('div'); wrap.className = 'file-cards';
  files.forEach((f) => {
    const card = document.createElement('div'); card.className = 'file-card attach-chip';
    const icon = document.createElement('span'); icon.className = 'file-icon';
    icon.textContent = ['.png', '.jpg', '.jpeg', '.webp'].includes(f.ext) ? '🖼️' : iconFor(extOf(f.name));
    const name = document.createElement('span'); name.className = 'file-name'; name.textContent = f.name;
    card.appendChild(icon); card.appendChild(name);
    wrap.appendChild(card);
  });
  return wrap;
}

// ---------- inline chart card: renders a ```chart fenced block as a small canvas chart ----------
function buildChartCard(spec) {
  const card = document.createElement('div'); card.className = 'chart-card';
  if (spec.title) {
    const title = document.createElement('div'); title.className = 'chart-title'; title.textContent = spec.title;
    card.appendChild(title);
  }
  const canvas = document.createElement('canvas'); canvas.width = 420; canvas.height = 220;
  card.appendChild(canvas);
  drawChart(canvas, spec);
  return card;
}
function drawChart(canvas, spec) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, pad = 32;
  const labels = spec.labels || [];
  const values = (spec.values || []).map(Number);
  const max = Math.max(1, ...values);
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = '#2a3142'; ctx.beginPath();
  ctx.moveTo(pad, H - pad); ctx.lineTo(W - 10, H - pad); ctx.stroke();
  const type = (spec.type || 'bar').toLowerCase();
  const colors = ['#FFB300', '#4EE06A', '#3AB8FF', '#FF6B6B', '#C792EA', '#FFD54F'];
  if (type === 'line') {
    ctx.strokeStyle = colors[0]; ctx.lineWidth = 2; ctx.beginPath();
    values.forEach((v, i) => {
      const x = pad + (i * (W - pad - 20)) / Math.max(1, values.length - 1);
      const y = H - pad - (v / max) * (H - pad - 20);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  } else {
    const bw = (W - pad - 20) / Math.max(1, values.length);
    values.forEach((v, i) => {
      const h = (v / max) * (H - pad - 20);
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(pad + i * bw + 4, H - pad - h, bw - 8, h);
    });
  }
  ctx.fillStyle = '#9aa4b2'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
  labels.forEach((l, i) => {
    const x = pad + (i + 0.5) * ((W - pad - 20) / Math.max(1, labels.length));
    ctx.fillText(String(l).slice(0, 8), x, H - pad + 12);
  });
}

// ---------- file cards: a download button per file, like Claude's file cards ----------
function extOf(name) { const i = name.lastIndexOf('.'); return i >= 0 ? name.slice(i + 1).toLowerCase() : ''; }
function iconFor(ext) {
  return { js: '📜', ts: '📜', py: '🐍', json: '🧩', md: '📝', html: '🌐', css: '🎨', kt: '📦', java: '📦', txt: '📄', csv: '📊' }[ext] || '📄';
}
function buildFileCards(parts) {
  const wrap = document.createElement('div'); wrap.className = 'file-cards';
  parts.forEach((p) => {
    const card = document.createElement('div'); card.className = 'file-card';
    const icon = document.createElement('span'); icon.className = 'file-icon'; icon.textContent = iconFor(extOf(p.name));
    const name = document.createElement('span'); name.className = 'file-name'; name.textContent = p.name;
    const dl = document.createElement('button'); dl.className = 'btn file-dl'; dl.textContent = '⬇ دانلود';
    dl.addEventListener('click', () => window.jarvis.files.saveOne({ suggestedName: p.name, content: p.body }));
    card.appendChild(icon); card.appendChild(name); card.appendChild(dl);
    wrap.appendChild(card);
  });
  if (parts.length > 1) {
    const allBtn = document.createElement('button'); allBtn.className = 'btn gold'; allBtn.style.marginTop = '6px';
    allBtn.textContent = '📦 دانلود همه (zip)';
    allBtn.addEventListener('click', () => window.jarvis.files.exportZip({ suggestedName: 'jarvis-project.zip', parts }));
    wrap.appendChild(allBtn);
  }
  return wrap;
}

// ---------- local build/run: only if the user turned it on in Settings, and only after they click "اجرا" ----------
const runLineRe = /^\s*RUN:\s*(.+)$/im;
function parseRunCommand(text) { const m = runLineRe.exec(text); return m ? m[1].trim() : null; }
function stripRunLine(text) { return text.replace(runLineRe, '').trim(); }
function buildRunCard(command) {
  const card = document.createElement('div'); card.className = 'run-card';
  const label = document.createElement('div'); label.className = 'run-label'; label.textContent = 'پیشنهاد اجرای دستور روی لپ‌تاپت:';
  const code = document.createElement('code'); code.className = 'run-cmd'; code.textContent = command;
  const out = document.createElement('pre'); out.className = 'run-out'; out.style.display = 'none';
  const row = document.createElement('div'); row.className = 'row';
  const runBtn = document.createElement('button'); runBtn.className = 'btn gold'; runBtn.textContent = '▶ اجرا کن';
  const cancelBtn = document.createElement('button'); cancelBtn.className = 'btn'; cancelBtn.textContent = 'نه، اجرا نشه';
  row.appendChild(runBtn); row.appendChild(cancelBtn);
  card.appendChild(label); card.appendChild(code); card.appendChild(row); card.appendChild(out);
  cancelBtn.addEventListener('click', () => { row.remove(); label.textContent = 'اجرا نشد.'; });
  runBtn.addEventListener('click', async () => {
    runBtn.disabled = true; runBtn.textContent = window.I18N.t('run_running');
    const cwd = await window.jarvis.store.get('buildFolder', '');
    const r = await window.jarvis.exec.run({ command, cwd });
    out.style.display = 'block';
    out.textContent = (r.stdout || '') + (r.stderr ? '\n' + r.stderr : '') || (r.ok ? window.I18N.t('run_no_output') : window.I18N.t('run_error'));
    runBtn.textContent = r.ok ? window.I18N.t('run_done') : window.I18N.t('run_failed');
  });
  return card;
}

// ---------- safe OS actions (open app/url/folder/settings) — run automatically, no confirmation ----------
async function runAnyAction(answer) {
  const act = window.Actions.parseAndStrip(answer);
  if (!act.name) return act.clean || answer;
  const r = await window.Actions.run(act.name, act.arg);
  const tag = r && r.ok ? window.I18N.t('action_done') : window.I18N.t('action_failed');
  return (act.clean ? act.clean + '\n' : '') + tag;
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
// Prefers real Whisper transcription (window.STT, needs a free STT key in Settings — accurate,
// and automatically stops recording once you stop talking). Falls back to the browser's own
// recognizer, which is unreliable in Electron, only if no STT key has been set yet.
const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
let micRecognizer = null, micOn = false;
$('micBtn').addEventListener('click', async () => {
  if (micOn) return;
  if (await window.STT.sttKeyConfigured()) {
    micOn = true; $('micBtn').classList.add('active');
    try {
      const text = await window.STT.listenOnce({
        onThinking: () => { $('micBtn').textContent = '⏳'; },
      });
      if (text) sendMessage(text);
    } catch {}
    micOn = false; $('micBtn').classList.remove('active'); $('micBtn').textContent = '🎙';
    return;
  }
  if (!SpeechRecognitionCtor) { alert('مرورگر این کامپیوتر از تشخیص گفتار پشتیبانی نمی‌کنه. تو تنظیمات یه کلید STT بذار.'); return; }
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
  let c = activeConvo(); if (!c) { newConvo(); c = activeConvo(); }
  c.msgs.push({ role: 'user', text: '', attachments: files.map((f) => ({ name: f.name, ext: f.ext })) });
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
    c.textContent = p.name || window.I18N.t('provider_custom');
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

// ---------- settings ----------
async function loadSettings() {
  $('assistantName').value = await window.jarvis.store.get('assistantName', '');
  $('sttKey').value = await window.jarvis.store.get('sttKey', '');
  $('webOnToggle').checked = await window.jarvis.store.get('webOn', true);
  $('speakTypedToggle').checked = await window.jarvis.store.get('speakTyped', false);
  $('wakeToggle').checked = await window.jarvis.store.get('wakeOn', false);
  $('allowExecToggle').checked = await window.jarvis.store.get('allowExec', false);
  $('buildFolderRow').style.display = $('allowExecToggle').checked ? 'block' : 'none';
  $('buildFolderPath').value = await window.jarvis.store.get('buildFolder', '');
  $('humorRange').value = await window.jarvis.store.get('humor', 40);
  updateWakeHint();
  refreshDevUI(await window.jarvis.store.get('devOk', false));
  renderMemory();
}
function updateWakeHint() {
  if (!$('wakeToggle').checked) { $('wakeHint').textContent = ''; return; }
  $('wakeHint').textContent = $('sttKey').value.trim()
    ? 'جارویس با Whisper توی پس‌زمینه گوش می‌ده؛ فقط وقتی صدایی هست چیزی آپلود می‌شه.'
    : 'یه کلید STT بالا نذاشتی، پس روی تشخیص گفتار خودِ مرورگر می‌افته که معمولاً تو Electron کار نمی‌کنه.';
}
$('assistantName').addEventListener('change', (e) => window.jarvis.store.set('assistantName', e.target.value.slice(0, 20)));
$('sttKey').addEventListener('change', (e) => { window.jarvis.store.set('sttKey', e.target.value.trim()); updateWakeHint(); });
$('webOnToggle').addEventListener('change', (e) => window.jarvis.store.set('webOn', e.target.checked));
$('speakTypedToggle').addEventListener('change', (e) => window.jarvis.store.set('speakTyped', e.target.checked));
$('humorRange').addEventListener('change', (e) => window.jarvis.store.set('humor', Number(e.target.value)));
$('allowExecToggle').addEventListener('change', async (e) => {
  await window.jarvis.store.set('allowExec', e.target.checked);
  $('buildFolderRow').style.display = e.target.checked ? 'block' : 'none';
});
$('pickFolderBtn').addEventListener('click', async () => {
  const folder = await window.jarvis.files.pickFolder();
  if (folder) { $('buildFolderPath').value = folder; await window.jarvis.store.set('buildFolder', folder); }
});
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
  const def = document.createElement('option'); def.value = 'system-default'; def.textContent = window.I18N.t('voice_default');
  sel.appendChild(def);
  voices.forEach((v) => { const o = document.createElement('option'); o.value = v.name; o.textContent = `${v.lang} — ${v.name}`; sel.appendChild(o); });
  window.jarvis.store.get('ttsVoice', 'system-default').then((v) => { sel.value = v; });
}
if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = loadVoiceList;
$('voiceSelect').addEventListener('change', (e) => window.jarvis.store.set('ttsVoice', e.target.value));

// ---------- language ----------
$('uiLangSelect').addEventListener('change', async (e) => {
  await window.jarvis.store.set('uiLang', e.target.value);
  window.I18N.apply(e.target.value);
  // re-render parts built dynamically in JS (data-i18n only covers static markup)
  renderProviderChips(); renderHistory(); renderMessages(); renderMemory(); loadVoiceList();
  $('wakeStatus').textContent = window.I18N.t($('wakeToggle').checked ? 'wake_on' : 'wake_off');
  updateWakeHint();
});

// ---------- startup ----------
async function boot() {
  const uiLang = await window.jarvis.store.get('uiLang', 'en');
  window.I18N.apply(uiLang);
  $('uiLangSelect').value = uiLang;
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
  loadVoiceList();

  const wakeOn = await window.jarvis.store.get('wakeOn', false);
  $('wakeStatus').textContent = 'گوش‌به‌زنگ: ' + (wakeOn ? 'روشن' : 'خاموش');
  await window.jarvis.tray.setWakeState(wakeOn);
  if (wakeOn) window.jarvis.overlay.startWake();

  if (!window.ChatCore.configured({ base, model })) switchScreen('setup');
}
window.jarvis.on('tray:toggleWake', () => { $('wakeToggle').click(); });
boot();
