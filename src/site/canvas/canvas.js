// canvas.js — viewer with arrows + Obsidian-style Markdown rendering in cards
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

    // description — render Markdown
    const desc = item.description || '';
    const md = document.createElement('div');
    md.className = 'md-body';
    md.innerHTML = this._renderMarkdown(desc);

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
    if (desc) el.append(md);
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
   * Fit all cards into view with margin.
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

  // ---------- Obsidian-style Markdown renderer (safe subset) ----------
  _renderMarkdown(src) {
    // 0) Normalize newlines
    let text = String(src ?? '').replace(/\r\n?/g, '\n');

    // 1) Extract fenced code blocks first (protect from further formatting)
    const codeStore = [];
    text = text.replace(/```([\w-]+)?\n([\s\S]*?)```/g, (m, lang, code) => {
      const idx = codeStore.push({ lang: (lang||'').trim(), code }) - 1;
      return `\u0000CODEBLOCK_${idx}\u0000`;
    });

    // 2) Escape all HTML
    const escapeHtml = (s) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    text = escapeHtml(text);

    // 3) Headings (#..)
    text = text.replace(
      /^(#{1,6})[ \t]+(.+?)\s*$/gm,
      (m, hashes, content) => `<h${hashes.length}>${content.trim()}</h${hashes.length}>`
    );

    // 4) Horizontal rules
    text = text.replace(/^(?:\*\s*\*\s*\*|-{3,}|_{3,})\s*$/gm, '<hr/>');

    // 5) Blockquotes
    text = text.replace(/^(>+)\s?(.*)$/gm, (m, level, c) => {
      const inner = c || '';
      const depth = level.length;
      return '<blockquote>'.repeat(depth) + inner + '</blockquote>'.repeat(depth);
    });

    // 6) Lists (unordered, ordered, task)
    // Convert contiguous list lines into <ul>/<ol> blocks (simple, supports up to 4 levels by indent)
    const listify = (input) => {
      const lines = input.split('\n');
      const out = [];
      const stack = []; // {type:'ul'|'ol', indent}
      const flushTo = (indent) => {
        while (stack.length && stack[stack.length-1].indent >= indent) {
          const last = stack.pop();
          out.push(`</${last.type}>`);
        }
      };
      const openList = (type, indent) => {
        stack.push({ type, indent });
        out.push(`<${type}>`);
      };

      const listItem = (content, checkbox) => {
        if (checkbox === 'x' || checkbox === 'X') {
          return `<li><input type="checkbox" checked disabled> ${content}</li>`;
        } else if (checkbox === ' ') {
          return `<li><input type="checkbox" disabled> ${content}</li>`;
        }
        return `<li>${content}</li>`;
      };

      const uRe = /^(\s*)([-+*])\s+(.*)$/;
      const oRe = /^(\s*)(\d+)([.)])\s+(.*)$/;
      const tRe = /^(\s*)[-+*]\s+\[([ xX])\]\s+(.*)$/;

      for (let i=0;i<lines.length;i++){
        const raw = lines[i];

        // Task list
        let m = tRe.exec(raw);
        if (m) {
          const indent = m[1].length;
          const content = m[3];
          flushTo(indent);
          if (!stack.length || stack[stack.length-1].type!=='ul' || stack[stack.length-1].indent<indent) {
            openList('ul', indent);
          }
          out.push(listItem(content, m[2]));
          continue;
        }

        // Unordered
        m = uRe.exec(raw);
        if (m) {
          const indent = m[1].length;
          const content = m[3];
          flushTo(indent);
          if (!stack.length || stack[stack.length-1].type!=='ul' || stack[stack.length-1].indent<indent) {
            openList('ul', indent);
          }
          out.push(`<li>${content}</li>`);
          continue;
        }

        // Ordered
        m = oRe.exec(raw);
        if (m) {
          const indent = m[1].length;
          const content = m[4];
          flushTo(indent);
          if (!stack.length || stack[stack.length-1].type!=='ol' || stack[stack.length-1].indent<indent) {
            openList('ol', indent);
          }
          out.push(`<li>${content}</li>`);
          continue;
        }

        // Not a list line
        flushTo(0);
        out.push(raw);
      }
      flushTo(0);
      return out.join('\n');
    };
    text = listify(text);

    // 7) Inline: images ![alt](url|WxH)
    text = text.replace(/!\[([^\]]*)\]\(([^)\s]+?)(?:\|(\d+)(?:x(\d+))?)?\)/g, (m, alt, url, w, h) => {
      const u = url.replace(/\s/g, '%20');
      const size = (w ? ` width="${w}"` : '') + (h ? ` height="${h}"` : '');
      return `<img src="${u}" alt="${alt.replace(/"/g,'&quot;')}"${size} style="max-width:100%;height:auto;">`;
    });

    // 8) Inline links [text](url)
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, t, u) => {
      const url = u.trim().replace(/\s/g, '%20').replace(/^<|>$/g,'');
      return `<a href="${url}" target="_blank" rel="noopener">${t}</a>`;
    });

    // 9) Wikilinks [[Note]] or [[Note|Alias]]
    text = text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, note, alias) => {
      const label = (alias || note).trim();
      let href = '#';
      if (typeof window.resolveNoteLink === 'function') {
        try { href = window.resolveNoteLink(note.trim()); } catch {}
      }
      return `<a href="${href}">${label}</a>`;
    });

    // 10) Bold/italic/strike/highlight (order matters)
    // Bold+italic (***text***)
    text = text.replace(/(\*\*\*|___)([\s\S]+?)\1/g, '<strong><em>$2</em></strong>');
    // Bold (** or __)
    text = text.replace(/(\*\*|__)([\s\S]+?)\1/g, '<strong>$2</strong>');
    // Italic (* or _)
    text = text.replace(/(\*|_)([^*_][\s\S]*?)\1/g, '<em>$2</em>');
    // Strikethrough
    text = text.replace(/~~([\s\S]+?)~~/g, '<del>$1</del>');
    // Highlight == ==
    text = text.replace(/==([\s\S]+?)==/g, '<mark>$1</mark>');

    // 11) Inline code `code` and double-backtick variant
    text = text
      .replace(/``([^`]+)``/g, (m, c) => `<code>${c}</code>`)
      .replace(/`([^`]+)`/g, (m, c) => `<code>${c}</code>`);

    // 12) Line breaks within paragraphs:
    //    - Two trailing spaces + newline => <br>
    text = text.replace(/  \n/g, '<br>\n');

    // 13) Paragraph wrapping:
    // Split by blank lines; keep blocks that are already block elements as-is.
    const blocks = text.split(/\n{2,}/).map(chunk => {
      const trimmed = chunk.trim();
      if (!trimmed) return '';
      // If chunk starts with block element, don't wrap
      if (/^<(h\d|ul|ol|li|hr|blockquote|pre|img|code)/i.test(trimmed)) return trimmed;
      // If looks like list residue, keep
      if (/^\s*<\/?(ul|ol|li)/i.test(trimmed)) return trimmed;
      return `<p>${trimmed}</p>`;
    }).join('\n');

    // 14) Restore fenced code blocks
    const restored = blocks.replace(/\u0000CODEBLOCK_(\d+)\u0000/g, (m, idx) => {
      const entry = codeStore[Number(idx)] || { lang:'', code:'' };
      const safe = entry.code.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      const cls = entry.lang ? ` class="language-${entry.lang}"` : '';
      return `<pre><code${cls}>${safe}</code></pre>`;
    });

    return restored;
  }
}

window.CanvasApp = CanvasApp;
