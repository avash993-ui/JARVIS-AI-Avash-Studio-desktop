// Shared by index.html (full chat) and overlay.html (wake conversations), so a wake turn
// and a typed turn behave identically — mirrors how JarvisViewModel.send() is the single
// code path for both in the Android app.
window.ChatCore = (function () {
  async function loadCfg() {
    const [base, key, model, assistantName, humor, lang, memory, devOk] = await Promise.all([
      window.jarvis.store.get('apiBase', ''),
      window.jarvis.store.get('apiKey', ''),
      window.jarvis.store.get('apiModel', ''),
      window.jarvis.store.get('assistantName', 'جارویس'),
      window.jarvis.store.get('humor', 40),
      window.jarvis.store.get('lang', 'fa'),
      window.jarvis.store.get('memory', []),
      window.jarvis.store.get('devOk', false),
    ]);
    return { base, key, model, assistantName, humor, lang, memory, devOk };
  }

  function configured(cfg) { return !!(cfg.base && cfg.model); }

  async function ask(question, history) {
    const cfg = await loadCfg();
    if (!configured(cfg)) throw new Error('اول باید یه هوش مصنوعی (API) وصل کنی.');
    const system = window.Persona.buildSystemPrompt(cfg);
    const messages = [{ role: 'system', content: system }];
    (history || []).slice(-10).forEach((m) => messages.push({ role: m.role, content: m.text }));
    messages.push({ role: 'user', content: question });
    const answer = await window.jarvis.api.chat({
      base: cfg.base, key: cfg.key, model: cfg.model, messages,
      maxTokens: cfg.devOk ? 600 : 380,
    });
    return answer;
  }

  async function appendHistory(role, text) {
    const list = await window.jarvis.store.get('liveMessages', []);
    list.push({ role, text, t: Date.now() });
    await window.jarvis.store.set('liveMessages', list.slice(-200));
    return list;
  }

  return { loadCfg, configured, ask, appendHistory };
})();
