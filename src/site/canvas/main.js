// main.js — controller with manifest resolve, enrichment, debug (global),
// link rewriting to correct published URLs, safe save (passworded), left-biased fit.
(function () {
  const $ = (q, r=document) => r.querySelector(q);
  const container = $('#canvas-container');
  const world = $('#world');
  const app = new CanvasApp(container, world);
  window.CanvasAppInstance = app;

  /* ===========================
     Debug (GLOBAL, opt-in only)
     =========================== */
  const Debug = (() => {
    let on = false;
    try {
      const qs = new URLSearchParams(location.search);
      if (qs.get('debug') === '1') on = true;
      if (localStorage.getItem('canvasDebug') === '1') on = true;
    } catch {}
    function set(v) {
      on = !!v;
      try { localStorage.setItem('canvasDebug', on ? '1' : '0'); } catch {}
      document.documentElement.classList.toggle('canvas-debug', on);
      const cb = $('#debug-toggle'); if (cb) cb.checked = on;
    }
    function initToggle() {
      const tb = $('.toolbar'); if (!tb || $('#debug-toggle')) return;
      const wrap = document.createElement('label');
      wrap.style.cssText = 'display:flex;align-items:center;gap:6px;margin-left:6px;font:12px/1.2 monospace;opacity:.75;';
      wrap.title = 'Show canvas debugging badges and logs';
      wrap.innerHTML = `<input id="debug-toggle" type="checkbox" style="accent-color: currentColor;"><span>Debugging</span>`;
      tb.appendChild(wrap);
      const cb = wrap.querySelector('#debug-toggle');
      cb.checked = on; cb.addEventListener('change', () => set(cb.checked));
    }
    set(on);
    return { isOn: () => on, set, initToggle };
  })();
  window.Debug = Debug;

  /* ===========
     Helpers
     =========== */
  const isImg = p => /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(p||"");
  const encodeSegs = p => p.split('/').map(encodeURIComponent).join('/');
  const sanitize = p => { let s=String(p||'').replace(/[|]+$/g,'').replace(/\/{2,}/g,'/'); if(!s.startsWith('/')) s='/'+s; return s; };
  const slug = s => String(s||'').replace(/&/g,' and ').trim().replace(/\./g,' ').replace(/[^\p{L}\p{N}]+/gu,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').toLowerCase();
  const stripExt = p => String(p||'').replace(/\.[a-z0-9]+$/i,'');
  const lastSeg = p => { const a=String(p||'').split('/'); return a[a.length-1]||''; };
  const twoSeg = p => {
    const a = String(p||"").split("/").filter(Boolean);
    return a.slice(-2).join("/");
  };
  const norm = p => slug(stripExt(p));

  /* Extract/strip Obsidian image embeds from text nodes */
  const extractEmbeds = (txt) => {
    const out = []; const re=/!\[\[([^|\]]+)(?:\|[^]]*)?\]\]/g; let m;
    const s = String(txt||'');
    while ((m=re.exec(s))!==null) { let f=m[1].trim(); if(!/[\/\\]/.test(f)) f='Images/'+f; out.push(f); }
    return out;
  };
  const stripEmbeds = s => String(s||'').replace(/!\[\[[^\]]+\]\]/g,'').trim();
  const titleDesc = txt => { const lines=String(txt||'').split(/\r?\n/); const t=(lines[0]||'').replace(/^#+\s*/,'').trim()||'Text'; const d=lines.slice(1).join('\n').trim(); return {title:t, desc:d}; };

  /* Build a fallback site URL from a vault path */
  const noteUrlFromVault = (vp) => {
    if (!vp || isImg(vp)) return null;
    const parts = vp.replace(/\.md$/i,'').split('/').map((seg,i)=>{
      const sl = slug(seg);
      if (i===0 && /^3-?npcs$/.test(sl)) return '3-np-cs';
      return sl;
    }).filter(Boolean);
    return sanitize(parts.join('/') + '/');
  };

  /* Image candidate helpers */
  const imageCandidatesFromVault = (vp) => {
    if (!vp) return [];
    const stripped = vp.replace(/^Images\//i, '');
    const m = /^(.*?)(\.[^.]+)?$/.exec(stripped);
    const base = m[1] || stripped;
    const ext  = (m[2]||'').toLowerCase();
    const exts = ext ? Array.from(new Set([ext, ext.toUpperCase()])) : ['.png','.PNG','.jpg','.JPG','.jpeg','.JPEG'];
    const prefixes = ['/img/user/Images/','/img/user/images/','/img/'];
    const bases = Array.from(new Set([base, base.toLowerCase()]));
    const c = [];
    for (const p of prefixes) for (const b of bases) for (const e of exts) c.push(p + encodeSegs(b) + e);
    c.push('/img/user/Images/'+encodeSegs(stripped), '/img/user/images/'+encodeSegs(stripped), '/img/'+encodeSegs(stripped), '/img/Images/'+encodeSegs(stripped), '/canvas/Images/'+encodeSegs(stripped));
    return Array.from(new Set(c));
  };
  const nameImageGuesses = (title) => {
    if (!title) return [];
    const base = title.replace(/\.[^.]+$/,'');
    const vars = Array.from(new Set([
      base,
      base.replace(/[,()]/g,'').replace(/\s+/g,' ').trim(),
      base.replace(/\s+/g,' ')
    ]));
    const exts = ['.png','.jpg','.jpeg','.PNG','.JPG','.JPEG'];
    const out = [];
    for (const v of vars) for (const e of exts) out.push(`/img/user/Images/${encodeSegs(v)}${e}`);
    return out;
  };

  /* ===========
     Manifest
     =========== */
  let M = null;
  async function loadManifest() {
    try {
      const r = await fetch('/page-manifest.json', { credentials: 'same-origin' });
      if (!r.ok) throw 0;
      const man = await r.json();
      M = indexManifest(man);
      if (Debug.isOn()) window.__PageManifestIndex = M;
    } catch {
      M = { entries: [], byKey: new Map(), byTitle: new Map() };
    }
  }
  function indexManifest(man) {
    const entries = [];
    const byKey = new Map(); const byTitle = new Map();
    const push = (o)=>{ if(!o) return; const e={ url:o.url||o.href||o.permalink||null,
      filePathStem:o.filePathStem||o.filepathStem||o.stem||null, inputPath:o.inputPath||o.input||o.pageInputPath||o.source||null,
      source:o.sourcePath||o.page?.inputPath||o.data?.page?.inputPath||null, title:o.title||o.data?.title||null, raw:o };
      if (e.url||e.filePathStem||e.inputPath||e.source) entries.push(e);
    };
    (Array.isArray(man)?man:Object.values(man||{})).forEach(push);
    const add=(k,e)=>{ if(!k) return; const key=String(k).trim(); if(!key) return; (byKey.get(key)||byKey.set(key,[]).get(key)).push(e); };
    const normKey=s=>String(s||'').replace(/^\.?\/*/,'').toLowerCase();
    for (const e of entries) {
      const stem = e.filePathStem ? e.filePathStem.replace(/^\/*/,'') : '';
      [e.url,e.filePathStem,e.inputPath,e.source,normKey(stem),'/'+normKey(stem),normKey(e.inputPath),normKey(e.source)].forEach(k=>add(k,e));
      if (e.title){ const ts = slug(e.title); if(ts) (byTitle.get(ts)||byTitle.set(ts,[]).get(ts)).push(e); }
      const segs=(stem||'').split('/').filter(Boolean); const last2=segs.slice(-2).join('/'); const last3=segs.slice(-3).join('/');
      [last2,last3, slug(segs.slice(-2).join('/')), slug(segs.slice(-3).join('/'))].forEach(k=>add(k,e));
    }
    return { entries, byKey, byTitle };
  }
  const normCanvas = p => String(p||'').replace(/\\/g,'/').replace(/^\.?\/*/,'').replace(/\.md$/i,'').trim();
  function manifestKeys(canvasPath){
    const base = normCanvas(canvasPath), lc = base.toLowerCase();
    const raw = lc.split('/').filter(Boolean);
    const slugParts = raw.map(slug);
    if (slugParts[0]==='3-npcs' || slugParts[0]==='3--npcs') slugParts[0]='3-np-cs';
    const last = raw.at(-1)||'';
    const lastAlt = slug(last.replace(/[(),]/g,'').replace(/\s+/g,' ').trim());
    const c = new Set([
      base, lc, '/'+slugParts.join('/'), slugParts.join('/'),
      '/'+slugParts.slice(0,-1).concat([lastAlt]).join('/'),
      slugParts.slice(0,-1).concat([lastAlt]).join('/'),
      sanitize(noteUrlFromVault(canvasPath)||''),
      raw.slice(-2).join('/'), raw.slice(-3).join('/'),
      slug(raw.slice(-2).join('/')), slug(raw.slice(-3).join('/')),
      lc.replace(/[(),]/g,'').replace(/&/g,'and').replace(/\s+/g,'-')
    ]);
    return Array.from(c).filter(Boolean);
  }
  function resolveFromManifest(canvasPath){
    if (!M) return null;
    for (const key of manifestKeys(canvasPath)) {
      const arr = M.byKey.get(String(key).trim());
      if (arr?.length) return (arr.find(e=>!!e.url)||arr[0]).url || null;
    }
    const last = slug(normCanvas(canvasPath).split('/').pop());
    const tl = last && M.byTitle.get(last); if (tl?.length) return (tl.find(e=>!!e.url)||tl[0]).url || null;
    const lc = normCanvas(canvasPath).toLowerCase();
    for (const e of M.entries) {
      if ((e.filePathStem && lc.endsWith(String(e.filePathStem).toLowerCase())) ||
          (e.inputPath && lc.endsWith(String(e.inputPath).toLowerCase())) ||
          (e.source && lc.endsWith(String(e.source).toLowerCase()))) return e.url || null;
    }
    return null;
  }

  /* ===========================
     LINK REWRITING (DOM-level)
     =========================== */

  // Aliases to resolve plain text or ambiguous links.
  const LINK_ALIAS = new Map([
    ["Avalon", "Avalon (Between Astra & Terra)"],
    ["Hikoboshi Koi", "Hikoboshi Koi"],
    ["Abigale", "Abigale Teach"],
    ["Cartha", "Cartha Coccineus, the Scarlet Priestess"],
    ["Xavier Crepus", "Xavier Crepus"],
    ["Amantha the fourth", "Amantha the Fourth"],
    ["Argent", "Argent"],
    ["Kingdom of Midgard", "Kingdom of Midgard"],
    ["Leones", "Leones"],
    ["The Coastal Coalition", "The Coastal Coalition"],
  ]);

  async function ensureManifestIndexForLinks() {
    if (!M) await loadManifest();
    return M;
  }

  function pickBest(arr) {
    if (!arr || !arr.length) return null;
    return arr.find(e => e.url) || arr[0];
  }

  async function resolveUrlFromHrefOrText(href, text) {
    await ensureManifestIndexForLinks();
    const byStem = M.byKey;
    const byTitle = M.byTitle;

    // absolute external -> keep
    if (/^https?:\/\//i.test(href)) return href;

    const hClean = decodeURIComponent(href || "").replace(/^\/+/, "").replace(/&amp;/gi, "and");
    const stem1  = norm(hClean);
    const stem2  = norm(lastSeg(hClean));
    const stem3  = norm(twoSeg(hClean));

    // try stems
    let arr = byStem.get(stem1) || byStem.get('/'+stem1);
    let hit = pickBest(arr) || pickBest(byStem.get(stem2)) || pickBest(byStem.get(stem3));
    if (hit && hit.url) return hit.url;

    // image href but text is the title
    const looksImage = /\.[a-z0-9]{3,4}$/i.test(hClean);
    if (looksImage && text) {
      const tNorm = norm(text);
      hit = pickBest(byTitle.get(tNorm));
      if (hit && hit.url) return hit.url;
    }

    // try href as title directly
    hit = pickBest(byTitle.get(stem1));
    if (hit && hit.url) return hit.url;

    // try alias via text or href
    const aliasKey =
      (text && LINK_ALIAS.has(text)) ?
        text :
        [...LINK_ALIAS.keys()].find(k => slug(k) === stem1);
    if (aliasKey) {
      const target = LINK_ALIAS.get(aliasKey);
      hit = pickBest(byTitle.get(norm(target)));
      if (hit && hit.url) return hit.url;
    }

    // fallback: leave original
    return href;
  }

  async function rewriteLinksInDOM(root=document) {
    const anchors = root.querySelectorAll('.card .md-body a[href]');
    const jobs = Array.from(anchors).map(async a => {
      const href = a.getAttribute('href') || '';
      const txt = a.textContent.trim();
      const newHref = await resolveUrlFromHrefOrText(href, txt);
      a.setAttribute('href', newHref);
    });
    await Promise.all(jobs);
  }

  /* ===========================
     HTML enrichment (teaser/img)
     =========================== */
  async function tryFetch(url) {
    const u = new URL(url, location.origin);
    const base = sanitize(u.pathname);
    const withSlash = base.endsWith('/') ? base : base + '/';
    const without = base.endsWith('/') ? base.slice(0, -1) : base;
    const variants = [withSlash, without, withSlash + 'index.html', withSlash + 'index.htm'];
    for (const p of variants) {
      try {
        const r = await fetch(new URL(p, location.origin), { credentials: 'same-origin' });
        if (r.ok) return { ok: true, url: String(new URL(p, location.origin)), html: await r.text() };
      } catch {}
    }
    return { ok: false, url, html: '' };
  }
  const firstTeaser = (doc) => {
    const pick = s => { const ps = doc.querySelectorAll(s);
      for (const p of ps){ const t=(p.textContent||'').replace(/\s+/g,' ').trim(); if (t.length>10) return t; } };
    return pick('main p') || pick('article p') || pick('.content p') || pick('.prose p') ||
           pick('.markdown-rendered p') || pick('.markdown-body p') || pick('.post p') ||
           pick('#content p') || pick('.page-content p') || pick('.entry-content p') ||
           pick('.note-content p') || pick('p') || '';
  };
  const firstImage = (doc, pageUrl) => {
    const og = doc.querySelector('meta[property="og:image"], meta[name="og:image"]');
    if (og?.content) return new URL(og.content, pageUrl).href;
    const pre = doc.querySelector('link[rel="preload"][as="image"][href]');
    if (pre) return new URL(pre.getAttribute('href'), pageUrl).href;
    const sel = s => { const img = doc.querySelector(s); if (!img) return '';
      const ss=img.getAttribute('srcset'); if (ss) return new URL(ss.split(',')[0].trim().split(/\s+/)[0], pageUrl).href;
      const lazy=img.getAttribute('data-src')||img.getAttribute('data-lazy-src')||img.getAttribute('data-original'); if (lazy) return new URL(lazy, pageUrl).href;
      const src=img.getAttribute('src'); return src? new URL(src, pageUrl).href : ''; };
    return sel('main img') || sel('article img') || sel('.content img') || sel('.prose img') ||
           sel('.markdown-rendered img') || sel('.markdown-body img') || sel('.post img') ||
           sel('#content img') || sel('.page img') || sel('.entry-content img') ||
           sel('figure img') || sel('img') || '';
  };
  const pageCache = new Map();
  async function fetchPageInfo(url) {
    if (pageCache.has(url)) return pageCache.get(url);
    const p = (async () => {
      const t = await tryFetch(url);
      if (!t.ok) throw new Error('ENR404 '+url);
      const doc = new DOMParser().parseFromString(t.html, 'text/html');
      return { finalUrl: t.url, image: firstImage(doc, t.url), teaser: firstTeaser(doc) };
    })();
    pageCache.set(url, p); return p;
  }

  function addBadge(itemId, text, bg = '#555') {
    if (!Debug.isOn()) return;
    const el = [...document.querySelectorAll('.card')].find(n => n._itemId === itemId);
    if (!el) return;
    const b = document.createElement('div');
    b.textContent = text;
    b.style.cssText = `position:absolute;top:8px;left:8px;background:${bg};color:#fff;font:bold 11px/1.6 monospace;padding:2px 6px;border-radius:6px;`;
    el.appendChild(b);
  }

  /* ===========================
     Adapt Obsidian JSON → data
     =========================== */
  function adaptCanvas(json) {
    const items = []; const edges = [];
    for (const n of json.nodes || []) {
      const common = { id: n.id, x: Number.isFinite(n.x)?n.x:0, y: Number.isFinite(n.y)?n.y:0 };
      if (n.type === 'text') {
        const embeds = extractEmbeds(n.text);
        const td = titleDesc(stripEmbeds(n.text));
        const it = { ...common, title: td.title, description: td.desc };
        if (embeds.length) it.imageCandidates = imageCandidatesFromVault(embeds[0]);
        items.push(it); continue;
      }
      if (n.type === 'file') {
        const f = String(n.file || '');
        if (isImg(f)) {
          items.push({ ...common, title: f.split('/').pop().replace(/\.[^.]+$/,''), description:'', imageCandidates: imageCandidatesFromVault(f) });
        } else {
          const parts = f.replace(/\.md$/i, '').split('/'); const title = parts.pop(); const crumb = parts.length ? parts.join(' › ') : '';
          items.push({ ...common, title, description: crumb, _canvasPath: f, _needsManifestResolve: true, _needsEnrich: true, _nameGuesses: nameImageGuesses(title) });
        }
        continue;
      }
      items.push({ ...common, title: n.type || 'node', description: n.file || n.text || '' });
    }
    for (const e of (json.edges || [])) edges.push({ from: e.fromNode, to: e.toNode, label: e.label || '' });
    return { items, edges };
  }

  /* ===========================
     Resolve links & enrich
     =========================== */
  function resolveLinks(app) {
    for (const it of (app.data.items || [])) {
      if (!it._needsManifestResolve) continue;
      it.link = resolveFromManifest(it._canvasPath) || noteUrlFromVault(it._canvasPath);
      delete it._needsManifestResolve;
    }
    app.render();
    // After render, rewrite any anchors inside cards to real published URLs
    rewriteLinksInDOM().catch(() => {});
  }

  async function enrich(app) {
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
              const cands = []; if (info.image) cands.push(info.image);
              if (it._nameGuesses) cands.push(...it._nameGuesses);
              if (it.imageCandidates) cands.push(...it.imageCandidates);
              it.imageCandidates = Array.from(new Set(cands));
              if (info.teaser) it.description = it.description ? `${it.description}\n${info.teaser}` : info.teaser;
              if ((!info.teaser?.trim()) && (!it.imageCandidates?.length)) {
                addBadge(it.id, 'NO CONTENT', '#7f8c8d');
              }
              app.render();
              await rewriteLinksInDOM();
            } catch (e) {
              addBadge(it.id, 'ENR 404', '#555');
              if (Debug.isOn()) console.warn('Enrich failed for', it.link, e);
            } finally {
              delete it._needsEnrich; delete it._nameGuesses; active--; q.length ? pump() : !active && done();
            }
          })();
        }
      };
      q.length ? pump() : done();
    });
  }

  /* ===========================
     Positions load/save
     =========================== */
  async function tryLoadPositions(url='/canvas/tir.positions.json'){
    try { const r=await fetch(url,{credentials:'same-origin'}); if(!r.ok) return null; const j=await r.json(); return j?.positions||null; } catch { return null; }
  }
  function applyPositions(obsidian, pos){
    if (!obsidian?.nodes || !pos) return obsidian;
    for (const n of obsidian.nodes) if (n?.id && pos[n.id]) { const p=pos[n.id]; if (Number.isFinite(p.x)) n.x=p.x; if (Number.isFinite(p.y)) n.y=p.y; }
    return obsidian;
  }

  async function savePositionsToRepo(){
    const btn = $('#btn-save-repo');
    try{
      btn && (btn.disabled=true, btn.classList.add('saving'), btn.textContent='Saving…');

      let auth = localStorage.getItem('canvasSaveAuth');
      if (!auth) {
        auth = prompt('Enter canvas save password:') || '';
        if (!auth) throw new Error('No password provided');
        localStorage.setItem('canvasSaveAuth', auth);
      }

      const data = app.getData(); const positions = {};
      for (const it of (data.items||[])) if (it.id) positions[it.id] = { x:it.x, y:it.y };

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

      btn && (btn.textContent='Saved ✓', setTimeout(()=>{ btn.textContent='Save to Repo'; btn.classList.remove('saving'); btn.disabled=false; }, 1200));
    }catch(e){
      alert('Save failed. See console.'); console.error(e);
      btn && (btn.textContent='Save to Repo', btn.classList.remove('saving'), btn.disabled=false);
    }
  }

  /* ===========================
     Toolbar
     =========================== */
  function ensureToolbar(){ let tb=$('.toolbar'); if(!tb){ tb=document.createElement('div'); tb.className='toolbar'; document.body.appendChild(tb); } return tb; }
  function ensureBtn(tb,id,label,title){ let b=$('#'+id); if(!b){ b=document.createElement('button'); b.id=id; b.type='button'; b.textContent=label; if(title) b.title=title; tb.appendChild(b);} return b; }
  function wireToolbar(){
    const tb = ensureToolbar();
    ensureBtn(tb,'btn-reset','Reset View').onclick = ()=> app.resetView();
    ensureBtn(tb,'btn-save','Download JSON').onclick = ()=>{
      const blob = new Blob([JSON.stringify(app.getData(),null,2)],{type:'application/json'});
      const url = URL.createObjectURL(blob); const a=Object.assign(document.createElement('a'),{href:url,download:'data.json'}); document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    };
    ensureBtn(tb,'btn-save-repo','Save to Repo','Commit canvas positions to repository').onclick = savePositionsToRepo;
    if (!$('#zoom-level')) { const span=document.createElement('span'); span.id='zoom-level'; span.textContent='100%'; span.style.marginLeft='8px'; tb.appendChild(span); }
    Debug.initToggle();
  }

  /* ===========================
     Boot
     =========================== */
  (async () => {
    try {
      await loadManifest();
      let obsidian = await (await fetch('tir.canvas.json')).json();
      const pos = await tryLoadPositions();
      if (pos) obsidian = applyPositions(obsidian, pos);
      const data = adaptCanvas(obsidian);
      app.setData(data);
      resolveLinks(app);
      await enrich(app);

      // Initial left-biased fit and slightly more zoomed out
      app.fitToView({ margin: 160, bias: 'left', zoomOut: 1.25, extraShiftX: 0 });
      await rewriteLinksInDOM();
    } catch (e) {
      if (Debug.isOn()) console.error('Failed to load/enrich canvas:', e);
      app.setData({ items: [], edges: [] });
    }

    wireToolbar();
  })();

  /* ===========================
     (local) adaptCanvas helper
     =========================== */
  function adaptCanvas(json) {
    const items = []; const edges = [];
    for (const n of json.nodes || []) {
      const common = { id: n.id, x: Number.isFinite(n.x)?n.x:0, y: Number.isFinite(n.y)?n.y:0 };
      if (n.type === 'text') {
        const embeds = extractEmbeds(n.text);
        const td = titleDesc(stripEmbeds(n.text));
        const it = { ...common, title: td.title, description: td.desc };
        if (embeds.length) it.imageCandidates = imageCandidatesFromVault(embeds[0]);
        items.push(it); continue;
      }
      if (n.type === 'file') {
        const f = String(n.file || '');
        if (isImg(f)) {
          items.push({ ...common, title: f.split('/').pop().replace(/\.[^.]+$/,''), description:'', imageCandidates: imageCandidatesFromVault(f) });
        } else {
          const parts = f.replace(/\.md$/i, '').split('/'); const title = parts.pop(); const crumb = parts.length ? parts.join(' › ') : '';
          items.push({ ...common, title, description: crumb, _canvasPath: f, _needsManifestResolve: true, _needsEnrich: true, _nameGuesses: nameImageGuesses(title) });
        }
        continue;
      }
      items.push({ ...common, title: n.type || 'node', description: n.file || n.text || '' });
    }
    for (const e of (json.edges || [])) edges.push({ from: e.fromNode, to: e.toNode, label: e.label || '' });
    return { items, edges };
  }
})();

/* ===========
   Simple wiki-link resolver (optional, used elsewhere)
   =========== */
(function(){
  const slug = s => String(s||'')
    .replace(/&/g,' and ')
    .trim()
    .replace(/\./g,' ')
    .replace(/[^\p{L}\p{N}]+/gu,'-')
    .replace(/-+/g,'-')
    .replace(/^-|-$/g,'')
    .toLowerCase();

  function resolveByTitle(title) {
    try {
      const t = slug(title);
      if (window.__PageManifestIndex && window.__PageManifestIndex.byTitle) {
        const hit = window.__PageManifestIndex.byTitle.get(t);
        if (hit && hit.length) return (hit.find(e=>!!e.url) || hit[0]).url || ('/'+t+'/');
      }
    } catch {}
    return '/'+slug(title)+'/';
  }

  window.resolveNoteLink = function(noteTitle){
    const url = resolveByTitle(noteTitle);
    return url.endsWith('/') ? url : (url + '/');
  };
})();
