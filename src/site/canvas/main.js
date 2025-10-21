// main.js — Canvas controller: manifest resolve, enrichment with HTML snippets,
// passworded save + upload, debug toggle (no refresh), positions, link rewriting.
// Works with canvas.js that adds el._itemId to each card element.

(function () {
  /* ---------- tiny DOM helpers ---------- */
  const $  = (q, r = document) => r.querySelector(q);
  const $$ = (q, r = document) => Array.from(r.querySelectorAll(q));

  const container = $('#canvas-container');
  const world     = $('#world');
  const app       = new CanvasApp(container, world);

  // Expose for console
  window.CanvasAppInstance = app;

  /* ===========================
   * Debug (global, instant toggle)
   * =========================== */
  const Debug = (() => {
    let on = false;

    // initial state: ?debug=1 or localStorage
    try {
      const qs = new URLSearchParams(location.search);
      if (qs.get('debug') === '1') on = true;
      if (localStorage.getItem('canvasDebug') === '1') on = true;
    } catch {}

    function apply() {
      document.documentElement.classList.toggle('canvas-debug', on);
      const cb = $('#debug-toggle'); if (cb) cb.checked = on;
      // show/hide existing debug badges without re-render
      $$('.card ._dbg').forEach(b => { b.style.display = on ? '' : 'none'; });
    }
    function set(v) {
      on = !!v;
      try { localStorage.setItem('canvasDebug', on ? '1' : '0'); } catch {}
      apply();
    }
    function initToggle() {
      const tb = $('.toolbar'); if (!tb || $('#debug-toggle')) return;
      const wrap = document.createElement('label');
      wrap.className = 'debug-wrap';
      wrap.title = 'Show canvas debugging badges and logs';
      wrap.innerHTML = `
        <input id="debug-toggle" type="checkbox" />
        <span>Debugging</span>`;
      tb.appendChild(wrap);
      const cb = wrap.querySelector('#debug-toggle');
      cb.checked = on;
      cb.addEventListener('change', () => set(cb.checked));
    }
    // first paint
    apply();
    return { isOn: () => on, set, initToggle };
  })();
  window.Debug = Debug;

  /* ===========================
   * Helpers
   * =========================== */
  const isImg   = p => /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(p || '');
  const stripExt = p => String(p || '').replace(/\.[a-z0-9]+$/i, '');
  const slug = s => String(s || '')
    .replace(/&/g, ' and ')
    .trim()
    .replace(/\./g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();

  const sanitizePath = p => {
    let s = String(p || '').replace(/[|]+$/g, '').replace(/\/{2,}/g, '/');
    if (!s.startsWith('/')) s = '/' + s;
    return s;
  };

  const encodeSegs = p => p.split('/').map(encodeURIComponent).join('/');

  // Extract Obsidian image embeds from a text node: ![[Foo.png]] (with optional pipe)
  const extractEmbeds = (txt) => {
    const out = []; const re = /!\[\[([^|\]]+)(?:\|[^]]*)?\]\]/g; let m;
    const s = String(txt || '');
    while ((m = re.exec(s)) !== null) {
      let f = m[1].trim();
      if (!/[\/\\]/.test(f)) f = 'Images/' + f; // bare name -> Images/
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

  // Map a vault path to the *published* URL stem as fallback.
  const noteUrlFromVault = (vp) => {
    if (!vp || isImg(vp)) return null;
    const parts = vp.replace(/\.md$/i, '').split('/').map((seg, i) => {
      const sl = slug(seg);
      if (i === 0 && /^3-?npcs$/.test(sl)) return '3-np-cs'; // special alias
      return sl;
    }).filter(Boolean);
    return sanitizePath(parts.join('/') + '/');
  };

  // Image candidates for a vault image path or bare name (robust)
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
    // add raw fallbacks too
    c.push('/img/user/Images/' + encodeSegs(stripped));
    return Array.from(new Set(c));
  };

  // Try to guess an image by card title too
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
   * Manifest (page-manifest.json)
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
   * Link rewriting inside cards
   * =========================== */
  // Special aliases for ambiguous link text (optional)
  const LINK_ALIAS = new Map([
    ['Avalon', 'Avalon (Between Astra & Terra)'],
    ['Abigale', 'Abigale Teach'],
    ['Cartha', 'Cartha Coccineus, the Scarlet Priestess'],
    ['Xavier Crepus', 'Xavier Crepus'],
    ['Amantha the fourth', 'Amantha the Fourth'],
    ['Argent', 'Argent'],
    ['Kingdom of Midgard', 'Kingdom of Midgard'],
    ['Leones', 'Leones'],
    ['The Coastal Coalition', 'The Coastal Coalition'],
  ]);

  function pickBest(arr) { if (!arr || !arr.length) return null; return arr.find(e => e.url) || arr[0]; }

  async function ensureManifestForLinks() { if (!M) await loadManifest(); return M; }

  async function resolveUrlFromHrefOrText(href, text) {
    await ensureManifestForLinks();
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
      const aliasKey = LINK_ALIAS.has(text) ? text : null;
      if (aliasKey) {
        const target = LINK_ALIAS.get(aliasKey);
        hit = pickBest(byTitle.get(slug(target)));
        if (hit?.url) return hit.url;
      }
      hit = pickBest(byTitle.get(slug(text)));
      if (hit?.url) return hit.url;
    }
    return href;
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
   * Enrichment helpers (HTML snippet + image)
   * =========================== */

  async function tryFetch(url) {
    // probe common variants to dodge trailing-slash issues
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
    const picks = [
      'main .markdown-rendered', 'article .markdown-rendered',
      'main .content, article .content',
      'main .prose, article .prose',
      'main .markdown-body, article .markdown-body',
      'main, article', '.page-content', '.entry-content', '.post'
    ];
    for (const sel of picks) {
      const el = doc.querySelector(sel);
      if (!el) continue;
      // choose a paragraph or block with some weight
      const candidates = el.querySelectorAll('p, .callout, blockquote, ul, ol');
      for (const c of candidates) {
        const text = (c.textContent || '').replace(/\s+/g, ' ').trim();
        if (text.length > 10) return c.outerHTML;
      }
    }
    return '';
  };

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
      return { finalUrl: t.url, image: firstImageFromPage(doc, t.url), htmlSnippet: firstHTML(doc) };
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

  // Inject a pre-rendered HTML snippet into the card (keeps Markdown look)
  function injectHTMLForItem(it) {
    if (!it || !it.id || !it.descriptionHtml) return;
    const card = $$('.card').find(n => n._itemId === it.id);
    if (!card) return;
    const body = card.querySelector('.md-body') || card.querySelector('.card-body') || card;
    // set once per render; safe to replace
    body.innerHTML = it.descriptionHtml;
  }

  function injectAllHTML(items) {
    (items || app.data.items || []).forEach(injectHTMLForItem);
  }

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
          // image-only card
          items.push({
            ...common,
            title: f.split('/').pop().replace(/\.[^.]+$/, ''),
            description: '',
            imageCandidates: imageCandidatesFromVault(f)
          });
        } else {
          // markdown file card (enrich later)
          const parts = f.replace(/\.md$/i, '').split('/');
          const title = parts.pop();
          const crumb = parts.length ? parts.join(' › ') : '';
          items.push({
            ...common,
            title,
            description: crumb,
            _canvasPath: f,
            _needsManifestResolve: true,
            _needsEnrich: true,
            _nameGuesses: guessesFromTitle(title)
          });
        }
        continue;
      }

      // fallback
      items.push({ ...common, title: n.type || 'node', description: n.file || n.text || '' });
    }

    for (const e of (json.edges || [])) {
      // CanvasApp draws arrows if present; keep minimal shape
      edges.push({ from: e.fromNode, to: e.toNode, label: e.label || '' });
    }

    return { items, edges };
  }

  /* ===========================
   * Resolve links & enrich
   * =========================== */
  function resolveLinksNow() {
    for (const it of (app.data.items || [])) {
      if (!it._needsManifestResolve) continue;
      it.link = resolveFromManifest(it._canvasPath) || noteUrlFromVault(it._canvasPath);
      delete it._needsManifestResolve;
    }
    app.render();                    // ensures cards exist
    injectAllHTML();                 // re-apply html (no-op initially)
    rewriteLinksInDOM().catch(() => {});
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

              // images: page first, then guesses
              const cands = [];
              if (info.image) cands.push(info.image);
              if (it._nameGuesses) cands.push(...it._nameGuesses);
              if (it.imageCandidates) cands.push(...it.imageCandidates);
              it.imageCandidates = Array.from(new Set(cands));

              // rich body html
              if (info.htmlSnippet) it.descriptionHtml = info.htmlSnippet;

              // render/inject per item for immediate feedback
              app.render();
              injectHTMLForItem(it);
              await rewriteLinksInDOM();
              if ((!info.htmlSnippet?.trim()) && (!it.imageCandidates?.length)) {
                addBadge(it.id, 'NO CONTENT', '#7f8c8d');
              }
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
   * Positions: load/apply/save
   * =========================== */
  async function tryLoadPositions(url = '/canvas/tir.positions.json') {
    try {
      const r = await fetch(url, { credentials: 'same-origin' });
      if (!r.ok) return null;
      const j = await r.json();
      return j?.positions || null;
    } catch { return null; }
  }
  function applyPositions(obsidian, pos) {
    if (!obsidian?.nodes || !pos) return obsidian;
    for (const n of obsidian.nodes) {
      if (n?.id && pos[n.id]) {
        const p = pos[n.id];
        if (Number.isFinite(p.x)) n.x = p.x;
        if (Number.isFinite(p.y)) n.y = p.y;
      }
    }
    return obsidian;
  }

  async function savePositionsToRepo() {
    const btn = $('#btn-save-repo');
    try {
      if (btn) { btn.disabled = true; btn.classList.add('saving'); btn.textContent = 'Saving…'; }

      let auth = localStorage.getItem('canvasSaveAuth');
      if (!auth) {
        auth = prompt('Enter canvas save password:') || '';
        if (!auth) throw new Error('No password provided');
        localStorage.setItem('canvasSaveAuth', auth);
      }

      const data = app.getData();
      const positions = {};
      for (const it of (data.items || [])) if (it.id) positions[it.id] = { x: it.x, y: it.y };

      const payload = {
        path: 'src/site/canvas/tir.positions.json',
        data: { positions, updatedAt: new Date().toISOString(), version: 1 },
        message: 'chore(canvas): update node positions',
        auth
      };

      const r = await fetch('/api/save-canvas', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload)
      });

      if (r.status === 401) {
        localStorage.removeItem('canvasSaveAuth');
        throw new Error('Unauthorized (bad password)');
      }
      if (!r.ok) throw new Error(`Save failed ${r.status}`);

      if (btn) {
        btn.textContent = 'Saved ✓';
        setTimeout(() => { btn.textContent = 'Save to Repo'; btn.classList.remove('saving'); btn.disabled = false; }, 1100);
      }
    } catch (e) {
      console.error(e);
      alert('Save failed. See console for details.');
      if (btn) { btn.textContent = 'Save to Repo'; btn.classList.remove('saving'); btn.disabled = false; }
    }
  }

  /* ===========================
   * Upload .canvas → commit + live load
   * =========================== */
  async function commitFileToRepo(path, dataObj, message) {
    let auth = localStorage.getItem('canvasSaveAuth');
    if (!auth) {
      auth = prompt('Enter canvas save password:') || '';
      if (!auth) throw new Error('No password provided');
      localStorage.setItem('canvasSaveAuth', auth);
    }
    const payload = { path, data: dataObj, message, auth };
    const r = await fetch('/api/save-canvas', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload)
    });
    if (r.status === 401) {
      localStorage.removeItem('canvasSaveAuth');
      throw new Error('Unauthorized (bad password)');
    }
    if (!r.ok) throw new Error(`Commit failed ${r.status}`);
    return r.json().catch(() => ({}));
  }

  async function loadCanvasObject(obsidianJson) {
    let obsidian = obsidianJson;
    try {
      const pos = await tryLoadPositions();
      if (pos) obsidian = applyPositions(obsidian, pos);
    } catch {}
    const data = adaptCanvas(obsidian);
    app.setData(data);
    resolveLinksNow();
    await enrichAll();
    // Left-biased fit and slightly zoomed out
    app.fitToView({ margin: 160, bias: 'left', zoomOut: 1.25, extraShiftX: 0 });
    injectAllHTML();
    await rewriteLinksInDOM();
  }

  function wireUploadUI(tb) {
    // hidden <input type=file>
    let fi = $('#canvas-file-input');
    if (!fi) {
      fi = document.createElement('input');
      fi.type = 'file';
      fi.accept = '.canvas,application/json';
      fi.id = 'canvas-file-input';
      fi.style.display = 'none';
      document.body.appendChild(fi);
    }

    const btn = ensureBtn(tb, 'btn-upload-canvas', 'Upload .canvas', 'Replace tir.canvas.json with your exported file, then render immediately');
    btn.onclick = async () => {
      fi.value = '';
      fi.onchange = async () => {
        const f = fi.files?.[0]; if (!f) return;
        try {
          btn.disabled = true; btn.textContent = 'Uploading…';
          const text = await f.text();
          const json = JSON.parse(text);
          if (!json || !Array.isArray(json.nodes) || !Array.isArray(json.edges)) {
            throw new Error('Not a valid Obsidian .canvas JSON');
          }
          await commitFileToRepo('src/site/canvas/tir.canvas.json', json, `chore(canvas): replace tir.canvas.json via upload (${f.name})`);
          await loadCanvasObject(json);
          btn.textContent = 'Uploaded ✓';
          setTimeout(() => { btn.textContent = 'Upload .canvas'; btn.disabled = false; }, 1000);
        } catch (e) {
          console.error(e);
          alert('Upload failed. See console for details.');
          btn.textContent = 'Upload .canvas';
          btn.disabled = false;
        }
      };
      fi.click();
    };

    // Drag & drop anywhere
    window.addEventListener('dragover', e => e.preventDefault());
    window.addEventListener('drop', async e => {
      if (!e.dataTransfer) return;
      const f = [...e.dataTransfer.files].find(x => /\.canvas$/i.test(x.name) || /\.json$/i.test(x.name));
      if (!f) return;
      e.preventDefault();
      try {
        const text = await f.text();
        const json = JSON.parse(text);
        await commitFileToRepo('src/site/canvas/tir.canvas.json', json, `chore(canvas): replace tir.canvas.json via drag&drop (${f.name})`);
        await loadCanvasObject(json);
      } catch (err) {
        console.error(err);
        alert('Drag & drop upload failed.');
      }
    });
  }

  /* ===========================
   * Toolbar
   * =========================== */
  function ensureToolbar() { let tb = $('.toolbar'); if (!tb) { tb = document.createElement('div'); tb.className = 'toolbar'; document.body.appendChild(tb); } return tb; }
  function ensureBtn(tb, id, label, title) {
    let b = $('#' + id);
    if (!b) { b = document.createElement('button'); b.id = id; b.type = 'button'; b.textContent = label; if (title) b.title = title; tb.appendChild(b); }
    return b;
  }

  function wireToolbar() {
    const tb = ensureToolbar();
    ensureBtn(tb, 'btn-reset', 'Reset View').onclick = () => app.resetView();
    ensureBtn(tb, 'btn-save', 'Download JSON').onclick = () => {
      const blob = new Blob([JSON.stringify(app.getData(), null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: 'data.json' });
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    };
    ensureBtn(tb, 'btn-save-repo', 'Save to Repo', 'Commit canvas positions to repository').onclick = savePositionsToRepo;

    wireUploadUI(tb);

    if (!$('#zoom-level')) {
      const span = document.createElement('span');
      span.id = 'zoom-level'; span.textContent = '100%'; span.style.marginLeft = '8px';
      tb.appendChild(span);
    }
    Debug.initToggle();
  }

  /* ===========================
   * Boot
   * =========================== */
  (async () => {
    try {
      await loadManifest();
      // Load canvas JSON, merge saved positions (if any), then render
      let obsidian = await (await fetch('tir.canvas.json')).json();
      const pos = await tryLoadPositions();
      if (pos) obsidian = applyPositions(obsidian, pos);

      const data = adaptCanvas(obsidian);
      app.setData(data);

      resolveLinksNow();     // create links & render once
      await enrichAll();     // fetch snippets + images

      // Left-biased fit, slightly zoomed out (room to the right)
      app.fitToView({ margin: 160, bias: 'left', zoomOut: 1.25, extraShiftX: 0 });

      injectAllHTML();       // ensure cards show formatted HTML
      await rewriteLinksInDOM();

    } catch (e) {
      if (Debug.isOn()) console.error('Failed to load/enrich canvas:', e);
      app.setData({ items: [], edges: [] });
    }

    wireToolbar();
  })();
})();
