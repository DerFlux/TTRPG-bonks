/* main.js — compact canvas controller
 *  - Password-gated Debug + Link Inspector (live Apply + alias save)
 *  - Manifest-based link resolving (+ aliases)
 *  - Obsidian-style markdown render, snippet enrichment (no duplicate <img>)
 *  - Upload/commit .canvas, save positions, DnD upload
 *  - Left-biased initial view, 100% is slightly zoomed out
 */

(() => {
  /* ------------------------------- small helpers ------------------------------- */
  const $ = (q, r = document) => r.querySelector(q);
  const $$ = (q, r = document) => Array.from(r.querySelectorAll(q));
  const on = (el, t, fn, o) => el.addEventListener(t, fn, o);
  const once = (el, t) => new Promise(res => on(el, t, res, { once: true }));

  const isImg = p => /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(p || "");
  const stripExt = p => String(p || "").replace(/\.[a-z0-9]+$/i, "");
  const slug = s => String(s || "")
    .replace(/&/g, " and ").trim().replace(/\./g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/-+/g, "-")
    .replace(/^-|-$/g, "").toLowerCase();

  const sanitPath = p => {
    let s = String(p || "").replace(/[|]+$/g, "").replace(/\/{2,}/g, "/");
    if (!s.startsWith("/")) s = "/" + s;
    return s;
  };
  const encSegs = p => p.split("/").map(encodeURIComponent).join("/");

  const html = s => String(s || "").replace(/[&<>"']/g, m => ({
    "&": "&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
  }[m]));

  /* ------------------------------- app & debug ------------------------------- */
  const app = new CanvasApp($("#canvas-container"), $("#world"));
  window.CanvasAppInstance = app;

  const Debug = (() => {
    let on = !!(+localStorage.getItem("canvasDebug") || (new URLSearchParams(location.search)).get("debug"));
    const set = v => {
      on = !!v; localStorage.setItem("canvasDebug", on ? "1" : "0");
      document.documentElement.classList.toggle("canvas-debug", on);
      $$(".card ._dbg").forEach(b => b.style.display = on ? "" : "none");
      document.dispatchEvent(new CustomEvent("canvas-debug", { detail: { on } }));
      const cb = $("#debug-toggle"); if (cb) cb.checked = on;
    };
    const gate = () => {
      if (!on) return;
      let pass = localStorage.getItem("canvasSaveAuth");
      if (!pass) {
        pass = prompt("Enter canvas password:") || "";
        if (!pass) { set(false); return; }
        localStorage.setItem("canvasSaveAuth", pass);
      }
    };
    const initToggle = () => {
      if ($("#debug-toggle")) return;
      const tb = $(".toolbar"); if (!tb) return;
      const lab = document.createElement("label");
      lab.innerHTML = `<input id="debug-toggle" type="checkbox"><span>Debugging</span>`;
      lab.className = "debug-wrap"; tb.appendChild(lab);
      const cb = $("#debug-toggle"); cb.checked = on;
      on && document.documentElement.classList.add("canvas-debug");
      on && document.dispatchEvent(new CustomEvent("canvas-debug", { detail: { on } }));
      cb.addEventListener("change", () => { if (cb.checked) { set(true); gate(); } else set(false); });
    };
    on && document.documentElement.classList.add("canvas-debug");
    return { is: () => on, set, gate, initToggle };
  })();

  /* ----------------------------- alias persistence ---------------------------- */
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
      "The Coastal Coalition": "The Coastal Coalition",
    }
  };
  async function loadAliases() {
    try { const r = await fetch("/canvas/link-aliases.json"); if (r.ok) LinkAliases = await r.json(); } catch {}
    LinkAliases.byText = { ...DEFAULT_ALIASES.byText, ...(LinkAliases.byText || {}) };
  }
  async function saveAliasesToRepo() {
    let auth = localStorage.getItem("canvasSaveAuth");
    if (!auth) { auth = prompt("Enter canvas password:") || ""; if (!auth) throw new Error("No password"); localStorage.setItem("canvasSaveAuth", auth); }
    const payload = {
      path: "src/site/canvas/link-aliases.json",
      data: { ...LinkAliases, updatedAt: new Date().toISOString() },
      message: "chore(canvas): update link aliases",
      auth
    };
    const r = await fetch("/api/save-canvas", {
      method: "POST", headers: { "content-type": "application/json" },
      credentials: "same-origin", body: JSON.stringify(payload)
    });
    if (r.status === 401) { localStorage.removeItem("canvasSaveAuth"); throw new Error("Unauthorized"); }
    if (!r.ok) throw new Error("Save failed " + r.status);
  }

  /* -------------------------------- manifest --------------------------------- */
  let M = null;
  const normCanvas = p => String(p || "").replace(/\\/g, "/").replace(/^\.?\/*/, "").replace(/\.md$/i, "").trim();

  function indexManifest(man) {
    const items = Array.isArray(man) ? man : Object.values(man || {});
    const entries = items.map(o => ({
      url: o.url || o.href || o.permalink || null,
      filePathStem: o.filePathStem || o.stem || null,
      inputPath: o.inputPath || o.input || null,
      source: o.sourcePath || o.page?.inputPath || o.data?.page?.inputPath || null,
      title: o.title || o.data?.title || null,
      raw: o
    })).filter(e => e.url || e.filePathStem || e.inputPath || e.source);

    const byKey = new Map(), byTitle = new Map();
    const addKey = (k, e) => { if (!k) return; const s = String(k).trim(); if (!s) return; (byKey.get(s) || byKey.set(s, []).get(s)).push(e); };
    const nk = s => String(s || "").replace(/^\.?\/*/, "").toLowerCase();

    for (const e of entries) {
      const stem = e.filePathStem ? e.filePathStem.replace(/^\/*/, "") : "";
      [e.url, e.filePathStem, e.inputPath, e.source, nk(stem), "/"+nk(stem), nk(e.inputPath), nk(e.source)]
        .forEach(k => addKey(k, e));
      if (e.title) {
        const t = slug(e.title);
        if (t) (byTitle.get(t) || byTitle.set(t, []).get(t)).push(e);
      }
      const segs = (stem || "").split("/").filter(Boolean);
      const last2 = segs.slice(-2).join("/"), last3 = segs.slice(-3).join("/");
      [last2, last3, slug(last2), slug(last3)].forEach(k => addKey(k, e));
    }
    return { entries, byKey, byTitle };
  }
  async function loadManifest() {
    try { const r = await fetch("/page-manifest.json"); if (!r.ok) throw 0; M = indexManifest(await r.json()); }
    catch { M = { entries: [], byKey: new Map(), byTitle: new Map() }; }
    Debug.is() && (window.__PageManifestIndex = M);
  }
  function manifestKeys(canvasPath) {
    const base = normCanvas(canvasPath), lc = base.toLowerCase();
    const raw = lc.split("/").filter(Boolean);
    const sParts = raw.map(slug); if (sParts[0] === "3-npcs" || sParts[0] === "3--npcs") sParts[0] = "3-np-cs";
    const lastAlt = slug((raw.at(-1) || "").replace(/[(),]/g, "").replace(/\s+/g, " ").trim());
    return Array.from(new Set([
      base, lc, "/"+sParts.join("/"), sParts.join("/"),
      "/"+sParts.slice(0,-1).concat([lastAlt]).join("/"),
      sParts.slice(0,-1).concat([lastAlt]).join("/"),
      noteUrlFromVault(canvasPath) || "",
      raw.slice(-2).join("/"), raw.slice(-3).join("/"),
      slug(raw.slice(-2).join("/")), slug(raw.slice(-3).join("/")),
      lc.replace(/[(),]/g, "").replace(/&/g,"and").replace(/\s+/g,"-")
    ])).filter(Boolean);
  }
  const pickBest = arr => arr?.length ? (arr.find(e => e.url) || arr[0]) : null;

  function resolveFromManifest(canvasPath) {
    for (const key of manifestKeys(canvasPath)) {
      const hit = M.byKey.get(String(key).trim());
      if (hit?.length) return (hit.find(e => !!e.url) || hit[0]).url || null;
    }
    const last = slug(normCanvas(canvasPath).split("/").pop());
    const tHit = last && M.byTitle.get(last);
    if (tHit?.length) return (tHit.find(e => !!e.url) || tHit[0]).url || null;

    const lc = normCanvas(canvasPath).toLowerCase();
    for (const e of M.entries) {
      if ((e.filePathStem && lc.endsWith(String(e.filePathStem).toLowerCase())) ||
          (e.inputPath   && lc.endsWith(String(e.inputPath).toLowerCase())) ||
          (e.source      && lc.endsWith(String(e.source).toLowerCase()))) return e.url || null;
    }
    return null;
  }

  /* ---------------------- vault path → site URL / image paths ---------------------- */
  function noteUrlFromVault(vp) {
    if (!vp || isImg(vp)) return null;
    const parts = vp.replace(/\.md$/i, "").split("/").map((seg, i) => {
      const sl = slug(seg); return (i === 0 && /^3-?npcs$/.test(sl)) ? "3-np-cs" : sl;
    }).filter(Boolean);
    return sanitPath(parts.join("/") + "/");
  }
  const imageCandidatesFromVault = (vp) => {
    if (!vp) return [];
    const stripped = vp.replace(/^Images\//i, "");
    const m = /^(.*?)(\.[^.]+)?$/.exec(stripped);
    const base = m[1] || stripped, ext = (m[2] || "").toLowerCase();
    const exts = ext ? Array.from(new Set([ext, ext.toUpperCase()])) : [".png",".PNG",".jpg",".JPG",".jpeg",".JPEG"];
    const prefixes = ["/img/user/Images/","/img/user/images/","/img/Images/","/img/"];
    const bases = Array.from(new Set([base, base.toLowerCase()]));
    const out = [];
    for (const p of prefixes) for (const b of bases) for (const e of exts) out.push(p + encSegs(b) + e);
    out.push("/img/user/Images/" + encSegs(stripped));
    return Array.from(new Set(out));
  };
  const guessesFromTitle = t => {
    if (!t) return [];
    const base = t.replace(/\.[^.]+$/, "");
    const variants = Array.from(new Set([base, base.replace(/[,()]/g,"").replace(/\s+/g," ").trim(), base.replace(/\s+/g," ")]));
    const exts = [".png",".jpg",".jpeg",".PNG",".JPG",".JPEG"];
    const out = []; for (const v of variants) for (const e of exts) out.push("/img/user/Images/" + encSegs(v) + e);
    return out;
  };

  /* --------------------------------- link rewrite --------------------------------- */
  const needManifest = () => M ? Promise.resolve(M) : loadManifest().then(()=>M);
  const toAbs = u => /^https?:\/\//i.test(u) ? u : new URL(u, location.origin).href;

  async function resolveUrlFromHrefOrText(href, text) {
    await needManifest();
    const alias = text && LinkAliases.byText?.[text];
    if (alias) return alias.startsWith("/") || /^(https?:)?\/\//i.test(alias) ? toAbs(alias) : (pickBest(M.byTitle.get(slug(alias)))?.url || href);
    if (/^https?:\/\//i.test(href)) return href;

    const clean = decodeURIComponent(href || "").replace(/^\/+/, "").replace(/&amp;/gi, "and");
    const k1 = slug(stripExt(clean)), k2 = slug(clean.split("/").pop() || ""), k3 = slug(clean.split("/").slice(-2).join("/") || "");
    let hit = pickBest(M.byKey.get(k1)) || pickBest(M.byKey.get("/"+k1)) || pickBest(M.byKey.get(k2)) || pickBest(M.byKey.get(k3));
    if (hit?.url) return hit.url;
    if (text) { hit = pickBest(M.byTitle.get(slug(text))); if (hit?.url) return hit.url; }
    return href;
  }

  async function rewriteLinksInDOM(root = document) {
    const as = root.querySelectorAll(".card .md-body a[href]");
    await Promise.all(Array.from(as).map(async a => {
      const h = a.getAttribute("href") || "", t = a.textContent.trim();
      a.setAttribute("href", await resolveUrlFromHrefOrText(h, t));
    }));
  }

  /* ------------------------------- enrichment fetch ------------------------------- */
  const cache = new Map();
  const tryFetch = async (url) => {
    const u = new URL(url, location.origin);
    const base = sanitPath(u.pathname);
    const variants = [base.endsWith("/")?base:base+"/", base.endsWith("/")?base.slice(0,-1):base, (base.endsWith("/")?base:base+"/")+"index.html"];
    for (const p of variants) {
      try { const r = await fetch(new URL(p, location.origin)); if (r.ok) return { ok: true, url: String(new URL(p, location.origin)), html: await r.text() }; }
      catch {}
    }
    return { ok: false, url, html: "" };
  };
  const firstHTML = (doc) => {
    const picks = ["main .markdown-rendered","article .markdown-rendered","main .content","article .content",".markdown-body",".prose","main","article"];
    for (const sel of picks) {
      const el = doc.querySelector(sel); if (!el) continue;
      const cands = el.querySelectorAll("p, .callout, blockquote, ul, ol");
      for (const c of cands) { const txt = (c.textContent||"").replace(/\s+/g," ").trim(); if (txt.length > 10) return c.outerHTML; }
    }
    return "";
  };
  const stripImgs = (htmlStr) => { const d = document.implementation.createHTMLDocument(""); d.body.innerHTML = htmlStr||""; d.body.querySelectorAll("img,picture,figure").forEach(n=>n.remove()); return d.body.innerHTML; };
  const firstImg = (doc, base) => {
    const abs = v => v ? new URL(v, base).href : "";
    const og = doc.querySelector('meta[property="og:image"],meta[name="og:image"]'); if (og?.content) return abs(og.content);
    const pre = doc.querySelector('link[rel="preload"][as="image"][href]'); if (pre) return abs(pre.getAttribute("href"));
    const pick = sel => { const im = doc.querySelector(sel); if (!im) return ""; const ss = im.getAttribute("srcset"); if (ss) return abs(ss.split(",")[0].trim().split(/\s+/)[0]); const lazy = im.getAttribute("data-src")||im.getAttribute("data-lazy-src")||im.getAttribute("data-original"); return abs(lazy || im.getAttribute("src")); };
    return pick("main img,article img,.content img,.prose img,.markdown-rendered img,.markdown-body img,img");
  };
  async function fetchPageInfo(url) {
    if (cache.has(url)) return cache.get(url);
    const p = (async () => {
      const t = await tryFetch(url); if (!t.ok) throw new Error("ENR404 "+url);
      const doc = new DOMParser().parseFromString(t.html, "text/html");
      return { finalUrl: t.url, image: firstImg(doc, t.url), htmlSnippet: stripImgs(firstHTML(doc)) };
    })();
    cache.set(url, p); return p;
  }

  const addBadge = (id, s, bg="#555") => {
    if (!Debug.is()) return;
    const el = $$(".card").find(n => n._itemId === id); if (!el) return;
    const b = Object.assign(document.createElement("div"), { className: "_dbg", textContent: s });
    b.style.cssText = `position:absolute;top:8px;left:8px;background:${bg};color:#fff;font:700 11px/1.6 ui-monospace,monospace;padding:2px 6px;border-radius:6px`;
    el.appendChild(b);
  };

  /* ----------------------------- adapt .canvas → data ----------------------------- */
  const extractEmbeds = txt => { const out=[],re=/!\[\[([^|\]]+)(?:\|[^]]*)?\]\]/g; let m; const s=String(txt||""); while((m=re.exec(s))!==null){ let f=m[1].trim(); if(!/[\/\\]/.test(f)) f="Images/"+f; out.push(f);} return out; };
  const stripEmbeds = s => String(s||"").replace(/!\[\[[^\]]+\]\]/g,"").trim();
  const firstLine = txt => { const L=String(txt||"").split(/\r?\n/); return { title:(L[0]||"").replace(/^#+\s*/,"").trim()||"Text", desc:L.slice(1).join("\n").trim() }; };

  function adaptCanvas(json) {
    const items=[], edges=[];
    for (const n of (json.nodes||[])) {
      const base = { id:n.id, x:+n.x||0, y:+n.y||0 };
      if (n.type === "text") {
        const eb = extractEmbeds(n.text), fr = firstLine(stripEmbeds(n.text));
        items.push({ ...base, title:fr.title, description:fr.desc, ...(eb.length?{ imageCandidates:imageCandidatesFromVault(eb[0]) }:{}) });
        continue;
      }
      if (n.type === "file") {
        const f = String(n.file||"");
        if (isImg(f)) items.push({ ...base, title: f.split("/").pop().replace(/\.[^.]+$/,""), description:"", imageCandidates: imageCandidatesFromVault(f) });
        else {
          const parts=f.replace(/\.md$/i,"").split("/"); const title=parts.pop(); const crumb=parts.length?parts.join(" › "):"";
          items.push({ ...base, title, description: crumb, _canvasPath:f, _needsManifestResolve:true, _needsEnrich:true, _nameGuesses: guessesFromTitle(title) });
        }
        continue;
      }
      items.push({ ...base, title:n.type||"node", description: n.file||n.text||"" });
    }
    for (const e of (json.edges||[])) edges.push({ from:e.fromNode, to:e.toNode, label:e.label||"" });
    return { items, edges };
  }

  /* ------------------------------ resolve & enrich ------------------------------ */
  function resolveLinksNow() {
    for (const it of (app.data.items||[])) {
      if (!it._needsManifestResolve) continue;
      it.link = resolveFromManifest(it._canvasPath) || noteUrlFromVault(it._canvasPath);
      delete it._needsManifestResolve;
    }
    app.render();
    injectAllHTML(); rewriteLinksInDOM().catch(()=>{});
  }
  function injectHTMLForItem(it) {
    if (!it?.id || !it.descriptionHtml) return;
    const card = $$(".card").find(n => n._itemId === it.id); if (!card) return;
    const body = card.querySelector(".md-body") || card.querySelector(".card-body") || card;
    body.innerHTML = it.descriptionHtml;
  }
  function injectAllHTML(items){ (items||app.data.items||[]).forEach(injectHTMLForItem); }

  async function enrichAll() {
    const list = (app.data.items||[]).filter(it => it._needsEnrich && it.link);
    const MAX = 4; let active = 0;
    await new Promise(done => {
      const q = list.slice();
      const pump = () => {
        while (active < MAX && q.length) {
          const it = q.shift(); active++;
          (async () => {
            try {
              const info = await fetchPageInfo(it.link);
              const cands = []; info.image && cands.push(info.image);
              it._nameGuesses && cands.push(...it._nameGuesses);
              it.imageCandidates && cands.push(...it.imageCandidates);
              it.imageCandidates = Array.from(new Set(cands));
              if (info.htmlSnippet) it.descriptionHtml = info.htmlSnippet;
              app.render(); injectHTMLForItem(it); await rewriteLinksInDOM();
              if ((!info.htmlSnippet?.trim()) && (!it.imageCandidates?.length)) addBadge(it.id, "NO CONTENT", "#7f8c8d");
            } catch (e) { addBadge(it.id, "ENR 404", "#555"); Debug.is() && console.warn("Enrich fail", it.link, e); }
            finally {
              delete it._needsEnrich; delete it._nameGuesses; active--; q.length ? pump() : !active && done();
            }
          })();
        }
      };
      q.length ? pump() : done();
    });
  }

  /* -------------------------------- save positions -------------------------------- */
  async function loadPositions(url="/canvas/tir.positions.json"){ try{ const r=await fetch(url); if(!r.ok) return null; const j=await r.json(); return j?.positions||null;}catch{return null;} }
  function applyPositions(obs, pos){ if(!obs?.nodes||!pos) return obs; for(const n of obs.nodes){ const p=pos[n.id]; if(p){ Number.isFinite(p.x)&&(n.x=p.x); Number.isFinite(p.y)&&(n.y=p.y);} } return obs; }
  async function savePositionsToRepo() {
    const btn = $("#btn-save-repo");
    try{
      btn&&(btn.disabled=true,btn.classList.add("saving"),btn.textContent="Saving…");
      let auth = localStorage.getItem("canvasSaveAuth");
      if(!auth){ auth=prompt("Enter canvas save password:")||""; if(!auth) throw new Error("No password"); localStorage.setItem("canvasSaveAuth",auth); }
      const positions={}; for(const it of (app.getData().items||[])) positions[it.id]={x:it.x,y:it.y};
      const payload={ path:"src/site/canvas/tir.positions.json", data:{positions,updatedAt:new Date().toISOString(),version:1}, message:"chore(canvas): update node positions", auth };
      const r=await fetch("/api/save-canvas",{method:"POST",headers:{"content-type":"application/json"},credentials:"same-origin",body:JSON.stringify(payload)});
      if(r.status===401){ localStorage.removeItem("canvasSaveAuth"); throw new Error("Unauthorized"); }
      if(!r.ok) throw new Error("Save failed "+r.status);
      btn&&(btn.textContent="Saved ✓", setTimeout(()=>{btn.textContent="Save to Repo";btn.classList.remove("saving");btn.disabled=false;},900));
    }catch(e){ console.error(e); alert("Save failed. See console."); btn&&(btn.textContent="Save to Repo",btn.classList.remove("saving"),btn.disabled=false); }
  }

  /* ---------------------------- commit .canvas to repo ---------------------------- */
  async function commitFile(path, dataObj, message) {
    let auth = localStorage.getItem("canvasSaveAuth");
    if(!auth){ auth=prompt("Enter canvas password:")||""; if(!auth) throw new Error("No password"); localStorage.setItem("canvasSaveAuth",auth); }
    const r=await fetch("/api/save-canvas",{method:"POST",headers:{"content-type":"application/json"},credentials:"same-origin",body:JSON.stringify({path,data:dataObj,message,auth})});
    if(r.status===401){ localStorage.removeItem("canvasSaveAuth"); throw new Error("Unauthorized"); }
    if(!r.ok) throw new Error("Commit failed "+r.status);
    return r.json().catch(()=>({}));
  }
  async function loadCanvasObject(obsidian) {
    const pos = await loadPositions(); if (pos) obsidian = applyPositions(obsidian, pos);
    app.setData(adaptCanvas(obsidian));
    resolveLinksNow(); await enrichAll();
    app.fitToView({ margin:160, bias:"left", zoomOut:1.25, extraShiftX:0 });
    injectAllHTML(); await rewriteLinksInDOM();
  }

  /* ---------------------------------- toolbar ---------------------------------- */
  function ensureToolbar(){ let tb=$(".toolbar"); if(!tb){ tb=document.createElement("div"); tb.className="toolbar"; document.body.appendChild(tb);} return tb; }
  const btn = (tb,id,label,title) => { let b=$("#"+id); if(!b){ b=document.createElement("button"); b.id=id; b.type="button"; b.textContent=label; title&&(b.title=title); tb.appendChild(b); } return b; };
  function wireUpload(tb){
    let fi=$("#canvas-file-input"); if(!fi){ fi=document.createElement("input"); fi.type="file"; fi.accept=".canvas,application/json"; fi.id="canvas-file-input"; fi.style.display="none"; document.body.appendChild(fi); }
    btn(tb,"btn-upload-canvas","Upload .canvas","Replace tir.canvas.json").onclick=async()=>{
      fi.value=""; fi.onchange=async()=>{
        const f=fi.files?.[0]; if(!f) return;
        try{ const txt=await f.text(), json=JSON.parse(txt); if(!json?.nodes||!json?.edges) throw 0;
          await commitFile("src/site/canvas/tir.canvas.json", json, `chore(canvas): replace tir.canvas.json (${f.name})`);
          await loadCanvasObject(json);
        }catch{ alert("Upload failed."); }
      };
      fi.click();
    };
    on(window,"dragover",e=>e.preventDefault());
    on(window,"drop",async e=>{
      const f=[...e.dataTransfer?.files||[]].find(x=>/\.canvas$|\.json$/i.test(x.name)); if(!f) return; e.preventDefault();
      try{ const json=JSON.parse(await f.text()); await commitFile("src/site/canvas/tir.canvas.json", json, `chore(canvas): replace tir.canvas.json (DnD ${f.name})`); await loadCanvasObject(json); }
      catch{ alert("Drag&drop upload failed."); }
    });
  }
  function toolbar(){
    const tb=ensureToolbar();
    btn(tb,"btn-reset","Reset View").onclick=()=>app.resetView();
    btn(tb,"btn-save","Download JSON").onclick=()=>{
      const blob=new Blob([JSON.stringify(app.getData(),null,2)],{type:"application/json"});
      const url=URL.createObjectURL(blob); const a=Object.assign(document.createElement("a"),{href:url,download:"data.json"}); document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    };
    btn(tb,"btn-save-repo","Save to Repo","Commit positions").onclick=savePositionsToRepo;
    wireUpload(tb);
    if(!$("#zoom-level")) tb.appendChild(Object.assign(document.createElement("span"),{id:"zoom-level",textContent:""}));
    Debug.initToggle();
    Debug.is() && LinkInspector.ensureButton();
  }

  /* ------------------------------ Link Inspector UI ------------------------------ */
  const LinkInspector = (() => {
    let panel=null, trig=null;
    const css = `
      .li-panel{position:fixed;top:64px;right:24px;width:560px;max-height:75vh;background:#fff;border:1px solid #e6dfd6;box-shadow:0 10px 30px rgba(0,0,0,.18);border-radius:12px;display:flex;flex-direction:column;z-index:9999}
      .li-head{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:#faf8f4;border-bottom:1px solid #eee;border-top-left-radius:12px;border-top-right-radius:12px}
      .li-body{overflow:auto;padding:8px}
      .li-row{display:grid;grid-template-columns:1.2fr 1.2fr auto 1.4fr;gap:8px;align-items:center;padding:6px 4px;border-bottom:1px dashed #eee}
      .li-badge{display:inline-block;font:600 12px/1.5 ui-monospace,monospace;padding:1px 6px;border-radius:999px;border:1px solid #ddd}
      .li-badge.ok{background:#eafbea;color:#0a7a2a;border-color:#cfe9cf}
      .li-badge.bad{background:#fff0f0;color:#a00;border-color:#f0caca}
      .li-input{width:100%;padding:6px 8px;border:1px solid #ddd;border-radius:8px}
      .li-search{margin:6px 8px 0}
      .li-search input{width:100%;padding:6px 10px;border:1px solid #ddd;border-radius:8px}
      .li-foot{padding:8px;border-top:1px solid #eee}
      .li-pill{background:#f3eee8;border:1px solid #e7dfd6;border-radius:999px;padding:2px 8px;font-size:12px;margin-right:6px}
      .li-hl .md-body a.li-mark{outline:2px solid #f39;outline-offset:2px;border-radius:3px}
    `;
    const style = () => { if ($("#li-style")) return; const s=document.createElement("style"); s.id="li-style"; s.textContent=css; document.head.appendChild(s); };
    const check = async u => { try{ const r=await fetch(u,{credentials:"same-origin"}); return {ok:r.ok}; }catch{ return {ok:false}; } };

    function ensureButton(){
      if (!Debug.is() || trig) return;
      const tb=$(".toolbar"); if(!tb) return;
      trig=document.createElement("button"); trig.id="btn-link-inspector"; trig.textContent="Link Inspector";
      on(trig,"click",()=> panel? close(): open());
      tb.appendChild(trig);
    }
    function close(){ panel?.remove(); panel=null; document.documentElement.classList.remove("li-hl"); }
    const setHL = v => document.documentElement.classList.toggle("li-hl", !!v);

    const group = () => {
      const m=new Map();
      for (const a of document.querySelectorAll(".card .md-body a[href]")) {
        const t=(a.textContent||"").trim(); if(!t) continue;
        (m.get(t)||m.set(t,[]).get(t)).push(a);
      }
      return [...m.entries()].sort((a,b)=>a[0].localeCompare(b[0]));
    };

    function row(text, anchors){
      const h0 = anchors[0].getAttribute("href") || "";
      const wrap = document.createElement("div"); wrap.className="li-row"; wrap.dataset.text=text;
      const title = document.createElement("div"); title.innerHTML = `<strong>${html(text)}</strong> <small>(${anchors.length})</small>`;
      const curr  = document.createElement("div"); const a = Object.assign(document.createElement("a"),{target:"_blank",rel:"noopener",href:h0,textContent:"(resolving…)"});
      curr.appendChild(a);
      const stat  = document.createElement("div"); const badge=Object.assign(document.createElement("span"),{className:"li-badge",textContent:"…"}); stat.appendChild(badge);
      const edit  = document.createElement("div"); const input=Object.assign(document.createElement("input"),{className:"li-input",placeholder:"Target title or /relative/or/full URL",value:LinkAliases.byText[text]||""});
      const btn   = Object.assign(document.createElement("button"),{textContent:"Apply"}); edit.append(input,btn);
      wrap.append(title,curr,stat,edit);

      (async () => { const resolved=await resolveUrlFromHrefOrText(h0,text); a.href=a.textContent=resolved; const st=await check(resolved); badge.className="li-badge "+(st.ok?"ok":"bad"); badge.textContent=st.ok?"OK":"404"; })();

      on(btn,"click",async()=>{
        try{
          const v=input.value.trim(); v? LinkAliases.byText[text]=v : delete LinkAliases.byText[text];
          btn.disabled=true; btn.textContent="Saving…"; await saveAliasesToRepo();
          for(const x of anchors){ const r=await resolveUrlFromHrefOrText(x.getAttribute("href")||"",text); x.setAttribute("href",r); }
          const r=await resolveUrlFromHrefOrText(anchors[0].getAttribute("href")||"",text); a.href=a.textContent=r;
          const st=await check(r); badge.className="li-badge "+(st.ok?"ok":"bad"); badge.textContent=st.ok?"OK":"404";
          btn.textContent="Saved ✓"; setTimeout(()=>{btn.textContent="Apply"; btn.disabled=false;},700);
        }catch(e){ console.error(e); alert("Saving alias failed."); btn.textContent="Apply"; btn.disabled=false; }
      });
      return wrap;
    }

    async function open(){
      style(); if(panel) return;
      panel=document.createElement("aside"); panel.className="li-panel";
      panel.innerHTML = `
        <div class="li-head">
          <strong>Link Inspector</strong>
          <div><label><input id="li-hl" type="checkbox"> Highlight links</label>
          <button id="li-close">Close</button></div>
        </div>
        <div class="li-search"><input id="li-filter" type="text" placeholder="Filter by link text…"></div>
        <div class="li-body"><div class="li-list">Scanning…</div></div>
        <div class="li-foot"><span class="li-pill" id="li-count">0 items</span><span class="li-pill">Tip: enter page title or /path or full URL.</span></div>
      `;
      document.body.appendChild(panel);
      on($("#li-close",panel),"click",close);
      on($("#li-hl",panel),"change",e=>setHL(e.target.checked));

      const list=$(".li-list",panel), entries=group();
      list.innerHTML=""; entries.forEach(([t,as])=> list.appendChild(row(t,as)));
      $("#li-count",panel).textContent = `${entries.length} items`;
      on($("#li-filter",panel),"input",e=>{
        const q=e.target.value.toLowerCase();
        $$(".li-row",list).forEach(r => r.style.display = r.dataset.text.toLowerCase().includes(q) ? "" : "none");
      });
    }
    return { ensureButton };
  })();

  /* ----------------------------------- boot ----------------------------------- */
  (async () => {
    try {
      await loadAliases(); await loadManifest();
      let obs = await (await fetch("tir.canvas.json")).json();
      const pos = await loadPositions(); if (pos) obs = applyPositions(obs, pos);
      app.setData(adaptCanvas(obs));
      resolveLinksNow(); await enrichAll();
      app.fitToView({ margin:160, bias:"left", zoomOut:1.25, extraShiftX:0 });
      injectAllHTML(); await rewriteLinksInDOM();
    } catch (e) { Debug.is() && console.error("Canvas boot failed:", e); app.setData({ items:[], edges:[] }); }
    // UI
    toolbar();
    // Gate debug features on enable
    on(document,"canvas-debug", e => { if (e.detail?.on) { Debug.gate(); LinkInspector.ensureButton(); } });
  })();
})();
