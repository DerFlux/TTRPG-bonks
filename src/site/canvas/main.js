// main.js
(async function () {
  const container = document.getElementById('canvas-container');
  const world = document.getElementById('world');
  const app = new CanvasApp(container, world);

  // Load initial data
  try {
    await app.load('data.json');
  } catch (err) {
    console.error('Failed to load data.json', err);
    // Fallback to empty canvas
    app.setData({ items: [] });
  }

  // UI: Reset view
  document.getElementById('btn-reset').addEventListener('click', () => {
    app.resetView();
  });

  // UI: Save current layout → download JSON
  document.getElementById('btn-save').addEventListener('click', () => {
    const data = app.getData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: 'data.json'
    });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
})();
