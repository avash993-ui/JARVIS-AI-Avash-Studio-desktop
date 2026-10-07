const ovOrb = document.getElementById('ovOrb');
const ovStatus = document.getElementById('ovStatus');
const ovClose = document.getElementById('ovClose');

let recognizer = null;
let wakeLoopOn = false;
let busy = false;           // mirrors Wake.busy in the Android app
let wakeLang = 'fa-IR';     // alternates fa/en each restart, same idea as WakeService
let consecutiveNetworkErrors = 0;
let warnedAboutSpeechLimit = false;
let assistantName = 'جارویس';

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

// ---------- background wake-word loop ----------
function startWakeLoop() {
  if (!SpeechRecognitionCtor) {
    setStatus('مرورگر این کامپیوتر از تشخیص گفتار پشتیبانی نمی‌کنه.', false);
    return;
  }
  wakeLoopOn = true;
  restartWakeRecognizer();
}
function stopWakeLoop() {
  wakeLoopOn = false;
  if (recognizer) { try { recognizer.abort(); } catch {} recognizer = null; }
}
function restartWakeRecognizer() {
  if (!wakeLoopOn || busy) return;
  if (recognizer) { try { recognizer.abort(); } catch {} }
  recognizer = new SpeechRecognitionCtor();
  wakeLang = wakeLang === 'fa-IR' ? 'en-US' : 'fa-IR';   // say the name in Persian or English
  recognizer.lang = wakeLang;
  // continuous + interim: check every partial transcript as it arrives, instead of waiting for a
  // pause in speech. This is the single biggest lever for cutting missed wake-word detections,
  // without adding any real build/runtime cost.
  recognizer.continuous = true;
  recognizer.interimResults = true;
  recognizer.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const text = e.results[i][0].transcript;
      if (window.Wake.matches(text, assistantName)) {
        stopWakeLoop();
        onWakeDetected();
        return;
      }
    }
  };
  recognizer.onerror = (e) => {
    if (!wakeLoopOn) return;
    // "no-speech" / "aborted" are NORMAL while waiting for the name: retry immediately, no backoff.
    if (e.error === 'no-speech' || e.error === 'aborted') { setTimeout(restartWakeRecognizer, 120); return; }
    if (e.error === 'not-allowed') { setStatus('اجازه‌ی میکروفون داده نشده.', false); wakeLoopOn = false; return; }
    if (e.error === 'network') {
      consecutiveNetworkErrors++;
      // Electron's built-in Chromium lacks Google's speech-recognition backend key, so this
      // can fail on every attempt on some machines. Don't spam retries forever in that case.
      if (consecutiveNetworkErrors >= 5) {
        if (!warnedAboutSpeechLimit) {
          warnedAboutSpeechLimit = true;
          setStatus('تشخیص گفتار روی این کامپیوتر در دسترس نیست (محدودیت شناخته‌شده‌ی Electron). از تایپ استفاده کن.', false);
        }
        setTimeout(restartWakeRecognizer, 15000);
        return;
      }
    }
    setTimeout(restartWakeRecognizer, 800);
  };
  recognizer.onend = () => { if (wakeLoopOn) setTimeout(restartWakeRecognizer, 100); };
  try { recognizer.start(); consecutiveNetworkErrors = 0; } catch { setTimeout(restartWakeRecognizer, 500); }
}

// ---------- the actual conversation turn, after the name was heard ----------
async function onWakeDetected() {
  busy = true;
  await window.jarvis.overlay.show();
  const lang = wakeLang === 'en-US' ? 'en' : 'fa';
  const hello = lang === 'en' ? 'Yes?' : 'بله؟';
  setStatus(hello, false);
  speak(hello, lang, () => listenForCommand(lang, true));
  // safety net: never stay silent forever even if TTS callback never fires
  setTimeout(() => listenForCommand(lang, true), 2500);
}

let commandStarted = false;
function listenForCommand(lang, waitSilently) {
  if (commandStarted) return;
  commandStarted = true;
  if (!SpeechRecognitionCtor) { finishTurn(); return; }
  const r = new SpeechRecognitionCtor();
  r.lang = lang === 'en' ? 'en-US' : 'fa-IR';
  r.continuous = false; r.interimResults = true;
  setStatus(lang === 'en' ? 'Listening…' : 'گوش می‌دم…', true);
  r.onresult = (e) => {
    const last = e.results[e.results.length - 1];
    if (last.isFinal) handleCommand(last[0].transcript, lang);
    else setStatus(last[0].transcript, true);   // live partial transcript, feels more responsive
  };
  r.onerror = (e) => {
    if (waitSilently && (e.error === 'no-speech' || e.error === 'aborted')) { finishTurn(); return; }
    setStatus(lang === 'en' ? "Didn't catch that." : 'نشنیدم، دوباره امتحان کن.', false);
    setTimeout(finishTurn, 1500);
  };
  try { r.start(); } catch { finishTurn(); }
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
  // window.jarvis.overlay.show() left it visible with a close button — resume the wake loop quietly.
  if (wakeLoopOn) setTimeout(restartWakeRecognizer, 400);
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

// 100%-reliable manual trigger (Ctrl+Shift+J), in case speech recognition mis-hears the wake word
window.jarvis.on('wake:trigger', () => { if (!busy) { window.jarvis.overlay.show(); onWakeDetected(); } });

window.jarvis.on('wake:start', async () => {
  assistantName = await window.jarvis.store.get('assistantName', 'جارویس');
  startWakeLoop();
});
window.jarvis.on('wake:stop', () => { stopWakeLoop(); window.jarvis.overlay.hide(); });

setStatus('آماده', false);
