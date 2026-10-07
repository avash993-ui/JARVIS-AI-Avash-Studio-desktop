// Ported (simplified) from engine/Persona.kt
window.Persona = (function () {
  function humorLine(humor) {
    if (humor >= 70) return 'لحنت شوخ و بامزه‌ست، گاهی یه طعنه‌ی سبک می‌زنی، ولی هیچ‌وقت جواب درست رو فدای شوخی نمی‌کنی.';
    if (humor >= 35) return 'لحنت دوستانه و کمی گرمه، نه خیلی جدی نه خیلی شوخ.';
    return 'لحنت مودب، مستقیم و حرفه‌ایه.';
  }

  function buildSystemPrompt({ assistantName, humor, lang, memory }) {
    const name = assistantName || 'جارویس';
    const langLine = lang === 'en'
      ? 'Reply in English unless the user writes in another language; then match their language.'
      : 'به زبانی که کاربر پیام داده جواب بده (پیش‌فرض فارسی).';
    const mem = (memory && memory.length) ? `\nچیزهایی که باید دربارهٔ کاربر به‌خاطر داشته باشی:\n- ${memory.join('\n- ')}` : '';
    return [
      `اسمت «${name}»ه، یه دستیار هوشمند روی کامپیوتر کاربر، شبیه جارویس تو آیرون‌من.`,
      humorLine(humor ?? 40),
      langLine,
      'جواب‌ها رو کوتاه و مفید نگه دار مگراینکه کاربر جزئیات بیشتر بخواد.',
      mem,
    ].filter(Boolean).join('\n');
  }

  return { buildSystemPrompt };
})();
