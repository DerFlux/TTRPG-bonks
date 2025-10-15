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
    this.data = { items: [], edges: [] };
    this.cardEls = new Map();   // nodeId -> HTMLElement
    this.edgeEls = new Map();   // edgeId -> { path, label }

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
    window.addEventListener('resize', () => this._updateAllEdges());

    // SVG layer for edges
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    this.svg.setAttribute('style', 'position:absolute;left:0;top:0;overflow:visible;pointer-events:none;');
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.setAttribute('id', 'arrowhead');
    marker.setAttribute('markerWidth', '10');
    marker.setAttribute('markerHeight', '7');
    marker.setAttribute('refX', '10');
    marker.setAttribute('refY', '3.5');
    marker.setAttribute('orient', 'auto');
    const arrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    arrowPath.setAttribute('d', 'M0,0 L10,3.5 L0,7 Z');
    arrowPath.setAttribute('fill', '#6e7aff');
    marker.appendChild(arrowPath);
    defs.appendChild(marker);
    this.svg.appendChild(defs);
    this.world.insertAdjacentElement('afterbegin', this.svg);

    // initial render
    this._applyView();
  }

  async load(url) {
    const res = await fetch(url);
    this.data = await res.json();
    this.render();
  }

  setData(data) {
    this.data = JSON.parse(JSON.stringify(data || {}));
    if (!this.data.items) this.data.items = [];
    if (!this.data.edges) this.data.edges = [];
    this.render();
  }

  getData() {
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

  // ===== RENDER =====
  render() {
    this.world.querySelectorAll('.card').forEach(n => n.remove());
    this.cardEls.clear();

    for (const item of this.data.items) {
      const el = this._createCardEl(item);
      this.world.appendChild(el);
      this.cardEls.set(item.id, el);
    }

    this._renderEdges();
    this._applyView();
  }

  _createCardEl(item) {
    const el = document.createElement('div');
    el.className = 'card';
    el.style.left = `${item.x}px`;
    el.style.top  = `${item.y}px`;
    el._modelPos = { left: item.x, top: item.y };
    el._drag = null;
    el._itemId = item.id; // allow main.js to attach badges to the right card

    const candidates = Array.isArray(item.imageCandidates) && item.imageCandidates.length
      ? item.imageCandidates.slice()
      : (item.image ? [item.image] : []);

    const imgHtml = candidates.length
      ? `<div style="margin:-6px -6px 8px -6px; overflow:hidden; border-radius:10px;">
           <img data-role="card-img" src="${this._escape(candidates[0])}" alt=""
                decoding="async" loading="lazy"
                style="display:block; max-width:100%; height:auto;" />
         </div>`
      : '';

    const safeTitle = this._escape(item.title || 'Untitled');
    const titleHtml = item.link
      ? `<h3><a href="${this._escape(item.link)}" target="_blank" rel="noopener">${safeTitle}</a></h3>`
      : `<h3>${safeTitle}</h3>`;

    const safeDesc = this._escape(item.description || '');

    el.innerHTML = `
      <div class="drag-handle" title="Drag"></div>
      ${imgHtml}
      ${titleHtml}
      ${safeDesc ? `<p>${safeDesc}</p>` : ``}
    `;

    if (candidates.length) {
      const imgEl = el.querySelector('img[data-role="card-img"]');
      let idx = 0;
      imgEl.addEventListener('error', () => {
        // only log/mark when debugging is enabled
        const debugOn = document.documentElement.classList.contains('canvas-debug');
        if (idx + 1 < candidates.length) {
          if (debugOn) console.warn('Image failed, trying next:', candidates[idx]);
          idx += 1;
          imgEl.src = candidates[idx];
        } else {
          if (debugOn) {
            console.error('All image candidates failed for', (item.title || item.id), candidates);
            const badge = document.createElement('div');
            badge.textContent = 'IMG 404';
            badge.style.cssText =
              'position:absolute;top:8px;right:8px;background:#c0392b;color:#fff;' +
              'font:bold 11px/1.6 monospace;padding:2px 6px;border-radius:6px;';
            el.appendChild(badge);
          }
        }
      });
    }

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

  // ===== EDGES (arrows) =====
  _renderEdges() {
    this.svg.querySelectorAll('g.edge').forEach(n => n.remove());
    this.edgeEls.clear();

    for (const edge of this.data.edges) {
      const fromEl = this.cardEls.get(edge.from) || this.cardEls.get(edge.fromNode);
      const toEl   = this.cardEls.get(edge.to)   || this.cardEls.get(edge.toNode);
      if (!fromEl || !toEl) continue;

      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'edge');

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', '#6e7aff');
      path.setAttribute('stroke-width', '2');
      path.setAttribute('marker-end', 'url(#arrowhead)');
      g.appendChild(path);

      let labelEl = null;
      if (edge.label) {
        labelEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        labelEl.setAttribute('font-size', '12');
        labelEl.setAttribute('fill', '#9aa3ff');
        labelEl.setAttribute('text-anchor', 'middle');
        labelEl.textContent = edge.label;
        g.appendChild(labelEl);
      }

      this.svg.appendChild(g);
      this.edgeEls.set(edge.id || `${edge.from}-${edge.to}`, { path, label: labelEl, edge });
      this._updateEdgeGeometry(fromEl, toEl, { path, label: labelEl, edge });
    }
  }

  _updateAllEdges() {
    for (const { path, label, edge } of this.edgeEls.values()) {
      const fromEl = this.cardEls.get(edge.from) || this.cardEls.get(edge.fromNode);
      const toEl   = this.cardEls.get(edge.to)   || this.cardEls.get(edge.toNode);
      if (!fromEl || !toEl) continue;
      this._updateEdgeGeometry(fromEl, toEl, { path, label, edge });
    }
  }

  _updateEdgeGeometry(fromEl, toEl, refs) {
    const { path, label, edge } = refs;

    const a = this._anchorPoint(fromEl, edge.fromSide || edge.fromAnchor || 'auto');
    const b = this._anchorPoint(toEl,   edge.toSide   || edge.toAnchor   || 'auto');

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const cx = a.x + dx * 0.5;
    const cy = a.y + dy * 0.5;

    const d = `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`;
    path.setAttribute('d', d);

    if (label) {
      const lx = a.x + dx * 0.5;
      const ly = a.y + dy * 0.5 - 6;
      label.setAttribute('x', String(lx));
      label.setAttribute('y', String(ly));
    }
  }

  _anchorPoint(el, side = 'auto') {
    const left = el._modelPos.left;
    const top  = el._modelPos.top;
    const w = el.offsetWidth;
    const h = el.offsetHeight;

    const centers = {
      left:   { x: left,        y: top + h / 2 },
      right:  { x: left + w,    y: top + h / 2 },
      top:    { x: left + w / 2, y: top },
      bottom: { x: left + w / 2, y: top + h },
      center: { x: left + w / 2, y: top + h / 2 }
    };

    if (side === 'left' || side === 'right' || side === 'top' || side === 'bottom') {
      return centers[side];
    }
    return centers.center;
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

    const before = this._toWorld(e.clientX, e.clientY);
    this.scale = newScale;
    const after = this._toWorld(e.clientX, e.clientY);
    this.cameraX += (after.x - before.x) * this.scale;
    this.cameraY += (after.y - before.y) * this.scale;

    this._applyView();
  }

  _onMouseDownBg(e) {
    if (e.button !== 0) return;
    this.isPanning = true;
    this.container.classList.add('panning');
    this.panStart = { x: e.clientX, y: e.clientY };
    this.cameraStart = { x: this.cameraX, y: this.cameraY };
  }

  _onMouseMove(e) {
    const dragCard = [...this.cardEls.values()].find(el => el._drag);
    if (dragCard) {
      const worldPt = this._toWorld(e.clientX, e.clientY);
      const d = dragCard._drag;
      dragCard._modelPos.left = d.startLeft + (worldPt.x - d.startWorld.x);
      dragCard._modelPos.top  = d.startTop  + (worldPt.y - d.startWorld.y);
      dragCard.style.left = `${dragCard._modelPos.left}px`;
      dragCard.style.top  = `${dragCard._modelPos.top}px`;
      this._updateAllEdges();
      return;
    }

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
