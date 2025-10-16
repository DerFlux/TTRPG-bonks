// canvas.js — slim viewer with arrows + drag, minimal DOM churn
class CanvasApp {
  constructor(container, world) {
    this.container = container;
    this.world = world;
    this.scale = 1; this.minScale = 0.25; this.maxScale = 2.5;
    this.cameraX = 0; this.cameraY = 0;
    this.isPanning = false; this.panStart = {x:0,y:0}; this.cameraStart = {x:0,y:0};
    this.data = { items: [], edges: [] };
    this.cardEls = new Map();   // id -> HTMLElement
    this.edgeEls = new Map();   // key -> { path, label, edge }

    // events
    container.addEventListener('wheel', (e)=>this._onWheel(e), {passive:false});
    container.addEventListener('mousedown', (e)=>this._onMouseDownBg(e));
    addEventListener('mousemove', (e)=>this._onMouseMove(e));
    addEventListener('mouseup', ()=>this._onMouseUp());
    addEventListener('resize', ()=>this._updateAllEdges());

    // edge layer
    this.svg = this._mk('svg', { xmlns:'http://www.w3.org/2000/svg', style:'position:absolute;left:0;top:0;overflow:visible;pointer-events:none;' });
    const defs = this._mk('defs');
    const marker = this._mk('marker', { id:'arrowhead', markerWidth:'10', markerHeight:'7', refX:'10', refY:'3.5', orient:'auto' });
    marker.appendChild(this._mk('path', { d:'M0,0 L10,3.5 L0,7 Z', fill:'#6e7aff' }));
    defs.appendChild(marker); this.svg.appendChild(defs);
    world.insertAdjacentElement('afterbegin', this.svg);

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
    // wipe cards (edge layer stays)
    this.world.querySelectorAll('.card').forEach(n=>n.remove());
    this.cardEls.clear();

    for (const it of this.data.items) {
      const el = this._createCard(it);
      this.world.appendChild(el);
      this.cardEls.set(it.id, el);
    }
    this._renderEdges();
    this._applyView();
  }

  _createCard(item) {
    const el = this._mk('div', { class:'card' });
    el.style.left = `${item.x||0}px`; el.style.top = `${item.y||0}px`;
    el._modelPos = { left: item.x||0, top: item.y||0 };
    el._itemId = item.id;

    // title/link
    const title = this._escape(item.title || 'Untitled');
    const h = this._mk('h3');
    h.innerHTML = item.link
      ? `<a href="${this._escape(item.link)}" target="_blank" rel="noopener">${title}</a>`
      : title;

    // image (with candidate fallback)
    let imgWrap = null;
    const cands = (item.imageCandidates?.length ? item.imageCandidates : (item.image ? [item.image] : [])) || [];
    if (cands.length) {
      imgWrap = this._mk('div', { style:'margin:-6px -6px 8px -6px; overflow:hidden; border-radius:10px;' });
      const img = this._mk('img', { 'data-role':'card-img', decoding:'async', loading:'lazy', alt:'' });
      img.style.cssText = 'display:block;max-width:100%;height:auto;';
      let i = 0; img.src = cands[i];
      img.onerror = () => {
        const dbg = document.documentElement.classList.contains('canvas-debug');
        if (++i < cands.length) { if (dbg) console.warn('Image candidate failed:', cands[i-1]); img.src = cands[i]; }
        else if (dbg) this._badge(el, 'IMG 404', '#c0392b');
      };
      imgWrap.appendChild(img);
    }

    const p = item.description ? this._mk('p', {}, this._escape(item.description)) : null;
    const drag = this._mk('div', { class:'drag-handle', title:'Drag' });
    drag.onmousedown = (e) => {
      e.stopPropagation();
      const wpt = this._toWorld(e.clientX, e.clientY);
      el._drag = { startWorld:wpt, startLeft:el._modelPos.left, startTop:el._modelPos.top };
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
    this.svg.querySelectorAll('g.edge').forEach(n=>n.remove());
    this.edgeEls.clear();

    for (const e of this.data.edges) {
      const fromEl = this.cardEls.get(e.from || e.fromNode);
      const toEl   = this.cardEls.get(e.to   || e.toNode);
      if (!fromEl || !toEl) continue;

      const g = this._mkNS('g', { class:'edge' });
      const path = this._mkNS('path', { fill:'none', stroke:'#6e7aff', 'stroke-width':'2', 'marker-end':'url(#arrowhead)' });
      g.appendChild(path);
      let label = null;
      if (e.label) {
        label = this._mkNS('text', { 'font-size':'12', fill:'#9aa3ff', 'text-anchor':'middle' });
        label.textContent = e.label; g.appendChild(label);
      }
      this.svg.appendChild(g);
      const key = e.id || `${e.from}-${e.to}`;
      this.edgeEls.set(key, { path, label, edge:e });
      this._updateEdgeGeometry(fromEl, toEl, { path, label, edge:e });
    }
  }
  _updateAllEdges() {
    for (const { path, label, edge } of this.edgeEls.values()) {
      const fromEl = this.cardEls.get(edge.from || edge.fromNode);
      const toEl   = this.cardEls.get(edge.to   || edge.toNode);
      if (fromEl && toEl) this._updateEdgeGeometry(fromEl, toEl, { path, label, edge });
    }
  }
  _updateEdgeGeometry(fromEl, toEl, refs) {
    const { path, label, edge } = refs;
    const a = this._anchor(fromEl, edge.fromSide || 'auto');
    const b = this._anchor(toEl,   edge.toSide   || 'auto');
    const cx = a.x + (b.x - a.x)/2, cy = a.y + (b.y - a.y)/2;
    path.setAttribute('d', `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`);
    if (label) { label.setAttribute('x', `${cx}`); label.setAttribute('y', `${cy-6}`); }
  }
  _anchor(el, side) {
    const { left:x, top:y } = el._modelPos, w = el.offsetWidth, h = el.offsetHeight;
    const C = { left:{x, y:y+h/2}, right:{x:x+w, y:y+h/2}, top:{x:x+w/2, y}, bottom:{x:x+w/2, y:y+h}, center:{x:x+w/2, y:y+h/2} };
    return C[side] || C.center;
  }

  // ---------- camera ----------
  _applyView() {
    this.world.style.transform = `translate(${this.cameraX}px, ${this.cameraY}px) scale(${this.scale})`;
    const z = document.getElementById('zoom-level'); if (z) z.textContent = `${Math.round(this.scale*100)}%`;
  }
  resetView(){ this.scale=1; this.cameraX=this.cameraY=0; this._applyView(); }
  _onWheel(e){
    e.preventDefault();
    const s = Math.min(this.maxScale, Math.max(this.minScale, e.deltaY>0? this.scale/1.07 : this.scale*1.07));
    const before = this._toWorld(e.clientX, e.clientY);
    this.scale = s;
    const after  = this._toWorld(e.clientX, e.clientY);
    this.cameraX += (after.x - before.x) * this.scale;
    this.cameraY += (after.y - before.y) * this.scale;
    this._applyView();
  }
  _onMouseDownBg(e){ if (e.button!==0) return; this.isPanning=true; this.container.classList.add('panning'); this.panStart={x:e.clientX,y:e.clientY}; this.cameraStart={x:this.cameraX,y:this.cameraY}; }
  _onMouseMove(e){
    // dragging card?
    for (const el of this.cardEls.values()) if (el._drag){
      const w = this._toWorld(e.clientX, e.clientY), d = el._drag;
      el._modelPos.left = d.startLeft + (w.x - d.startWorld.x);
      el._modelPos.top  = d.startTop  + (w.y - d.startWorld.y);
      el.style.left = `${el._modelPos.left}px`; el.style.top = `${el._modelPos.top}px`;
      this._updateAllEdges(); return;
    }
    if (!this.isPanning) return;
    this.cameraX = this.cameraStart.x + (e.clientX - this.panStart.x);
    this.cameraY = this.cameraStart.y + (e.clientY - this.panStart.y);
    this._applyView();
  }
  _onMouseUp(){ this.isPanning=false; this.container.classList.remove('panning'); for (const el of this.cardEls.values()) { if (el._drag){ el._drag=null; el.classList.remove('dragging'); } } }

  // ---------- utils ----------
  _toWorld(cx, cy){ const r=this.container.getBoundingClientRect(); return { x:(cx-r.left-this.cameraX)/this.scale, y:(cy-r.top-this.cameraY)/this.scale }; }
  _mk(tag, attrs={}, text){ const el = document.createElement(tag); for (const k in attrs) el.setAttribute(k, attrs[k]); if (text!=null) el.textContent = text; return el; }
  _mkNS(tag, attrs={}){ const el = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const k in attrs) el.setAttribute(k, attrs[k]); return el; }
  _badge(el, txt, bg='#555'){ const b=this._mk('div'); b.textContent=txt; b.style.cssText='position:absolute;top:8px;right:8px;background:'+bg+';color:#fff;font:bold 11px/1.6 monospace;padding:2px 6px;border-radius:6px;'; el.appendChild(b); }
  _escape(s){ return String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
}
window.CanvasApp = CanvasApp;
