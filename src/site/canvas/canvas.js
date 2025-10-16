// canvas.js — viewer with arrows, drag, pan/zoom, fit-to-view, and debug-aware IMG 404 badges
class CanvasApp {
  constructor(container, world) {
    this.container = container;
    this.world = world;

    // camera / view state
    this.scale = 1;
    this.minScale = 0.2;
    this.maxScale = 3;
    this.cameraX = 0;
    this.cameraY = 0;

    // interaction state
    this.isPanning = false;
    this.panStart = { x: 0, y: 0 };
    this.cameraStart = { x: 0, y: 0 };

    // data
    this.data = { items: [], edges: [] };
    this.cardEls = new Map();   // nodeId -> HTMLElement
    this.edgeEls = new Map();   // edgeKey -> { path, label, edge }

    // events
    container.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    container.addEventListener('mousedown', (e) => this._onMouseDownBg(e));
    window.addEventListener('mousemove', (e) => this._onMouseMove(e));
    window.addEventListener('mouseup', () => this._onMouseUp());
    window.addEventListener('resize', () => this._updateAllEdges());

    // SVG layer for edges (under cards)
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    this.svg.style.position = 'absolute';
    this.svg.style.left = '0';
    this.svg.style.top = '0';
    this.svg.style.overflow = 'visible';
    this.svg.style.pointerEvents = 'none';
    this.svg.style.zIndex = '0'; // under cards
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

    this._applyView();
  }

  setData(data) {
    this.data = { items: data?.items || [], edges: data?.edges || [] };
    this.render();
  }

  getData() {
    for (const it of this.data.items) {
      const el = this.cardEls.get(it.id);
      if (el) { it.x = el._modelPos.left; it.y = el._modelPos.top; }
    }
    return this.data;
  }

  // ---------- render ----------
  render() {
    // remove old cards (keep SVG layer)
    this.world.querySelectorAll('.card').forEach(n => n.remove());
    this.cardEls.clear();

    // (re)build cards
    for (const it of this.data.items) {
      const el = this._createCard(it);
      this.world.appendChild(el);
      this.cardEls.set(it.id, el);
    }

    // arrows
    this._renderEdges();
    this._applyView();
  }

  _createCard(item) {
    const el = document.createElement('div');
    el.className = 'card';
    el.style.left = `${item.x || 0}px`;
    el.style.top  = `${item.y || 0}px`;
    el._modelPos = { left: item.x || 0, top: item.y || 0 };
    el._itemId = item.id;

    // image (with candidate fallback)
    let imgWrap = null;
    const cands = (item.imageCandidates?.length ? item.imageCandidates : (item.image ? [item.image] : [])) || [];
    if (cands.length) {
      imgWrap = document.createElement('div');
      imgWrap.style.cssText = 'margin:-6px -6px 8px -6px; overflow:hidden; border-radius:10px;';
      const img = document.createElement('img');
      img.setAttribute('data-role', 'card-img');
      img.decoding = 'async';
      img.loading = 'lazy';
      img.alt = '';
      img.style.cssText = 'display:block; max-width:100%; height:auto;';
      let i = 0; img.src = cands[i];
      img.onerror = () => {
        const debugOn = !!(window.Debug && window.Debug.isOn && window.Debug.isOn());
        if (++i < cands.length) {
          if (debugOn) console.warn('Image candidate failed:', cands[i - 1]);
          img.src = cands[i];
        } else if (debugOn) {
          this._badge(el, 'IMG 404', '#c0392b');
        }
      };
      imgWrap.appendChild(img);
    }

    // title/link
    const title = this._escape(item.title || 'Untitled');
    const h = document.createElement('h3');
    h.innerHTML = item.link
      ? `<a href="${this._escape(item.link)}" target="_blank" rel="noopener">${title}</a>`
      : title;

    const p = item.description ? document.createElement('p') : null;
    if (p) p.textContent = item.description;

    const drag = document.createElement('div');
    drag.className = 'drag-handle';
    drag.title = 'Drag';
    drag.onmousedown = (e) => {
      e.stopPropagation();
      const wpt = this._toWorld(e.clientX, e.clientY);
      el._drag = { startWorld: wpt, startLeft: el._modelPos.left, startTop: el._modelPos.top };
      el.classList.add('dragging');
    };

    el.append(drag);
    if (imgWrap) el.append(imgWrap);
    el.append(h);
    if (p) el.append(p);
    return el;
  }

  // ---------- edges ----------
  _renderEdges() {
    // wipe current edges
    this.svg.querySelectorAll('g.edge').forEach(n => n.remove());
    this.edgeEls.clear();

    for (const e of this.data.edges) {
      const fromEl = this.cardEls.get(e.from || e.fromNode);
      const toEl   = this.cardEls.get(e.to   || e.toNode);
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
      if (e.label) {
        labelEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        labelEl.setAttribute('font-size', '12');
        labelEl.setAttribute('fill', '#9aa3ff');
        labelEl.setAttribute('text-anchor', 'middle');
        labelEl.textContent = e.label;
        g.appendChild(labelEl);
      }

      this.svg.appendChild(g);
      const key = e.id || `${e.from}-${e.to}`;
      this.edgeEls.set(key, { path, label: labelEl, edge: e });
      this._updateEdgeGeometry(fromEl, toEl, { path, label: labelEl, edge: e });
    }
  }

  _updateAllEdges() {
    for (const { path, label, edge } of this.edgeEls.values()) {
      const fromEl = this.cardEls.get(edge.from || edge.fromNode);
      const toEl   = this.cardEls.get(edge.to   || edge.toNode);
      if (!fromEl || !toEl) continue;
      this._updateEdgeGeometry(fromEl, toEl, { path, label, edge });
    }
  }

  _updateEdgeGeometry(fromEl, toEl, refs) {
    const { path, label, edge } = refs;
    const a = this._anchorPoint(fromEl, edge.fromSide || 'auto');
    const b = this._anchorPoint(toEl,   edge.toSide   || 'auto');

    const dx = b.x - a.x, dy = b.y - a.y;
    const cx = a.x + dx * 0.5, cy = a.y + dy * 0.5;

    path.setAttribute('d', `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`);
    if (label) {
      label.setAttribute('x', String(cx));
      label.setAttribute('y', String(cy - 6));
    }
  }

  _anchorPoint(el, side = 'auto') {
    const left = el._modelPos.left;
    const top  = el._modelPos.top;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const centers = {
      left:   { x: left,      y: top + h / 2 },
      right:  { x: left + w,  y: top + h / 2 },
      top:    { x: left + w/2, y: top },
      bottom: { x: left + w/2, y: top + h },
      center: { x: left + w/2, y: top + h / 2 }
    };
    return centers[side] || centers.center;
  }

  // ---------- camera / view ----------
  _applyView() {
    this.world.style.transform =
      `translate(${this.cameraX}px, ${this.cameraY}px) scale(${this.scale})`;
    const z = document.getElementById('zoom-level');
    if (z) z.textContent = `${Math.round(this.scale * 100)}%`;
    // keep edges accurate on view changes
    this._updateAllEdges();
  }

  setView({ x, y, scale }) {
    if (typeof scale === 'number') this.scale = Math.min(this.maxScale, Math.max(this.minScale, scale));
    if (typeof x === 'number') this.cameraX = x;
    if (typeof y === 'number') this.cameraY = y;
    this._applyView();
  }

  /**
   * Fit all cards into view with margin. Options:
   *  - margin (px)
   *  - bias: 'center' | 'left' | 'right' | 'top-left' | 'bottom-left' (default 'center')
   *  - zoomOut: multiply the computed fit scale by this (e.g., 1.2 to zoom out a bit more)
   *  - extraShiftX / extraShiftY: additional camera pixel shifts after fit
   */
  fitToView(opts = {}) {
    const { width: vw, height: vh } = this.container.getBoundingClientRect();
    if (!this.data.items.length || vw <= 0 || vh <= 0) return;

    const margin = opts.margin ?? 120;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const el of this.cardEls.values()) {
      const x = el._modelPos.left;
      const y = el._modelPos.top;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w);
      maxY = Math.max(maxY, y + h);
    }

    if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return;

    const contentW = (maxX - minX) + margin * 2;
    const contentH = (maxY - minY) + margin * 2;
    const scaleX = vw / contentW;
    const scaleY = vh / contentH;
    let scale = Math.min(scaleX, scaleY);
    scale = Math.min(this.maxScale, Math.max(this.minScale, scale));
    if (opts.zoomOut) scale /= opts.zoomOut; // zoom out a bit more

    // Place content according to bias (default center)
    let worldOriginX = minX - margin;
    let worldOriginY = minY - margin;

    // Compute camera so that worldOrigin maps to screen with chosen bias
    let camX = -worldOriginX * scale;
    let camY = -worldOriginY * scale;

    const bias = (opts.bias || 'center').toLowerCase();
    if (bias.includes('right')) camX = vw - (worldOriginX + contentW) * scale;
    if (bias.includes('bottom')) camY = vh - (worldOriginY + contentH) * scale;
    if (bias.includes('left'))  camX = -worldOriginX * scale;       // flush-left
    if (bias.includes('top'))   camY = -worldOriginY * scale;

    if (typeof opts.extraShiftX === 'number') camX += opts.extraShiftX;
    if (typeof opts.extraShiftY === 'number') camY += opts.extraShiftY;

    this.setView({ x: camX, y: camY, scale });
  }

  resetView() {
    // left-biased fit + slightly zoomed out
    this.fitToView({ margin: 160, bias: 'left', zoomOut: 1.25, extraShiftX: 0 });
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
    // drag card?
    for (const el of this.cardEls.values()) {
      if (!el._drag) continue;
      const w = this._toWorld(e.clientX, e.clientY);
      const d = el._drag;
      el._modelPos.left = d.startLeft + (w.x - d.startWorld.x);
      el._modelPos.top  = d.startTop  + (w.y - d.startWorld.y);
      el.style.left = `${el._modelPos.left}px`;
      el.style.top  = `${el._modelPos.top}px`;
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
      if (el._drag) { el._drag = null; el.classList.remove('dragging'); }
    }
  }

  // ---------- utils ----------
  _toWorld(clientX, clientY) {
    const rect = this.container.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.cameraX) / this.scale,
      y: (clientY - rect.top  - this.cameraY) / this.scale,
    };
  }
  _badge(el, txt, bg) {
    const b = document.createElement('div');
    b.textContent = txt;
    b.style.cssText = `position:absolute;top:8px;right:8px;background:${bg};color:#fff;font:bold 11px/1.6 monospace;padding:2px 6px;border-radius:6px;`;
    el.appendChild(b);
  }
  _escape(s) {
    return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }
}

window.CanvasApp = CanvasApp;
