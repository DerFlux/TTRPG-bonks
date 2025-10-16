// main.js — slim controller (manifest resolve, enrichment, debug, save positions)
(function () {
  // ---------- boot & debug ----------
  const $ = (q, r=document) => r.querySelector(q);
  const on = (n,t,h,o)=>n&&n.addEventListener(t,h,o);
  const dbg = (()=>{ let on=false;
    try{ const q=new URLSearchParams(location.search); on = q.get('debug')==='1' || localStorage.canvasDebug==='1'; }catch{}
    const set=v=>{ on=!!v; localStorage.canvasDebug = on?'1':'0'; document.documentElement.classList.toggle('canvas-debug',on); const c=$('#debug-toggle'); if(c) c.checked=on; };
    const init=()=>{ const tb=$('.toolbar'); if(!tb||$('#debug-toggle')) return; const w=document.createElement('label'); w.style.cssText='display:flex;align-items:center;gap:6px;margin-left:6px;font:12px/1.2 monospace;opacity:.75;'; w.title='Show canvas debugging badges and logs'; w.innerHTML='<input id="debug-toggle" type="checkbox" style="accent-color:currentColor"><span>Debugging</span>'; tb.appendChild(w); const c=$('#debug-toggle'); c.checked=on; onChange(c,()=>set(c.checked)); };
    const log=(...a)=>{ if(on) console.log(...a); }, warn=(...a)=>{ if(on) console.warn(...a); }, error=(...a)=>{ if(on) console.error(...a); };
    set(on); return { get:()=>on, set, init, log, warn, error };
  })();
  const onChange=(el,fn)=>el&&el.addEventListener('change',fn);

  const container = $('#canvas-container');
  const world = $('#world');
  const app = new CanvasApp(container, world);
  window.CanvasAppInstance = app;

  // ---------- helpers ----------
  const isImg = p => /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(p||"");
  const encodeSegs = p => p.split('/').map(encodeURIComponent).join('/');
  const sanitize = p => { let s=String(p||'').replace(/[|]+$/g,'').replace(/\/{2,}/g,'/'); if(!s.startsWith('/')) s='/'+s; return s; };
  const slug = s => String(s||'').replace(/&/g,' and ').trim().replace(/\./g,' ').replace(/[^\p{L}\p{N}]+/gu,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').toLowerCase();

  const noteUrlFromVault = (vp) => {
    if (!vp || isImg(vp)) return null;
    const parts = vp.replace(/\.md$/i,'').split('/').map((seg,i)=>{
      const sl = slug(seg);
      if (i===0 && /^3-?npcs$/.test(sl)) return '3-np-cs';
      return sl;
    }).filter(Boolean);
    return sanitize(parts.join('/') + '/');
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

  const extractEmbeds = txt => {
    const out = []; const re=/!\[\[([^|\]]+)(?:\|[^]]*)?\]\]/g; let m;
    const s = String(txt||'');
    while ((m=re.exec(s))!==null) { let f=m[1].trim(); if(!/[\/\\]/.test(f)) f='Images/'+f; out.push(f); }
    return out;
  };
  const stripEmbeds = s => String(s||'').replace(/!\[\[[^\]]+\]\]/g,'').trim();
  const titleDesc = txt => { const lines=String(txt||'').split(/\r?\n/); const t=(lines[0]||'').replace(/^#+\s*/,'').trim()||'Text'; const d=lines.slice(1).join('\n').trim(); return {title:t, desc:d}; };

  // ---------- manifest resolve ----------
  let M = null;
  async function loadManifest() {
    try {
      const r = await fetch('/page-manifest.json', { credentials:'same-origin' });
      if (!r.ok) throw 0;
      const man = await r.json(); M = indexManifest(man);
      if (dbg.get()) window.__PageManifestIndex = M;
    } catch { dbg.warn('No /page-manifest.json; using slug fallback.'); M = { entries:[], byKey:new Map(), byTitle:new Map() }; }
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
    const norm=s=>String(s||'').replace(/^\.?\/*/,'').toLowerCase();
    for (const e of entries) {
      const stem = e.filePathStem ? e.filePathStem.replace(/^\/*/,'') : '';
      [e.url,e.filePathStem,e.inputPath,e.source,norm(stem),'/'+norm(stem),norm(e.inputPath),norm(e.source)].forEach(k=>add(k,e));
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

  // ---------- enrichment ----------
  const tryFetch = async (url) => {
    const u = new URL(url, location.origin); const base = sanitize(u.pathname);
    const v = [ base.endsWith('/')?base:base+'/', base.endsWith('/')?base.slice(0,-1):base, (base.endsWith('/')?base:base+'/')+'index.html', (base.endsWith('/')?base:base+'/')+'index.htm' ];
    for (const p of v) {
      try { const r = await fetch(new URL(p, location.origin), { credentials:'same-origin' });
        if (r.ok) return { ok:true, url:String(new URL(p, location.origin)), html:await r.text() }; } catch {}
    }
    return { ok:false, url, html:'' };
  };
  const firstTeaser = (doc) => {
    const pick = s => { const ps = doc.querySelectorAll(s); for (const p of ps){ const t=(p.textContent||'').replace(/\s+/g,' ').trim(); if (t.length>10) return t; } };
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
    const sel = s => { const img = doc.querySelector(s); if (!img) return ''; const ss=img.getAttribute('srcset'); if (ss) return new URL(ss.split(',')[0].trim().split(/\s+/)[0], pageUrl).href;
                       const lazy = img.getAttribute('data-src')||img.getAttribute('data-lazy-src')||img.getAttribute('data-original'); if (lazy) return new URL(lazy, pageUrl).href;
                       const src = img.getAttribute('src'); return src? new URL(src, pageUrl).href : ''; };
    return sel('main img') || sel('article img') || sel('.content img') || sel('.prose img') ||
           sel('.markdown-rendered img') || sel('.markdown-body img') || sel('.post img') ||
           sel('#content img') || sel('.page img') || sel('.entry-content img') || sel('figure img') || sel('img') || '';
  };
  const pageCache = new Map();
  const fetchPageInfo = async (url) => {
    if (pageCache.has(url)) return pageCache.get(url);
    const p = (async ()=>{ const t = await tryFetch(url); if(!t.ok) throw new Error('ENR404 '+url);
      const doc = new DOMParser().parseFromString(t.html,'text/html');
      return { finalUrl:t.url, image:firstImage(doc,t.url), teaser:firstTeaser(doc) }; })();
    pageCache.set(url,p); return p;
  };

  // ---------- adapt Obsidian JSON → viewer data ----------
  function adaptCanvas(json) {
    const items = []; const edges = [];
    for (const n of json.nodes||[]) {
      const common = { id:n.id, x: Number.isFinite(n.x)?n.x:0, y:Number.isFinite(n.y)?n.y:0 };
      if (n.type==='text') {
        const embeds = extractEmbeds(n.text);
        const td = titleDesc(stripEmbeds(n.text));
        const it = { ...common, title: td.title, description: td.desc };
        if (embeds.length) it.imageCandidates = imageCandidatesFromVault(embeds[0]);
        items.push(it); continue;
      }
      if (n.type==='file') {
        const f = String(n.file||'');
        if (isImg(f)) {
          items.push({ ...common, title: f.split('/').pop().replace(/\.[^.]+$/,''), description:'', imageCandidates: imageCandidatesFromVault(f) });
        } else {
          const parts = f.replace(/\.md$/i,'').split('/'); const title = parts.pop(); const crumb = parts.length? parts.join(' › ') : '';
          items.push({ ...common, title, description: crumb, _canvasPath:f, _needsManifestResolve:true, _needsEnrich:true, _nameGuesses:nameImageGuesses(title) });
        }
        continue;
      }
      items.push({ ...common, title: n.type||'node', description: n.file||n.text||'' });
    }
    for (const e of (json.edges||[])) edges.push({ from:e.fromNode, to:e.toNode, label:e.label||'' });
    return { items, edges };
  }

  // ---------- diagnostics (hidden unless debug) ----------
  function markUnresolved(app) {
    if (!dbg.get()) return;
    for (const it of (app.data.items||[])) {
      if (it._canvasPath && !it._needsManifestResolve && !it.link) {
        const el = [...document.querySelectorAll('.card')].find(n=>n._itemId===it.id);
        if (!el) continue;
        const b=document.createElement('div'); b.textContent='URL ?';
        b.style.cssText='position:absolute;top:8px;left:8px;background:#8e44ad;color:#fff;font:bold 11px/1.6 monospace;padding:2px 6px;border-radius:6px;';
        el.appendChild(b);
        dbg.warn('[Canvas] No URL from manifest for:', it.title, 'path=', it._canvasPath);
      }
    }
  }

  function resolveLinks(app) {
    for (const it of (app.data.items||[])) {
      if (!it._needsManifestResolve) continue;
      it.link = resolveFromManifest(it._canvasPath) || noteUrlFromVault(it._canvasPath);
      delete it._needsManifestResolve;
    }
    app.render(); markUnresolved(app);
  }

  async function enrich(app) {
    const list = (app.data.items||[]).filter(it=>it._needsEnrich && it.link);
    const MAX = 4; let i=0;
    async function runOne(it){
      try {
        const info = await fetchPageInfo(it.link);
        const cands = [];
        if (info.image) cands.push(info.image);
        if (it._nameGuesses) cands.push(...it._nameGuesses);
        if (it.imageCandidates) cands.push(...it.imageCandidates);
        it.imageCandidates = Array.from(new Set(cands));
        if (info.teaser) it.description = it.description ? `${it.description}\n${info.teaser}` : info.teaser;
        if ((!info.teaser?.trim()) && (!it.imageCandidates?.length) && dbg.get()) _badge(it.id,'NO CONTENT','#7f8c8d');
        app.render();
      } catch (e) {
        if (dbg.get()) _badge(it.id,'ENR 404','#555');
        dbg.warn('Enrich failed for', it.link, e);
      } finally { delete it._needsEnrich; delete it._nameGuesses; }
    }
    function _badge(id, text, bg) {
      const el = [...document.querySelectorAll('.card')].find(n=>n._itemId===id);
      if (!el) return; const b=document.createElement('div'); b.textContent=text;
      b.style.cssText=`position:absolute;top:8px;left:8px;background:${bg};color:#fff;font:bold 11px/1.6 monospace;padding:2px 6px;border-radius:6px;`; el.appendChild(b);
    }
    await new Promise(res=>{
      const q=list.slice(); const pump=()=>{ while(i<MAX && q.length){ i++; runOne(q.shift()).finally(()=>{ i--; q.length?pump():i||res(); }); } };
      q.length?pump():res();
    });
  }

  // ---------- persistence: positions only ----------
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
      const data = app.getData(); const positions = {};
      for (const it of (data.items||[])) if (it.id) positions[it.id] = { x:it.x, y:it.y };
      const payload = { path:'src/site/canvas/tir.positions.json', data:{ positions, updatedAt:new Date().toISOString(), version:1 }, message:'chore(canvas): update node positions' };
      const r = await fetch('/api/save-canvas',{ method:'POST', headers:{'content-type':'application/json'}, credentials:'same-origin', body:JSON.stringify(payload) });
      if (!r.ok) throw new Error('Save failed '+r.status);
      btn && (btn.textContent='Saved ✓', setTimeout(()=>{ btn.textContent='Save to Repo'; btn.classList.remove('saving'); btn.disabled=false; }, 1200));
    }catch(e){
      alert('Save failed. See console.'); console.error(e);
      btn && (btn.textContent='Save to Repo', btn.classList.remove('saving'), btn.disabled=false);
    }
  }

  // ---------- toolbar ----------
  function ensureToolbar(){ let tb=$('.toolbar'); if(!tb){ tb=document.createElement('div'); tb.className='toolbar'; document.body.appendChild(tb); } return tb; }
  function ensureBtn(tb,id,label,title){ let b=$('#'+id); if(!b){ b=document.createElement('button'); b.id=id; b.type='button'; b.textContent=label; if(title) b.title=title; tb.appendChild(b); } return b; }
  function wireToolbar(){
    const tb = ensureToolbar();
    ensureBtn(tb,'btn-reset','Reset View').onclick = ()=>app.resetView();
    ensureBtn(tb,'btn-save','Download JSON').onclick = ()=>{
      const blob = new Blob([JSON.stringify(app.getData(),null,2)],{type:'application/json'});
      const url = URL.createObjectURL(blob); const a=Object.assign(document.createElement('a'),{href:url,download:'data.json'}); document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    };
    ensureBtn(tb,'btn-save-repo','Save to Repo','Commit canvas positions to repository').onclick = savePositionsToRepo;
    if (!$('#zoom-level')) { const span=document.createElement('span'); span.id='zoom-level'; span.textContent='100%'; span.style.marginLeft='8px'; tb.appendChild(span); }
    dbg.init();
  }

  // ---------- boot pipeline ----------
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
    } catch (e) {
      dbg.error('Failed to load/enrich canvas:', e);
      app.setData({ items:[], edges:[] });
    }
    wireToolbar();
  })();
})();
