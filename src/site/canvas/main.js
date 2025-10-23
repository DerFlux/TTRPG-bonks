// main.js — Canvas app controller with passworded Debug, Link Inspector GUI,
// alias persistence, manifest-based URL resolution, enrichment, upload/save.
//
// This file injects its own small CSS for the Link Inspector so you don't
// need to change styles.css for the panel to look good.

(function () {
  /* ---------- tiny utils ---------- */
  const $  = (q, r = document) => r.querySelector(q);
  const $$ = (q, r = document) => Array.from(r.querySelectorAll(q));

  const container = $('#canvas-container');
  const world     = $('#world');
  const app       = new CanvasApp(container, world);
  window.CanvasAppInstance = app;

  /* ===========================
   * Debug (password-gated on enable)
   * =========================== */
  const Debug = (() => {
    let on = false;
    try {
      const qs = new URLSearchParams(location.search);
      if (qs.get('debug') === '1') on = true;
      if (localStorage.getItem('canvasDebug') === '1') on = true;
    } catch {}

    function apply() {
      document.documentElement.classList.toggle('canvas-debug', on);
      const cb = $('#debug-toggle'); if (cb) cb.checked = on;
      $$('.card ._dbg').forEach(b => { b.style.display = on ? '' : 'none'; });
    }
    function set(v) {
      on = !!v;
      try { localStorage.setItem('canvasDebug', on ? '1' : '0'); } catch {}
      apply();
      document.dispatchEvent(new CustomEvent('canvas-debug-changed', { detail: { on } }));
    }
    function initToggle() {
      const tb = $('.toolbar'); if (!tb || $('#debug-toggle')) return;
      const wrap = document.createElement('label');
      wrap.className = 'debug-wrap';
      wrap.innerHTML = `<input id="debug-toggle" type="checkbox"><span>Debugging</span>`;
      tb.appendChild(wrap);
      const cb = wrap.querySelector('#debug-toggle');
      cb.checked = on;
      cb.addEventListener('change', () => {
        if (cb.checked) {
          let auth = localStorage.getItem('canvasSaveAuth');
          if (!auth) {
            auth = prompt('Enter canvas password:') || '';
            if (!auth) { cb.checked = false; return; }
            localStorage.setItem('canvasSaveAuth', auth);
          }
          set(true);
        } else set(false);
      });
    }
    apply();
    return { isOn: () => on, set, initToggle };
  })();

  /* ===========================
   * Helpers
   * =========================== */
  const isImg = p => /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(p || '');
  const stripExt = p => String(p || '').replace(/\.[a-z0-9]+$/i, '');
  const slug = s => String(s || '')
    .replace(/&/g, ' and ')
    .trim().replace(/\./g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/-+/g, '-').replace(/^-|-$/g, '')
    .toLowerCase();

  const sanitizePath = p => {
    let s = String(p || '').replace(/[|]+$/g, '').replace(/\/{2,}/g, '/');
    if (!s.startsWith('/')) s = '/' + s;
    return s;
  };
  const encodeSegs = p => p.split('/').map(encodeURIComponent).join('/');

  const extractEmbeds = (txt) => {
    const out = []; const re = /!\[\[([^|\]]+)(?:\|[^]]*)?\]\]/g; let m;
    const s = String(txt || '');
    while ((m = re.exec(s)) !== null) {
      let f = m[1].trim();
      if (!/[\/\\]/.test(f)) f = 'Images/' + f;
      out.push(f);
    }
    return out;
  };
  const stripEmbeds = s => String(s || '').replace(/!\[\[[^\]]+\]\]/g, '').trim();
  const firstLineAndRest = (txt) => {
    const lines = String(txt || '').split(/\r?\n/);
    const title = (lines[0] || '').replace(/^#+\s*/, '').trim() || 'Text';
    const desc  = lines.slice(1).join('\n').trim();
    return { title, desc };
  };

  const noteUrlFromVault = (vp) => {
    if (!vp || isImg(vp)) return null;
    const parts = vp.replace(/\.md$/i, '').split('/').map((seg, i) => {
      const sl = slug(seg);
      if (i === 0 && /^3-?npcs$/.test(sl)) return '3-np-cs';
      return sl;
    }).filter(Boolean);
    return sanitizePath(parts.join('/') + '/');
  };

  const imageCandidatesFromVault = (vp) => {
    if (!vp) return [];
    const stripped = vp.replace(/^Images\//i, '');
    const m = /^(.*?)(\.[^.]+)?$/.exec(stripped);
    const base = m[1] || stripped;
    const ext  = (m[2] || '').toLowerCase();
    const exts = ext ? Array.from(new Set([ext, ext.toUpperCase()])) : ['.png', '.PNG', '.jpg', '.JPG', '.jpeg', '.JPEG'];
    const prefixes = ['/img/user/Images/', '/img/user/images/', '/img/Images/', '/img/'];
    const bases = Array.from(new Set([base, base.toLowerCase()]));
    const c = [];
    for (const p of prefixes) for (const b of bases) for (const e of exts) c.push(p + encodeSegs(b) + e);
    c.push('/img/user/Images/' + encodeSegs(stripped));
    return Array.from(new Set(c));
  };
  const guessesFromTitle = (title) => {
    if (!title) return [];
    const base = title.replace(/\.[^.]+$/, '');
    const variants = Array.from(new Set([
      base,
      base.replace(/[,()]/g, '').replace(/\s+/g, ' ').trim(),
      base.replace(/\s+/g, ' ')
    ]));
    const exts = ['.png', '.jpg', '.jpeg', '.PNG', '.JPG', '.JPEG'];
    const out = [];
    for (const v of variants) for (const e of exts) out.push('/img/user/Images/' + encodeSegs(v) + e);
    return out;
  };

  /* ===========================
   * Link Aliases (persisted)
   * =========================== */
  let LinkAliases = { byText: {}, updatedAt: null };
  const DEFAULT_ALIASES = {
    byText: {
      "Avalon": "Avalon (Between Astra & Terra)",
      "Abigale": "/3-np-cs/avalon/abigale-teach/",
      "Cartha": "Cartha Coccineus, the Scarlet Priestess",
      "Xavier Crepus": "Xavier Crepus",
      "Amantha the fourth": "Amantha the Fourth",
      "Argent": "Argent",
      "Kingdom of Midgard": "Kingdom of Midgard",
      "Leones": "Leones",
      "The Coastal Coalition": "The Coastal Coalition"
    }
  };
  async function loadAliases() {
    try {
      const r = await fetch('/canvas/link-aliases.json', { credentials: 'same-origin' });
      if (r.ok) {
        const j = await r.json();
        if (j && typeof j === 'object') LinkAliases = j;
      }
    } catch {}
    LinkAliases.byText = { ...DEFAULT_ALIASES.byText, ...(LinkAliases.byText || {}) };
  }
  async function saveAliasesToRepo() {
    let auth = localStorage.getItem('canvasSaveAuth');
    if (!auth) { auth = prompt('Enter canvas password:') || ''; if (!auth) throw new Error('No password'); localStorage.setItem('canvasSaveAuth', auth); }
    const payload = {
      path: 'src/site/canvas/link-aliases.json',
      data: { ...LinkAliases, updatedAt: new Date().toISOString() },
      message: 'chore(canvas): update link aliases',
      auth
    };
    const r = await fetch('/api/save-canvas', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload)
    });
    if (r.status === 401) { localStorage.removeItem('canvasSaveAuth'); throw new Error('Unauthorized'); }
    if (!r.ok) throw new Error('Save failed '+r.status);
  }

  /* ===========================
   * Manifest
   * =========================== */
  let M = null;
  async function loadManifest() {
    try {
      const r = await fetch('/page-manifest.json', { credentials: 'same-origin' });
      if (!r.ok) throw 0;
      const raw = await r.json();
      M = indexManifest(raw);
      if (Debug.isOn()) window.__PageManifestIndex = M;
    } catch {
      M = { entries: [], byKey: new Map(), byTitle: new Map() };
    }
  }
  function indexManifest(man) {
    const arr = Array.isArray(man) ? man : Object.values(man || {});
    const entries = [];
    const byKey = new Map(); const byTitle = new Map();

    const push = (o) => {
      if (!o) return;
      const e = {
        url:          o.url || o.href || o.permalink || null,
        filePathStem: o.filePathStem || o.stem || null,
        inputPath:    o.inputPath || o.input || null,
        source:       o.sourcePath || o.page?.inputPath || o.data?.page?.inputPath || null,
        title:        o.title || o.data?.title || null,
        raw:          o,
      };
      if (e.url || e.filePathStem || e.inputPath || e.source) entries.push(e);
    };
    arr.forEach(push);

    const add = (k, e) => {
      if (!k) return;
      const key = String(k).trim();
      if (!key) return;
      (byKey.get(key) || byKey.set(key, []).get(key)).push(e);
    };
    const normKey = s => String(s || '').replace(/^\.?\/*/, '').toLowerCase();

    for (const e of entries) {
      const stem = e.filePathStem ? e.filePathStem.replace(/^\/*/, '') : '';
      [e.url, e.filePathStem, e.inputPath, e.source, normKey(stem), '/'+normKey(stem),
       normKey(e.inputPath), normKey(e.source)].forEach(k => add(k, e));
      if (e.title) {
        const t = slug(e.title);
        if (t) (byTitle.get(t) || byTitle.set(t, []).get(t)).push(e);
      }
      const segs = (stem || '').split('/').filter(Boolean);
      const last2 = segs.slice(-2).join('/');
      const last3 = segs.slice(-3).join('/');
      [last2, last3, slug(last2), slug(last3)].forEach(k => add(k, e));
    }
    return { entries, byKey, byTitle };
  }
  const normCanvas = p => String(p || '').replace(/\\/g, '/').replace(/^\.?\/*/, '').replace(/\.md$/i, '').trim();

  function manifestKeys(canvasPath) {
    const base = normCanvas(canvasPath), lc = base.toLowerCase();
    const raw = lc.split('/').filter(Boolean);
    const slugParts = raw.map(slug);
    if (slugParts[0] === '3-npcs' || slugParts[0] === '3--npcs') slugParts[0] = '3-np-cs';
    const last = raw.at(-1) || '';
    const lastAlt = slug(last.replace(/[(),]/g, '').replace(/\s+/g, ' ').trim());
    const c = new Set([
      base, lc, '/'+slugParts.join('/'), slugParts.join('/'),
      '/'+slugParts.slice(0,-1).concat([lastAlt]).join('/'),
      slugParts.slice(0,-1).concat([lastAlt]).join('/'),
      sanitizePath(noteUrlFromVault(canvasPath) || ''),
      raw.slice(-2).join('/'), raw.slice(-3).join('/'),
      slug(raw.slice(-2).join('/')), slug(raw.slice(-3).join('/')),
      lc.replace(/[(),]/g, '').replace(/&/g,'and').replace(/\s+/g,'-')
    ]);
    return Array.from(c).filter(Boolean);
  }
  function resolveFromManifest(canvasPath) {
    if (!M) return null;
    for (const key of manifestKeys(canvasPath)) {
      const hit = M.byKey.get(String(key).trim());
      if (hit?.length) return (hit.find(e => !!e.url) || hit[0]).url || null;
    }
    const last = slug(normCanvas(canvasPath).split('/').pop());
    const tHit = last && M.byTitle.get(last);
    if (tHit?.length) return (tHit.find(e => !!e.url) || tHit[0]).url || null;

    const lc = normCanvas(canvasPath).toLowerCase();
    for (const e of M.entries) {
      if ((e.filePathStem && lc.endsWith(String(e.filePathStem).toLowerCase())) ||
          (e.inputPath   && lc.endsWith(String(e.inputPath).toLowerCase()))   ||
          (e.source      && lc.endsWith(String(e.source).toLowerCase()))) {
        return e.url || null;
      }
    }
    return null;
  }

  /* ===========================
   * Link rewriting (with alias support for full URLs)
   * =========================== */
  const pickBest = arr => (arr && arr.length ? (arr.find(e => e.url) || arr[0]) : null);
  async function ensureManifestForLinks(){ if(!M) await loadManifest(); return M; }

  function toAbsoluteIfRelative(u){
    if (!u) return u;
    if (/^https?:\/\//i.test(u)) return u;
    if (u.startsWith('/')) return new URL(u, location.origin).href;
    return u;
  }

  async function resolveUrlFromHrefOrText(href, text) {
    await ensureManifestForLinks();

    // Direct full or site-relative override via alias
    if (text && LinkAliases.byText && LinkAliases.byText[text]) {
      const v = LinkAliases.byText[text];
      if (/^(https?:)?\/\//i.test(v) || v.startsWith('/')) {
        return toAbsoluteIfRelative(v);
      }
      // else: treat as page title
      const tHit = M.byTitle.get(slug(v));
      const pick = tHit && tHit.length ? (tHit.find(e => e.url) || tHit[0]) : null;
      if (pick?.url) return pick.url;
    }

    // Regular link
    if (/^https?:\/\//i.test(href)) return href;

    const clean = decodeURIComponent(href || '').replace(/^\/+/, '').replace(/&amp;/gi, 'and');
    const stem1 = slug(stripExt(clean));
    const stem2 = slug(clean.split('/').pop() || '');
    const stem3 = slug(clean.split('/').slice(-2).join('/') || '');

    const byStem  = M.byKey;
    const byTitle = M.byTitle;

    let hit = pickBest(byStem.get(stem1)) || pickBest(byStem.get('/'+stem1))
           || pickBest(byStem.get(stem2)) || pickBest(byStem.get(stem3));
    if (hit?.url) return hit.url;

    if (text) {
      hit = pickBest(byTitle.get(slug(text)));
      if (hit?.url) return hit.url;
    }
    return href; // fallback
  }

  async function rewriteLinksInDOM(root = document) {
    const anchors = root.querySelectorAll('.card .md-body a[href]');
    await Promise.all(Array.from(anchors).map(async a => {
      const href = a.getAttribute('href') || '';
      const txt  = a.textContent.trim();
      const newHref = await resolveUrlFromHrefOrText(href, txt);
      a.setAttribute('href', newHref);
    }));
  }

  /* ===========================
   * Enrichment (strip images from snippet to avoid duplicates)
   * =========================== */
  async function tryFetch(url) {
    const u = new URL(url, location.origin);
    const base = sanitizePath(u.pathname);
    const withSlash = base.endsWith('/') ? base : base + '/';
    const without   = base.endsWith('/') ? base.slice(0, -1) : base;
    const variants  = [withSlash, without, withSlash + 'index.html', withSlash + 'index.htm'];
    for (const p of variants) {
      try {
        const r = await fetch(new URL(p, location.origin), { credentials: 'same-origin' });
        if (r.ok) return { ok: true, url: String(new URL(p, location.origin)), html: await r.text() };
      } catch {}
    }
    return { ok: false, url, html: '' };
  }
  const firstHTML = (doc) => {
    const picks = ['main .markdown-rendered','article .markdown-rendered','main .content','article .content','.markdown-body','.prose','main','article'];
    for (const sel of picks) {
      const el = doc.querySelector(sel);
      if (!el) continue;
      const candidates = el.querySelectorAll('p, .callout, blockquote, ul, ol');
      for (const c of candidates) {
        const text = (c.textContent || '').replace(/\s+/g, ' ').trim();
        if (text.length > 10) return c.outerHTML;
      }
    }
    return '';
  };
  function stripImagesFromHtml(html) {
    const d = document.implementation.createHTMLDocument('');
    d.body.innerHTML = html || '';
    d.body.querySelectorAll('img, picture, figure').forEach(n => n.remove());
    return d.body.innerHTML;
  }
  const firstImageFromPage = (doc, pageUrl) => {
    const abs = (v) => v ? new URL(v, pageUrl).href : '';
    const og  = doc.querySelector('meta[property="og:image"], meta[name="og:image"]');
    if (og?.content) return abs(og.content);
    const pre = doc.querySelector('link[rel="preload"][as="image"][href]');
    if (pre) return abs(pre.getAttribute('href'));
    const sel = (s) => {
      const img = doc.querySelector(s);
      if (!img) return '';
      const ss = img.getAttribute('srcset');
      if (ss) return abs(ss.split(',')[0].trim().split(/\s+/)[0]);
      const lazy = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original');
      if (lazy) return abs(lazy);
      return abs(img.getAttribute('src'));
    };
    return sel('main img, article img, .content img, .prose img, .markdown-rendered img, .markdown-body img, img');
  };

  const pageCache = new Map();
  async function fetchPageInfo(url) {
    if (pageCache.has(url)) return pageCache.get(url);
    const p = (async () => {
      const t = await tryFetch(url);
      if (!t.ok) throw new Error('ENR404 ' + url);
      const doc = new DOMParser().parseFromString(t.html, 'text/html');
      const snippet = stripImagesFromHtml(firstHTML(doc));
      return { finalUrl: t.url, image: firstImageFromPage(doc, t.url), htmlSnippet: snippet };
    })();
    pageCache.set(url, p);
    return p;
  }

  function addBadge(itemId, text, bg = '#555') {
    if (!Debug.isOn()) return;
    const el = $$('.card').find(n => n._itemId === itemId);
    if (!el) return;
    const b = document.createElement('div');
    b.className = '_dbg';
    b.textContent = text;
    b.style.cssText = 'position:absolute;top:8px;left:8px;background:'+bg+';color:#fff;font:700 11px/1.6 monospace;padding:2px 6px;border-radius:6px;';
    el.appendChild(b);
  }
  function injectHTMLForItem(it) {
    if (!it || !it.id || !it.descriptionHtml) return;
    const card = $$('.card').find(n => n._itemId === it.id);
    if (!card) return;
    const body = card.querySelector('.md-body') || card.querySelector('.card-body') || card;
    body.innerHTML = it.descriptionHtml;
  }
  function injectAllHTML(items) { (items || app.data.items || []).forEach(injectHTMLForItem); }

  /* ===========================
   * Adapt Obsidian JSON → canvas data
   * =========================== */
  function adaptCanvas(json) {
    const items = []; const edges = [];
    for (const n of (json.nodes || [])) {
      const common = { id: n.id, x: Number.isFinite(n.x) ? n.x : 0, y: Number.isFinite(n.y) ? n.y : 0 };

      if (n.type === 'text') {
        const embeds = extractEmbeds(n.text);
        const td = firstLineAndRest(stripEmbeds(n.text));
        const it = { ...common, title: td.title, description: td.desc };
        if (embeds.length) it.imageCandidates = imageCandidatesFromVault(embeds[0]);
        items.push(it);
        continue;
      }

      if (n.type === 'file') {
        const f = String(n.file || '');
        if (isImg(f)) {
          items.push({ ...common, title: f.split('/').pop().replace(/\.[^.]+$/, ''), description: '', imageCandidates: imageCandidatesFromVault(f) });
        } else {
          const parts = f.replace(/\.md$/i, '').split('/');
          const title = parts.pop();
          const crumb = parts.length ? parts.join(' › ') : '';
          items.push({
            ...common,
            title, description: crumb,
            _canvasPath: f, _needsManifestResolve: true, _needsEnrich: true,
            _nameGuesses: guessesFromTitle(title)
          });
        }
        continue;
      }
      items.push({ ...common, title: n.type || 'node', description: n.file || n.text || '' });
    }
    for (const e of (json.edges || [])) edges.push({ from: e.fromNode, to: e.toNode, label: e.label || '' });
    return { items, edges };
  }

  /* ===========================
   * Resolve & enrich
   * =========================== */
  function resolveLinksNow() {
    for (const it of (app.data.items || [])) {
      if (!it._needsManifestResolve) continue;
      it.link = resolveFromManifest(it._canvasPath) || noteUrlFromVault(it._canvasPath);
      delete it._needsManifestResolve;
    }
    app.render();
    injectAllHTML();
    rewriteLinksInDOM().catch(()=>{});
  }

  async function enrichAll() {
    const list = (app.data.items || []).filter(it => it._needsEnrich && it.link);
    const MAX = 4; let active = 0;

    await new Promise((done) => {
      const q = list.slice();
      const pump = () => {
        while (active < MAX && q.length) {
          const it = q.shift(); active++;
          (async () => {
            try {
              const info = await fetchPageInfo(it.link);
              const cands = [];
              if (info.image) cands.push(info.image);
              if (it._nameGuesses) cands.push(...it._nameGuesses);
              if (it.imageCandidates) cands.push(...it.imageCandidates);
              it.imageCandidates = Array.from(new Set(cands));
              if (info.htmlSnippet) it.descriptionHtml = info.htmlSnippet;

              app.render();
              injectHTMLForItem(it);
              await rewriteLinksInDOM();

              if ((!info.htmlSnippet?.trim()) && (!it.imageCandidates?.length)) addBadge(it.id, 'NO CONTENT', '#7f8c8d');
            } catch (e) {
              addBadge(it.id, 'ENR 404', '#555');
              if (Debug.isOn()) console.warn('Enrich failed for', it.link, e);
            } finally {
              delete it._needsEnrich; delete it._nameGuesses;
              active--; q.length ? pump() : !active && done();
            }
          })();
        }
      };
      q.length ? pump() : done();
    });
  }

  /* ===========================
   * Positions save
   * =========================== */
  async function tryLoadPositions(url = '/canvas/tir.positions.json') {
    try { const r = await fetch(url, { credentials: 'same-origin' }); if (!r.ok) return null; const j = await r.json(); return j?.positions || null; }
    catch { return null; }
  }
  function applyPositions(obsidian, pos) {
    if (!obsidian?.nodes || !pos) return obsidian;
    for (const n of obsidian.nodes) if (n?.id && pos[n.id]) { const p = pos[n.id]; if (Number.isFinite(p.x)) n.x = p.x; if (Number.isFinite(p.y)) n.y = p.y; }
    return obsidian;
  }
  async function savePositionsToRepo() {
    const btn = $('#btn-save-repo');
    try {
      if (btn) { btn.disabled = true; btn.classList.add('saving'); btn.textContent = 'Saving…'; }
      let auth = localStorage.getItem('canvasSaveAuth');
      if (!auth) { auth = prompt('Enter canvas save password:') || ''; if (!auth) throw new Error('No password'); localStorage.setItem('canvasSaveAuth', auth); }

      const data = app.getData();
      const positions = {};
      for (const it of (data.items || [])) if (it.id) positions[it.id] = { x: it.x, y: it.y };

      const payload = { path:'src/site/canvas/tir.positions.json', data:{positions, updatedAt:new Date().toISOString(), version:1}, message:'chore(canvas): update node positions', auth };
      const r = await fetch('/api/save-canvas', { method:'POST', headers:{'content-type':'application/json'}, credentials:'same-origin', body:JSON.stringify(payload) });
      if (r.status === 401) { localStorage.removeItem('canvasSaveAuth'); throw new Error('Unauthorized (bad password)'); }
      if (!r.ok) throw new Error(`Save failed ${r.status}`);
      if (btn) { btn.textContent = 'Saved ✓'; setTimeout(()=>{ btn.textContent='Save to Repo'; btn.classList.remove('saving'); btn.disabled = false; }, 1000); }
    } catch (e) {
      console.error(e); alert('Save failed. See console.');
      if (btn) { btn.textContent='Save to Repo'; btn.classList.remove('saving'); btn.disabled = false; }
    }
  }

  /* ===========================
   * Upload .canvas (commit + live load)
   * =========================== */
  async function commitFileToRepo(path, dataObj, message) {
    let auth = localStorage.getItem('canvasSaveAuth');
    if (!auth) { auth = prompt('Enter canvas save password:') || ''; if (!auth) throw new Error('No password'); localStorage.setItem('canvasSaveAuth', auth); }
    const payload = { path, data: dataObj, message, auth };
    const r = await fetch('/api/save-canvas', { method:'POST', headers:{'content-type':'application/json'}, credentials:'same-origin', body:JSON.stringify(payload) });
    if (r.status === 401) { localStorage.removeItem('canvasSaveAuth'); throw new Error('Unauthorized'); }
    if (!r.ok) throw new Error(`Commit failed ${r.status}`);
    return r.json().catch(()=>({}));
  }
  async function loadCanvasObject(obsidianJson) {
    let obsidian = obsidianJson;
    try { const pos = await tryLoadPositions(); if (pos) obsidian = applyPositions(obsidian, pos); } catch {}
    const data = adaptCanvas(obsidian);
    app.setData(data);
    resolveLinksNow();
    await enrichAll();
    app.fitToView({ margin: 160, bias: 'left', zoomOut: 1.25, extraShiftX: 0 });
    injectAllHTML();
    await rewriteLinksInDOM();
  }
  function wireUploadUI(tb) {
    let fi = $('#canvas-file-input');
    if (!fi) { fi = document.createElement('input'); fi.type='file'; fi.accept='.canvas,application/json'; fi.id='canvas-file-input'; fi.style.display='none'; document.body.appendChild(fi); }
    const btn = ensureBtn(tb, 'btn-upload-canvas', 'Upload .canvas', 'Replace tir.canvas.json with a new file');
    btn.onclick = async () => {
      fi.value=''; fi.onchange = async () => {
        const f = fi.files?.[0]; if (!f) return;
        try {
          btn.disabled = true; btn.textContent = 'Uploading…';
          const text = await f.text(); const json = JSON.parse(text);
          if (!json || !Array.isArray(json.nodes) || !Array.isArray(json.edges)) throw new Error('Not a valid .canvas JSON');
          await commitFileToRepo('src/site/canvas/tir.canvas.json', json, `chore(canvas): replace tir.canvas.json (${f.name})`);
          await loadCanvasObject(json);
          btn.textContent = 'Uploaded ✓'; setTimeout(()=>{ btn.textContent='Upload .canvas'; btn.disabled=false; }, 900);
        } catch (e) { console.error(e); alert('Upload failed.'); btn.textContent='Upload .canvas'; btn.disabled=false; }
      };
      fi.click();
    };
    // DnD
    window.addEventListener('dragover', e => e.preventDefault());
    window.addEventListener('drop', async e => {
      if (!e.dataTransfer) return;
      const f = [...e.dataTransfer.files].find(x => /\.canvas$/i.test(x.name) || /\.json$/i.test(x.name));
      if (!f) return;
      e.preventDefault();
      try {
        const text = await f.text(); const json = JSON.parse(text);
        await commitFileToRepo('src/site/canvas/tir.canvas.json', json, `chore(canvas): replace tir.canvas.json (drag&drop ${f.name})`);
        await loadCanvasObject(json);
      } catch (err) { console.error(err); alert('Drag&drop upload failed.'); }
    });
  }

  /* ===========================
   * Toolbar
   * =========================== */
  function ensureToolbar(){ let tb = $('.toolbar'); if (!tb){ tb = document.createElement('div'); tb.className='toolbar'; document.body.appendChild(tb);} return tb;}
  function ensureBtn(tb,id,label,title){ let b = $('#'+id); if(!b){ b=document.createElement('button'); b.id=id; b.type='button'; b.textContent=label; if(title) b.title=title; tb.appendChild(b);} return b;}
  function wireToolbar(){
    const tb = ensureToolbar();
    ensureBtn(tb,'btn-reset','Reset View').onclick=()=>app.resetView();
    ensureBtn(tb,'btn-save','Download JSON').onclick=()=>{
      const blob=new Blob([JSON.stringify(app.getData(),null,2)],{type:'application/json'});
      const url=URL.createObjectURL(blob); const a=Object.assign(document.createElement('a'),{href:url,download:'data.json'});
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    };
    ensureBtn(tb,'btn-save-repo','Save to Repo','Commit positions').onclick=savePositionsToRepo;
    wireUploadUI(tb);
    if (!$('#zoom-level')) { const span=document.createElement('span'); span.id='zoom-level'; span.textContent=''; span.style.marginLeft='8px'; tb.appendChild(span); }
    Debug.initToggle();
    if (Debug.isOn()) LinkInspector.ensureButton();
  }

  /* ===========================
   * Link Inspector (Debug-only)
   * =========================== */
  const LinkInspector = (() => {
    let panel = null, btn = null;

    function injectStyles(){
      if ($('#li-style')) return;
      const css = `
        .li-panel{position:fixed;top:64px;right:24px;width:560px;max-height:75vh;background:#fff;border:1px solid rgba(0,0,0,.1);box-shadow:0 10px 30px rgba(0,0,0,.18);border-radius:12px;display:flex;flex-direction:column;z-index:9999;font:14px/1.3 system-ui,Segoe UI,Roboto,Arial,sans-serif;}
        .li-head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid rgba(0,0,0,.06);background:#faf8f4;border-top-left-radius:12px;border-top-right-radius:12px}
        .li-head strong{font-weight:700}
        .li-actions{display:flex;gap:8px;align-items:center}
        .li-body{overflow:auto;padding:8px}
        .li-row{display:grid;grid-template-columns:1.2fr 1.2fr auto 1.4fr;gap:8px;align-items:center;padding:6px 4px;border-bottom:1px dashed rgba(0,0,0,.07)}
        .li-col a{color:#b33;text-decoration:underline}
        .li-badge{display:inline-block;font:600 12px/1.5 ui-monospace,Menlo,Consolas,monospace;padding:1px 6px;border-radius:999px;border:1px solid #ddd}
        .li-badge.ok{background:#eafbea;color:#0a7a2a;border-color:#cfe9cf}
        .li-badge.bad{background:#fff0f0;color:#a00;border-color:#f0caca}
        .li-input{width:100%;padding:6px 8px;border:1px solid #ddd;border-radius:8px}
        #btn-link-inspector{margin-left:6px}
        .li-search{margin:6px 8px 0 8px}
        .li-search input{width:100%;padding:6px 10px;border:1px solid #ddd;border-radius:8px}
        .li-foot{padding:8px;border-top:1px solid rgba(0,0,0,.06)}
        .li-pills{display:flex;gap:6px;align-items:center;flex-wrap:wrap;color:#666}
        .li-pill{background:#f3eee8;border:1px solid #e7dfd6;border-radius:999px;padding:2px 8px;font-size:12px}
        .li-hl .md-body a.li-mark{outline:2px solid #f39;outline-offset:2px;border-radius:3px}
      `;
      const s = document.createElement('style'); s.id='li-style'; s.textContent = css; document.head.appendChild(s);
    }

    function ensureButton(){
      if (!Debug.isOn()) return;
      if (btn && document.body.contains(btn)) return;
      const tb = document.querySelector('.toolbar'); if (!tb) return;
      btn = document.createElement('button'); btn.id='btn-link-inspector'; btn.textContent='Link Inspector';
      btn.title='Inspect and repair inline links on cards';
      btn.addEventListener('click', togglePanel);
      tb.appendChild(btn);
    }
    function togglePanel(){ panel ? hidePanel() : openPanel(); }
    function hidePanel(){ if (panel) panel.remove(); panel=null; document.documentElement.classList.remove('li-hl'); }
    function setHighlight(on){ document.documentElement.classList.toggle('li-hl', !!on); }

    function groupAnchors(){
      const anchors = Array.from(document.querySelectorAll('.card .md-body a[href]'));
      const byText = new Map();
      for (const a of anchors) {
        const t = (a.textContent || '').trim();
        if (!t) continue;
        (byText.get(t) || byText.set(t, []).get(t)).push(a);
      }
      return byText;
    }

    async function openPanel(){
      injectStyles();
      if (panel) return;
      panel = document.createElement('aside');
      panel.className = 'li-panel';
      panel.innerHTML = `
        <div class="li-head">
          <strong>Link Inspector</strong>
          <div class="li-actions">
            <label><input id="li-highlight" type="checkbox"> Highlight links on canvas</label>
            <button id="li-close">Close</button>
          </div>
        </div>
        <div class="li-search"><input id="li-filter" type="text" placeholder="Filter by link text…"></div>
        <div class="li-body"><div class="li-list">Scanning…</div></div>
        <div class="li-foot"><div class="li-pills"><span class="li-pill" id="li-count">0 items</span><span class="li-pill">Tip: Enter a full URL or a /site-relative path or a page title, then “Apply”.</span></div></div>
      `;
      document.body.appendChild(panel);

      $('#li-close', panel).addEventListener('click', hidePanel);
      $('#li-highlight', panel).addEventListener('change', e => setHighlight(e.target.checked));

      const list = panel.querySelector('.li-list');
      await buildList(list);
      const filter = $('#li-filter', panel);
      filter.addEventListener('input', () => {
        const q = filter.value.trim().toLowerCase();
        list.querySelectorAll('.li-row').forEach(r => {
          const t = (r.getAttribute('data-text')||'').toLowerCase();
          r.style.display = t.includes(q) ? '' : 'none';
        });
      });
    }

    function makeRow(text, anchors) {
      const href0 = anchors[0].getAttribute('href') || '';
      const row = document.createElement('div');
      row.className = 'li-row';
      row.setAttribute('data-text', text);

      const current = document.createElement('div');
      current.className = 'li-col li-href';
      const link = document.createElement('a'); link.target = '_blank'; link.rel='noopener';
      link.textContent = '(resolving…)'; link.href = href0; current.appendChild(link);

      const status = document.createElement('div'); status.className = 'li-col li-status';
      const badge = document.createElement('span'); badge.className = 'li-badge'; badge.textContent = '…';
      status.appendChild(badge);

      const title = document.createElement('div'); title.className = 'li-col li-text';
      title.innerHTML = `<strong>${escapeHtml(text)}</strong> <small>(${anchors.length} link${anchors.length>1?'s':''})</small>`;

      const edit = document.createElement('div'); edit.className = 'li-col li-edit';
      const input = document.createElement('input'); input.className='li-input';
      input.placeholder = 'Target page title or /relative/or/full URL';
      input.value = LinkAliases.byText[text] || '';
      const btn = document.createElement('button'); btn.textContent='Apply'; btn.className='li-apply';
      edit.appendChild(input); edit.appendChild(btn);

      row.appendChild(title); row.appendChild(current); row.appendChild(status); row.appendChild(edit);

      // Resolve & show current final URL/status
      (async () => {
        const fixed = await resolveUrlFromHrefOrText(href0, text);
        link.textContent = fixed; link.href = fixed;
        const st = await checkUrl(fixed);
        badge.className = 'li-badge ' + (st.ok ? 'ok':'bad'); badge.textContent = st.ok ? 'OK' : '404';
      })();

      btn.addEventListener('click', async () => {
        try {
          // update alias map
          const v = input.value.trim();
          if (!v) { delete LinkAliases.byText[text]; } else { LinkAliases.byText[text] = v; }

          // persist immediately (password already cached from enabling Debug)
          btn.disabled = true; btn.textContent = 'Saving…';
          await saveAliasesToRepo();

          // update ALL anchors with this visible text
          for (const a of anchors) {
            const old = a.getAttribute('href') || '';
            const resolved = await resolveUrlFromHrefOrText(old, text);
            a.setAttribute('href', resolved);
          }
          // refresh row’s display
          const a = anchors[0];
          const resolved = await resolveUrlFromHrefOrText(a.getAttribute('href')||'', text);
          link.textContent = resolved; link.href = resolved;
          const st = await checkUrl(resolved);
          badge.className = 'li-badge ' + (st.ok ? 'ok':'bad'); badge.textContent = st.ok ? 'OK' : '404';
          btn.textContent = 'Saved ✓'; setTimeout(()=>{ btn.textContent='Apply'; btn.disabled=false; }, 800);
        } catch (e) {
          console.error(e); alert('Saving link mapping failed. Check console.');
          btn.textContent = 'Apply'; btn.disabled = false;
        }
      });

      return row;
    }

    async function buildList(target){
      const grouped = groupAnchors();
      if (!grouped.size) { target.textContent='No links found on visible cards.'; return; }
      target.innerHTML='';

      // sort by text
      const entries = [...grouped.entries()].sort((a,b)=>a[0].localeCompare(b[0]));
      for (const [text, anchors] of entries) {
        target.appendChild(makeRow(text, anchors));
      }
      $('#li-count', panel).textContent = `${entries.length} items`;
    }

    async function checkUrl(u){ try { const r = await fetch(u, { credentials:'same-origin' }); return { ok:r.ok, status:r.status }; } catch { return { ok:false, status:0 }; } }
    function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

    return { ensureButton };
  })();

  document.addEventListener('canvas-debug-changed', (e) => {
    if (e.detail?.on) LinkInspector.ensureButton();
  });

  /* ===========================
   * Boot
   * =========================== */
  (async () => {
    try {
      await loadAliases();
      await loadManifest();
      let obsidian = await (await fetch('tir.canvas.json')).json();
      const pos = await tryLoadPositions(); if (pos) obsidian = applyPositions(obsidian, pos);
      const data = adaptCanvas(obsidian);
      app.setData(data);
      resolveLinksNow();
      await enrichAll();
      app.fitToView({ margin:160, bias:'left', zoomOut:1.25, extraShiftX:0 });
      injectAllHTML();
      await rewriteLinksInDOM();
    } catch (e) {
      if (Debug.isOn()) console.error('Canvas boot failed:', e);
      app.setData({ items:[], edges:[] });
    }
    wireToolbar();
  })();
})();
