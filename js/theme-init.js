// Erscheinungsbild vor dem ersten Zeichnen setzen (wie im Logbuch), sonst blitzt das falsche Schema auf.
// Als eigene Datei statt inline, damit die Content-Security-Policy ohne 'unsafe-inline' auskommt.
(() => {
  try {
    const stored = localStorage.getItem('tbv:theme');
    const dark = stored === 'dark' || ((stored === 'system' || stored === null) && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]').content = dark ? '#0b1220' : '#f5f7fa';
  } catch {
    document.documentElement.dataset.theme = 'dark';
  }
})();
