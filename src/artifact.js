// Ported from data/ArtifactWriter.kt
window.Artifact = (function () {
  const block = /```[A-Za-z0-9_+.-]*\s*\n([\s\S]*?)```/g;
  const fileNameRe = /^\s*(?:\/\/|#|\/\*)\s*FILE:\s*([^*\n]+?)(?:\*\/)?\s*$/im;
  function safe(s) { return (s || '').replace(/[\\/:*?"<>|]/g, '_').trim() || 'file.txt'; }

  function extract(text) {
    const out = [];
    let m, i = 0;
    while ((m = block.exec(text))) {
      let body = m[1].replace(/\s+$/, '');
      const header = fileNameRe.exec(body);
      const name = (header ? header[1].trim() : '') || `jarvis_output_${++i}.txt`;
      if (header) body = body.slice(0, header.index) + body.slice(header.index + header[0].length);
      body = body.replace(/^\s+/, '');
      if (body.trim()) out.push({ name: safe(name), body });
    }
    block.lastIndex = 0;
    return out;
  }

  // ---------- ```chart fenced JSON block -> drawn inline as a small bar/line chart ----------
  // Expected shape: {"type":"bar"|"line","title":"...","labels":["a","b"],"values":[1,2]}
  const chartBlock = /```chart\s*\n([\s\S]*?)```/i;
  function extractChart(text) {
    const m = chartBlock.exec(text);
    if (!m) return null;
    try {
      const spec = JSON.parse(m[1]);
      if (!Array.isArray(spec.values) || !spec.values.length) return null;
      return spec;
    } catch { return null; }
  }
  function stripChart(text) { return text.replace(chartBlock, '').trim(); }

  return { extract, extractChart, stripChart };
})();
