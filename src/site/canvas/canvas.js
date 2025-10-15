// canvas.js
class CanvasApp {
  constructor(container, world) {
    this.container = container;
    this.world = world;

    // camera / view state
    this.scale = 1;
    this.minScale = 0.25;
    this.maxScale = 2.5;
    this.cameraX = 0;
    this.cameraY = 0;

    // interaction state
    this.isPanning = false;
    this.panStart = { x: 0, y: 0 };
    this.cameraStart = { x: 0, y: 0 };

    // data
    this.data = { items: [] };
    this.cardEls = new Map();

    // bindings
    this._onWheel = this._onWheel.bind(this);
    this._onMouseDownBg = this._onMouseDownBg.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);

    // listeners
    container.addEventListener('wheel', this._onWheel, { passive: false });
    container.addEventListener('mousedown', this._onMouseDownBg);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mouseup', this._onMouseUp);

    // initial render
    this._applyView();
  }

  async load(url) {
    const res = await fetch(url);
    this.data = await res.json();
    this.render();
  }

  setData(data) {
    this.data = JSON.parse(JSON.stringify(data));
    this.render();
  }

  getData() {
    // read current positions from DOM before exporting
    for (const item of this.data.items) {
      const el = this.cardEls.get(item.id);
      if (el) {
        const { left, top } = el._modelPos;
        item.x = left;
        item.y = top;
      }
    }
    return this.data;
  }

  // ===== RENDER CARDS =====
  render() {
    this.world.innerHTML = '';
    this.cardEls.clear();
    for (const item of this.data.items) {
      const el = this._createCardEl(item);
      this.world.appendChild(el);
      this.cardEls.set(item.id, el);
    }
    this._applyView();
  }

  _createCardEl(item) {
    const el = document.createElement('div');
    el.className = 'card';
    el.style.left = `${item.x}px`;
    el.style.top = `${item.y}px`;
    el._modelPos = { left: item.x, top: item.y };
    el._drag = null;

    el.innerHTML = `
      <div class="drag-handle" title="Drag"></div>
      <h3>${this._escape(item.title)}</h3>
      <p>${this._escape(item.description || '')}</p>
    `;

    const handle = el.querySelector('.drag-handle');
    handle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      const worldPt = this._toWorld(e.clientX, e.clientY);
      el._drag = {
        startWorld: worldPt,
        startLeft: el._modelPos.left,
        startTop: el._modelPos.top
      };
      el.classList.add('dragging');
    });

    return el;
  }

  // ===== VIEW / CAMERA =====
  _applyView() {
    this.world.style.transform =
      `translate(${this.cameraX}px, ${this.cameraY}px) scale(${this.scale})`;

    const zoomLabel = document.getElementById('zoom-level');
    if (zoomLabel) zoomLabel.textContent = `${Math.round(this.scale * 100)}%`;
  }

  resetView() {
    this.scale = 1;
    this.cameraX = 0;
    this.cameraY = 0;
    this._applyView();
  }

  _onWheel(e) {
    e.preventDefault();
    const delta = Math.sign(e.deltaY);
    const zoomFactor = 1.07;
    const targetScale = delta > 0 ? this.scale / zoomFactor : this.scale * zoomFactor;
    const newScale = Math.min(this.maxScale, Math.max(this.minScale, targetScale));

    // zoom around cursor
    const before = this._toWorld(e.clientX, e.clientY);
    this.scale = newScale;
    const after = this._toWorld(e.clientX, e.clientY);
    this.cameraX += (after.x - before.x) * this.scale;
    this.cameraY += (after.y - before.y) * this.scale;

    this._applyView();
  }

  _onMouseDownBg(e) {
    if (e.button !== 0) return; // left button
    // if user clicked a card handle, card will stop propagation; otherwise, pan
    this.isPanning = true;
    this.container.classList.add('panning');
    this.panStart = { x: e.clientX, y: e.clientY };
    this.cameraStart = { x: this.cameraX, y: this.cameraY };
  }

  _onMouseMove(e) {
    // dragging a card?
    const dragCard = [...this.cardEls.values()].find(el => el._drag);
    if (dragCard) {
      const worldPt = this._toWorld(e.clientX, e.clientY);
      const d = dragCard._drag;
      dragCard._modelPos.left = d.startLeft + (worldPt.x - d.startWorld.x);
      dragCard._modelPos.top  = d.startTop  + (worldPt.y - d.startWorld.y);
      dragCard.style.left = `${dragCard._modelPos.left}px`;
      dragCard.style.top  = `${dragCard._modelPos.top}px`;
      return;
    }

    // panning?
    if (!this.isPanning) return;
    const dx = e.clientX - this.panStart.x;
    const dy = e.clientY - this.panStart.y;
    this.cameraX = this.cameraStart.x + dx;
    this.cameraY = this.cameraStart.y + dy;
    this._applyView();
  }

  _onMouseUp() {
    this.isPanning = false;
    this.container.classList.remove('panning');
    // stop any card drag
    for (const el of this.cardEls.values()) {
      if (el._drag) {
        el._drag = null;
        el.classList.remove('dragging');
      }
    }
  }

  // ===== UTILS =====
  _toWorld(clientX, clientY) {
    const rect = this.container.getBoundingClientRect();
    const x = (clientX - rect.left - this.cameraX) / this.scale;
    const y = (clientY - rect.top  - this.cameraY) / this.scale;
    return { x, y };
  }

  _escape(s) {
    return String(s).replace(/[&<>"']/g, m => (
      { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[m]
    ));
  }
}

window.CanvasApp = CanvasApp;
