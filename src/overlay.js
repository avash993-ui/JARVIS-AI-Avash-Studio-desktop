const ovOrb = document.getElementById('ovOrb');
const ovStatus = document.getElementById('ovStatus');
const ovClose = document.getElementById('ovClose');

let busy = false;              // mirrors Wake.busy in the Android app
let assistantName = 'جارویس';
let wakeHandle = null;         // { stop() } from STT.startWakeLoop, when using Whisper
let legacyWakeOn = false;      // when falling back to the browser's own (unreliable) recognizer
let legacyRecognizer = null;
let legacyLang = 'fa-IR';
let legacyNetworkErrors = 0;
let warnedAboutSpeechLimit = false;

const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
const synth = window.speechSynthesis;

function setStatus(text, listening) {
  ovStatus.textContent = text;
  ovOrb.classList.toggle('listening', !!listening);
}

function speak(text, lang, onDone) {
  if (!synth || !text) { onDone && onDone(); return; }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang === 'en' ? 'en-US' : 'fa-IR';
  u.onend = () => onDone && onDone();
  u.onerror = () => onDone && onDone();
  synth.cancel();
  synth.speak(u);
}

// ========== PRIMARY PATH: real speech-to-text (Whisper via the main process) ==========
// Needs a free Groq key pasted into Settings -> "Speech recognition key". Local voice-activity
// detection (window.STT) means no audio is sent anywhere while the room is quiet -- only the
// burst of speech that was actually said gets uploaded and transcribed.
async function startWhisperWakeLoop() {
  setStatus('گوش می‌دم…', false);
  wakeHandle = await window.STT.startWakeLoop({
    lang: '',
    onHeard: (text) => {
      if (busy) return;
      if (window.Wake.matches(text, assistantName)) { onWakeDetected(); return; }
      // not the wake word -- treat it as background noise/conversation and keep listening quietly
    },
    onError: (err) => {
      setStatus('خطای میکروفون/STT: ' + (err && err.message || err), false);
    },
  });
}
function stopWhisperWakeLoop() {
  if (wakeHandle) { wakeHandle.stop(); wakeHandle = null; }
}

// ========== FALLBACK PATH: Chromium's built-in recognizer ==========
// Used only when no STT key is configured yet, so the app still does *something* out of the
// box. It relies on a Google-owned speech backend that Electron's bundled Chromium usually
// cannot reach, so expect it to be unreliable -- the Settings hint explains this and points at
// the Whisper path above.
function startLegacyWakeLoop() {
  if (!SpeechRecognitionCtor) {
    setStatus('این کامپیوتر نه تشخیص گفتار مرورگر داره نه کلید STT تنظیم‌شده. برو تنظیمات.', false);
    return;
  }
  legacyWakeOn = true;
  restartLegacyRecognizer();
}
function stopLegacyWakeLoop() {
  legacyWakeOn = false;
  if (legacyRecognizer) { try { legacyRecognizer.abort(); } catch {} legacyRecognizer = null; }
}
function restartLegacyRecognizer() {
  if (!legacyWakeOn || busy) return;
  if (legacyRecognizer) { try { legacyRecognizer.abort(); } catch {} }
  legacyRecognizer = new SpeechRecognitionCtor();
  legacyLang = legacyLang === 'fa-IR' ? 'en-US' : 'fa-IR';
  legacyRecognizer.lang = legacyLang;
  legacyRecognizer.continuous = true;
  legacyRecognizer.interimResults = true;
  legacyRecognizer.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const text = e.results[i][0].transcript;
      if (window.Wake.matches(text, assistantName)) {
        stopLegacyWakeLoop();
        onWakeDetected();
        return;
      }
    }
  };
  legacyRecognizer.onerror = (e) => {
    if (!legacyWakeOn) return;
    if (e.error === 'no-speech' || e.error === 'aborted') { setTimeout(restartLegacyRecognizer, 120); return; }
    if (e.error === 'not-allowed') { setStatus('اجازه‌ی میکروفون داده نشده.', false); legacyWakeOn = false; return; }
    if (e.error === 'network') {
      legacyNetworkErrors++;
      if (legacyNetworkErrors >= 5) {
        if (!warnedAboutSpeechLimit) {
          warnedAboutSpeechLimit = true;
          setStatus('تشخیص گفتار مرورگر روی این کامپیوتر کار نمی‌کنه. تو تنظیمات یه کلید STT (رایگان، Groq) بذار تا دقیق بشه.', false);
        }
        setTimeout(restartLegacyRecognizer, 15000);
        return;
      }
    }
    setTimeout(restartLegacyRecognizer, 800);
  };
  legacyRecognizer.onend = () => { if (legacyWakeOn) setTimeout(restartLegacyRecognizer, 100); };
  try { legacyRecognizer.start(); legacyNetworkErrors = 0; } catch { setTimeout(restartLegacyRecognizer, 500); }
}

// ========== shared entry points ==========
async function startWakeLoop() {
  if (await window.STT.sttKeyConfigured()) await startWhisperWakeLoop();
  else startLegacyWakeLoop();
}
function stopWakeLoop() {
  stopWhisperWakeLoop();
  stopLegacyWakeLoop();
}

// ---------- the actual conversation turn, after the name was heard ----------
async function onWakeDetected() {
  busy = true;
  stopLegacyWakeLoop(); // whisper loop pauses itself naturally (listenForCommand reuses the same mic graph)
  await window.jarvis.overlay.show();
  const lang = legacyLang === 'en-US' ? 'en' : 'fa';
  const hello = lang === 'en' ? 'Yes?' : 'بله؟';
  setStatus(hello, false);
  speak(hello, lang, () => listenForCommand(lang));
  setTimeout(() => listenForCommand(lang), 2500); // safety net if TTS's onend never fires
}

let commandStarted = false;
async function listenForCommand(lang) {
  if (commandStarted) return;
  commandStarted = true;
  setStatus(lang === 'en' ? 'Listening…' : 'گوش می‌دم…', true);
  try {
    let text = '';
    if (await window.STT.sttKeyConfigured()) {
      text = await window.STT.listenOnce({
        lang: lang === 'en' ? 'en' : 'fa',
        onThinking: () => setStatus(lang === 'en' ? 'Thinking…' : 'در حال فهمیدن…', false),
      });
    } else if (SpeechRecognitionCtor) {
      text = await legacyListenOnce(lang);
    }
    if (!text) { finishTurn(); return; }
    await handleCommand(text, lang);
  } catch (err) {
    setStatus((lang === 'en' ? 'Error: ' : 'خطا: ') + (err.message || err), false);
    setTimeout(finishTurn, 1800);
  }
}
function legacyListenOnce(lang) {
  return new Promise((resolve) => {
    const r = new SpeechRecognitionCtor();
    r.lang = lang === 'en' ? 'en-US' : 'fa-IR';
    r.continuous = false; r.interimResults = true;
    r.onresult = (e) => {
      const last = e.results[e.results.length - 1];
      if (last.isFinal) resolve(last[0].transcript);
      else setStatus(last[0].transcript, true);
    };
    r.onerror = () => resolve('');
    try { r.start(); } catch { resolve(''); }
  });
}

async function handleCommand(text, lang) {
  setStatus(text, false);
  try {
    const history = await window.jarvis.store.get('liveMessages', []);
    const answer = await window.ChatCore.ask(text, history);
    const act = window.Actions.parseAndStrip(answer);
    let finalText = act.clean || answer;
    if (act.name) {
      const r = await window.Actions.run(act.name, act.arg);
      finalText = (finalText ? finalText + ' ' : '') + (r && r.ok ? (lang === 'en' ? 'Done.' : 'انجام شد.') : (lang === 'en' ? "Couldn't do that." : 'نتونستم انجام بدم.'));
    }
    await window.ChatCore.appendHistory('user', text);
    await window.ChatCore.appendHistory('assistant', finalText);
    setStatus(finalText, false);
    speak(finalText, lang, finishTurn);
  } catch (err) {
    setStatus((lang === 'en' ? 'Error: ' : 'خطا: ') + (err.message || err), false);
    setTimeout(finishTurn, 1800);
  }
}

function finishTurn() {
  commandStarted = false;
  busy = false;
  // window.jarvis.overlay.show() left it visible with a close button -- resume the wake loop quietly.
  setTimeout(async () => {
    if (await window.STT.sttKeyConfigured()) { if (!wakeHandle) await startWhisperWakeLoop(); }
    else if (legacyWakeOn) restartLegacyRecognizer();
  }, 400);
}

// ---------- UI wiring ----------
// tap the orb itself to talk, same as saying the wake word (mirrors tapping the Siri bubble)
ovOrb.addEventListener('click', () => {
  if (busy) return;
  window.jarvis.overlay.show();
  onWakeDetected();
});
ovClose.addEventListener('click', () => {
  synth && synth.cancel();
  window.jarvis.overlay.hide();
});

// 100%-reliable manual trigger (Ctrl+Shift+J), in case the wake word itself gets missed
window.jarvis.on('wake:trigger', () => { if (!busy) { window.jarvis.overlay.show(); onWakeDetected(); } });

window.jarvis.on('wake:start', async () => {
  assistantName = await window.jarvis.store.get('assistantName', 'جارویس');
  await startWakeLoop();
});
window.jarvis.on('wake:stop', () => { stopWakeLoop(); window.jarvis.overlay.hide(); });

setStatus('آماده', false);
