// canvas.js — lightweight renderer + basic Markdown support used by main.js

class CanvasApp {
  constructor(container, world) {
    this.container = container;
    this.world = world;
    this.data = { items: [], edges: [] };
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;

    this._bind();
  }

  _bind() {
    // basic pan/zoom
    let dragging = false, lx = 0, ly = 0;
    this.container.addEventListener('mousedown', e => {
      if (e.target.closest('.card')) return;
      dragging = true; lx = e.clientX; ly = e.clientY;
    });
    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      this.panX += (e.clientX - lx);
      this.panY += (e.clientY - ly);
      lx = e.clientX; ly = e.clientY;
      this._applyTransform();
    });
    window.addEventListener('mouseup', () => dragging = false);

    this.container.addEventListener('wheel', e => {
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      this.zoom = Math.max(0.1, Math.min(4, this.zoom * delta));
      this._applyTransform();
      const zl = document.getElementById('zoom-level');
      if (zl) zl.textContent = Math.round(this.zoom * 100) + '%';
    });
  }

  setData(data) {
    this.data = data || { items: [], edges: [] };
    this.render();
  }
  getData() {
    return this.data;
  }

  resetView() {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this._applyTransform();
  }

  fitToView({margin=160, bias='left', zoomOut=1.0}={}) {
    const items = this.data.items || [];
    if (!items.length) return;
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for (const it of items) {
      const w = 320, h = 220;
      minX = Math.min(minX, it.x);
      minY = Math.min(minY, it.y);
      maxX = Math.max(maxX, it.x + w);
      maxY = Math.max(maxY, it.y + h);
    }
    const vw = this.container.clientWidth;
    const vh = this.container.clientHeight;
    const bw = (maxX - minX) + margin*2;
    const bh = (maxY - minY) + margin*2;
    const zx = vw / bw;
    const zy = vh / bh;
    this.zoom = Math.max(0.1, Math.min(2, Math.min(zx, zy) * (1/zoomOut)));
    // left bias: place minX close to margin
    const worldLeft = minX - margin;
    const worldTop  = minY - margin;
    this.panX = (-worldLeft) * this.zoom + 20; // nudge
    this.panY = (-worldTop) * this.zoom + 20;
    this._applyTransform();
  }

  _applyTransform() {
    this.world.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
  }

  // ---------- Markdown (basic) ----------
  renderMarkdown(md) {
    if (!md) return '';
    let s = String(md);

    // escape HTML (very simple)
    s = s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    // code
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');

    // bold/italic/strike/highlight
    s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    s = s.replace(/___([^_]+)___/g, '<strong><em>$1</em></strong>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    s = s.replace(/_([^_]+)_/g, '<em>$1</em>');
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    s = s.replace(/==([^=]+)==/g, '<mark>$1</mark>');

    // headings (H1..H4)
    s = s.replace(/^####\s*(.+)$/gm, '<h4>$1</h4>');
    s = s.replace(/^###\s*(.+)$/gm, '<h3>$1</h3>');
    s = s.replace(/^##\s*(.+)$/gm, '<h2>$1</h2>');
    s = s.replace(/^#\s*(.+)$/gm, '<h1>$1</h1>');

    // lists
    s = s.replace(/^\s*[-*+]\s+(.*)$/gm, '<li>$1</li>');
    s = s.replace(/(<li>[\s\S]+?<\/li>)/g, '<ul>$1</ul>');

    // blockquotes
    s = s.replace(/^\s*>\s?(.*)$/gm, '<blockquote>$1</blockquote>');

    // links [text](url)
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, txt, url) => {
      try {
        if (window.resolveNoteLink && !/^https?:\/\//i.test(url) && !url.startsWith('/')) {
          url = window.resolveNoteLink(txt);
        }
      } catch {}
      return `<a href="${url}">${txt}</a>`;
    });

    // wikilinks [[Title]]
    s = s.replace(/\[\[([^[\]|]+)(?:\|([^[\]]+))?\]\]/g, (m, target, alias) => {
      const text = (alias || target).trim();
      let url = '#';
      try { if (window.resolveNoteLink) url = window.resolveNoteLink(target.trim()); } catch {}
      return `<a href="${url}">${text}</a>`;
    });

    // paragraphs: split on blank lines
    const blocks = s.split(/\n{2,}/).map(b => {
      if (/^<h\d|^<ul>|^<blockquote>|^<img|^<p>|^<pre>|^<code>/.test(b)) return b;
      return `<p>${b.replace(/\n/g,'<br>')}</p>`;
    });
    return blocks.join('\n');
  }

  _cardHTML(item) {
    const title = item.title || '';
    const body  = this.renderMarkdown(item.description || '');
    const img = (item.imageCandidates && item.imageCandidates.length)
      ? `<img class="thumb" alt="" data-candidates='${JSON.stringify(item.imageCandidates)}'>`
      : '';
    const link = item.link ? `<a class="goto" href="${item.link}">Open</a>` : '';
    return `
      <div class="card" style="left:${item.x}px;top:${item.y}px;">
        <div class="pin"></div>
        <div class="title">${title}</div>
        ${img}
        <div class="md-body">${body}</div>
        ${link}
      </div>
    `;
  }

  render() {
    // edges first
    const edges = (this.data.edges || []).map(e => {
      const a = this.data.items.find(i => i.id === e.from);
      const b = this.data.items.find(i => i.id === e.to);
      if (!a || !b) return '';
      const x1 = a.x + 160, y1 = a.y + 40;
      const x2 = b.x + 160, y2 = b.y + 40;
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="edge" />`;
    }).join('');

    const cards = (this.data.items || []).map(i => this._cardHTML(i)).join('');

    this.world.innerHTML = `
      <svg class="edges" width="10000" height="10000">${edges}</svg>
      <div class="cards">${cards}</div>
    `;

    // tag DOM cards with item id and resolve images
    const cardEls = [...this.world.querySelectorAll('.card')];
    for (const el of cardEls) {
      const idx = cardEls.indexOf(el);
      const item = this.data.items[idx];
      if (!item) continue;
      el._itemId = item.id;

      const img = el.querySelector('img.thumb');
      if (img && item.imageCandidates?.length) {
        // try candidates in order
        (async () => {
          for (const src of item.imageCandidates) {
            try {
              const r = await fetch(src, { method:'HEAD' });
              if (r.ok) { img.src = src; break; }
            } catch {}
          }
          if (!img.src) { img.remove(); }
        })();
      }
    }
  }
}

window.CanvasApp = CanvasApp;
