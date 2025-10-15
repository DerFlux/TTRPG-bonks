:root {
  --bg: #0f1020;
  --grid: #1b1d36;
  --card: #17192b;
  --card-border: #2a2d4a;
  --card-text: #e7e9ff;
  --accent: #7aa2ff;
}

* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; font-family: system-ui, Segoe UI, Roboto, Arial, sans-serif; background: var(--bg); color: var(--card-text); }

.toolbar {
  position: fixed; inset: 12px auto auto 12px;
  display: flex; gap: 8px; align-items: center;
  background: rgba(15,16,32,0.8); backdrop-filter: blur(6px);
  border: 1px solid #222547; border-radius: 12px;
  padding: 8px 10px; z-index: 10;
}

.toolbar .spacer { width: 16px; display: inline-block; }

.toolbar button {
  background: var(--card);
  color: var(--card-text);
  border: 1px solid var(--card-border);
  border-radius: 8px;
  padding: 6px 10px;
  cursor: pointer;
}
.toolbar button:hover { border-color: var(--accent); }

#canvas-container {
  position: absolute; inset: 0;
  overflow: hidden; cursor: grab;
  background:
    radial-gradient(circle at 30% 20%, rgba(255,255,255,0.03), transparent 400px),
    linear-gradient(90deg, var(--grid) 1px, transparent 1px) 0 0/40px 40px,
    linear-gradient(0deg, var(--grid) 1px, transparent 1px) 0 0/40px 40px;
}
#canvas-container.panning { cursor: grabbing; }

#world {
  position: absolute; left: 0; top: 0;
  transform-origin: 0 0;
}

.card {
  position: absolute;
  min-width: 180px; max-width: 320px;
  padding: 10px 12px;
  border: 1px solid var(--card-border);
  background: var(--card);
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.25);
  user-select: none;
}

.card h3 {
  margin: 0 0 6px 0; font-size: 16px; color: #cfd6ff;
}
.card p { margin: 0; font-size: 14px; line-height: 1.35; color: #bcc3ff; }

.card .drag-handle {
  position: absolute; inset: -6px -6px auto auto;
  width: 18px; height: 18px; border-radius: 50%;
  background: var(--accent); opacity: 0.9;
  cursor: grab; box-shadow: 0 4px 10px rgba(122,162,255,.4);
}
.card.dragging .drag-handle { cursor: grabbing; }
