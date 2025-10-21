// canvas.js — minimal CanvasApp with working edges + arrowheads and sane image cards
class CanvasApp {
  constructor(container, world) {
    this.container = container;
    this.world = world;

    // pan/zoom
    this.tx = 0;
    this.ty = 0;
    this.zoom = 1;

    // data
    this.data = { items: [], edges: [] };
    this.cardMap = new Map(); // id -> card element

    // edge SVG layer
    this.edgeSvg = null;

    this._wirePanZoom();
    this._ensureEdgeSvg();
    this.render();
  }

  /* ---------------- public API ---------------- */
  setData(data) {
    this.data = data || { items: [], edges: [] };
    this.render();
  }
  getData() {
    // Extract x/y back from DOM so saves match the on-screen layout
    for (const [id, el] of this.cardMap) {
      const it = this.data.items.find(n => n.id === id);
      if (!it) continue;
      const x = parseFloat(el.style.left || 0);
      const y = parseFloat(el.style.top || 0);
      if (Number.isFinite(x)) it.x = x;
      if (Number.isFinite(y)) it.y = y;
      it.w = Math.round(el.offsetWidth);
      it.h = Math.round(el.offsetHeight);
    }
    return this.data;
  }
  resetView() {
    this.tx = this.ty = 0;
    this.zoom = 1;
    this._applyTransform();
  }
  fitToView({ margin = 160, bias = "left", zoomOut = 1.0, extraShiftX = 0 } = {}) {
    const items = this.data.items || [];
    if (!items.length) return this.resetView();

    // compute bounds from current DOM (more accurate than data)
    let minX = +Infinity, minY = +Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const it of items) {
      const el = this.cardMap.get(it.id);
      const x = el ? parseFloat(el.style.left || it.x || 0) : (it.x || 0);
      const y = el ? parseFloat(el.style.top  || it.y || 0) : (it.y || 0);
      const w = el ? el.offsetWidth  : (it.w || it.width  || 280);
      const h = el ? el.offsetHeight : (it.h || it.height || 180);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w);
      maxY = Math.max(maxY, y + h);
    }

    const cw = this.container.clientWidth;
    const ch = this.container.clientHeight;
    const vw = Math.max(100, cw - margin * 2);
    const vh = Math.max(100, ch - margin * 2);

    const scaleX = vw / Math.max(1, maxX - minX);
    const scaleY = vh / Math.max(1, maxY - minY);
    let z = Math.min(scaleX, scaleY) / zoomOut;
    z = Math.max(0.05, Math.min(2.0, z));

    this.zoom = z;

    // bias to the left: keep left margin generous
    let left = minX - margin;
    if (bias === 'left') left -= Math.abs(extraShiftX || 0);

    const top = minY - margin;

    this.tx = -left * z;
    this.ty = -top * z;
    this._applyTransform();
  }

  /* ---------------- rendering ---------------- */
  render() {
    // cards
    this.cardMap.clear();
    this.world.innerHTML = "";

    for (const item of (this.data.items || [])) {
      const el = this._renderCard(item);
      this.world.appendChild(el);
      this.cardMap.set(item.id, el);
    }

    // make sure edges SVG exists and sits under cards
    this._ensureEdgeSvg();
    this._renderEdges();
    this._applyTransform();
  }

  _renderCard(item) {
    const el = document.createElement("div");
    el.className = "card";
    el._itemId = item.id;

    // position
    el.style.left = (item.x || 0) + "px";
    el.style.top  = (item.y || 0) + "px";

    // content
    const title = document.createElement("h3");
    title.textContent = item.title || "Untitled";

    const body = document.createElement("div");
    body.className = "md-body";
    if (item.description) {
      body.innerHTML = this._renderMarkdownLite(item.description);
    }

    // image card?
    let usedImage = false;
    if (Array.isArray(item.imageCandidates) && item.imageCandidates.length) {
      const img = document.createElement("img");
      img.setAttribute("data-role", "card-img");
      img.referrerPolicy = "same-origin";
      img.decoding = "async";
      img.loading = "lazy";

      const cands = item.imageCandidates.slice();
      const tryNext = () => {
        if (!cands.length) return;
        const url = cands.shift();
        img.src = url;
      };
      img.onerror = () => tryNext();
      tryNext();

      el.classList.add('image');
      el.appendChild(img);
      usedImage = true;
    }

    // text parts
    el.appendChild(title);
    if (item.description) el.appendChild(body);

    // drag handle
    const dot = document.createElement("div");
    dot.className = "drag-handle";
    el.appendChild(dot);
    this._wireDrag(el);

    return el;
  }

  _renderMarkdownLite(src) {
    // very small, safe subset for headings/bold/italics/highlight/links/newlines
    let s = String(src || "");

    // escape HTML
    s = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    // bold **text**
    s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    // italic *text*
    s = s.replace(/\*(.+?)\*/g, "<em>$1</em>");
    // highlight ==text==
    s = s.replace(/==(.+?)==/g, "<mark>$1</mark>");
    // headings (# …)
    s = s.replace(/^######\s*(.+)$/gm, "<h6>$1</h6>")
         .replace(/^#####\s*(.+)$/gm, "<h5>$1</h5>")
         .replace(/^####\s*(.+)$/gm, "<h4>$1</h4>")
         .replace(/^###\s*(.+)$/gm, "<h3>$1</h3>")
         .replace(/^##\s*(.+)$/gm, "<h2>$1</h2>")
         .replace(/^#\s*(.+)$/gm, "<h1>$1</h1>");
    // wiki/markdown links already rewritten later in main.js; here just basic []()
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, `<a href="$2">$1</a>`);

    // paragraphs (blank line => new paragraph)
    s = s.split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, ' ')}</p>`).join("");
    return s;
  }

  /* ---------------- edges ---------------- */
  _ensureEdgeSvg() {
    // create once, keep as first child to sit underneath cards
    if (this.edgeSvg && this.edgeSvg.parentNode === this.container) return;

    if (this.edgeSvg && this.edgeSvg.parentNode) {
      this.edgeSvg.parentNode.removeChild(this.edgeSvg);
    }
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("edges");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.setAttribute("viewBox", `0 0 ${this.container.clientWidth} ${this.container.clientHeight}`);
    svg.style.position = "absolute";
    svg.style.inset = "0";
    svg.style.pointerEvents = "none";
    svg.style.zIndex = "0";

    // arrowhead marker
    const defs = document.createElementNS(svg.namespaceURI, "defs");
    const marker = document.createElementNS(svg.namespaceURI, "marker");
    marker.setAttribute("id", "arrow");
    marker.setAttribute("markerWidth", "10");
    marker.setAttribute("markerHeight", "7");
    marker.setAttribute("refX", "10");
    marker.setAttribute("refY", "3.5");
    marker.setAttribute("orient", "auto");
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", "M0,0 L10,3.5 L0,7 Z");
    defs.appendChild(marker);
    marker.appendChild(path);
    svg.appendChild(defs);

    // insert *before* the world (so it’s under the cards)
    this.container.insertBefore(svg, this.world);
    this.edgeSvg = svg;
  }

  _renderEdges() {
    if (!this.edgeSvg) this._ensureEdgeSvg();
    const svg = this.edgeSvg;
    while (svg.lastChild && svg.lastChild.nodeName !== 'defs') svg.removeChild(svg.lastChild);

    const ns = svg.namespaceURI;

    const cardCenter = (id) => {
      const el = this.cardMap.get(id);
      if (!el) return null;
      const x = parseFloat(el.style.left || 0);
      const y = parseFloat(el.style.top  || 0);
      return {
        cx: x + el.offsetWidth  / 2,
        cy: y + el.offsetHeight / 2
      };
    };

    for (const e of (this.data.edges || [])) {
      const a = cardCenter(e.from);
      const b = cardCenter(e.to);
      if (!a || !b) continue;

      const p = document.createElementNS(ns, "path");
      p.setAttribute("class", "edge");
      p.setAttribute("marker-end", "url(#arrow)");

      // straight or smooth curve
      const dx = (b.cx - a.cx);
      const dy = (b.cy - a.cy);
      const k  = 0.25;
      const c1x = a.cx + dx * k;
      const c1y = a.cy + dy * k;
      const c2x = b.cx - dx * k;
      const c2y = b.cy - dy * k;

      p.setAttribute("d", `M ${a.cx} ${a.cy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${b.cx} ${b.cy}`);
      svg.appendChild(p);
    }
  }

  /* ---------------- pan/zoom & drag ---------------- */
  _applyTransform() {
    this.world.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.zoom})`;
    // translate edges with the same matrix so they align perfectly
    this.edgeSvg.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.zoom})`;
  }

  _wirePanZoom() {
    let dragging = false;
    let px = 0, py = 0;

    const down = (e) => {
      // only start panning if we started on the background
      if (e.target.closest('.card')) return;
      dragging = true;
      this.container.classList.add("panning");
      px = e.clientX; py = e.clientY;
      e.preventDefault();
    };
    const move = (e) => {
      if (!dragging) return;
      this.tx += (e.clientX - px);
      this.ty += (e.clientY - py);
      px = e.clientX; py = e.clientY;
      this._applyTransform();
    };
    const up = () => {
      dragging = false;
      this.container.classList.remove("panning");
    };

    this.container.addEventListener("mousedown", down);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);

    // wheel zoom (ctrl/cmd+wheel for zoom; plain wheel = page scroll)
    this.container.addEventListener("wheel", (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const delta = -Math.sign(e.deltaY) * 0.1;
      const newZ = Math.min(2, Math.max(0.05, this.zoom * (1 + delta)));
      // zoom around pointer
      const rect = this.container.getBoundingClientRect();
      const mx = (e.clientX - rect.left);
      const my = (e.clientY - rect.top);
      const wx = (mx - this.tx) / this.zoom;
      const wy = (my - this.ty) / this.zoom;
      this.zoom = newZ;
      this.tx = mx - wx * this.zoom;
      this.ty = my - wy * this.zoom;
      this._applyTransform();
    }, { passive: false });

    // keep edge viewport in sync
    const ro = new ResizeObserver(() => {
      if (!this.edgeSvg) return;
      this.edgeSvg.setAttribute("viewBox", `0 0 ${this.container.clientWidth} ${this.container.clientHeight}`);
    });
    ro.observe(this.container);
  }

  _wireDrag(cardEl) {
    const handle = cardEl.querySelector('.drag-handle') || cardEl;
    let sx=0, sy=0, ox=0, oy=0, dragging=false;

    const down = (e) => {
      dragging = true;
      cardEl.classList.add('dragging');
      sx = e.clientX; sy = e.clientY;
      ox = parseFloat(cardEl.style.left || 0);
      oy = parseFloat(cardEl.style.top  || 0);
      e.stopPropagation();
      e.preventDefault();
    };
    const move = (e) => {
      if (!dragging) return;
      const dx = (e.clientX - sx) / this.zoom;
      const dy = (e.clientY - sy) / this.zoom;
      cardEl.style.left = (ox + dx) + 'px';
      cardEl.style.top  = (oy + dy) + 'px';
      // edges must follow as we drag
      this._renderEdges();
    };
    const up = () => {
      if (!dragging) return;
      dragging = false;
      cardEl.classList.remove('dragging');
      this._renderEdges();
    };

    handle.addEventListener('mousedown', down);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }
}

/* expose */
window.CanvasApp = CanvasApp;
