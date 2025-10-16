// main.js
(function () {
  const container = document.getElementById('canvas-container');
  const world = document.getElementById('world');
  const app = new CanvasApp(container, world);
  window.CanvasAppInstance = app; // leave exposed for manual checks

  // ---------- Debug controller (default OFF) ----------
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
      const cb = document.getElementById('debug-toggle');
      if (cb) cb.checked = on;
    }
    function initToggle() {
      // attach a small toggle into the toolbar (if present)
      const tb = document.querySelector('.toolbar');
      if (!tb || document.getElementById('debug-toggle')) return;
      const wrap = document.createElement('label');
      wrap.style.cssText = 'display:flex;align-items:center;gap:6px;margin-left:6px;font:12px/1.2 monospace;opacity:.75;';
      wrap.title = 'Show canvas debugging badges and logs';
      wrap.innerHTML = `
        <input id="debug-toggle" type="checkbox" style="accent-color: currentColor;">
        <span>Debugging</span>
      `;
      tb.appendChild(wrap);
      const cb = wrap.querySelector('#debug-toggle');
      cb.checked = on;
      cb.addEventListener('change', () => set(cb.checked));
    }
    // initialize class and toggle state on load
    set(on);
    return { isOn: () => on, set, initToggle };
  })();

  // ---------- helpers ----------
  const isImagePath = (p) => /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(p || "");

  function slugifySegment(seg) {
    return String(seg || "")
      .replace(/&/g, " and ")
      .trim()
      .replace(/\./g, " ")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase();
  }

  const encodePath = (p) => p.split("/").map((seg) => encodeURIComponent(seg)).join("/");

  function sanitizePath(path) {
    let s = String(path || "").replace(/[|]+$/g, "");
    s = s.replace(/\/{2,}/g, "/");
    if (!s.startsWith("/")) s = "/" + s;
    return s;
  }

  // Fallback builder when manifest cannot resolve (handles "3. NPCs" → "3-np-cs")
  function noteUrlFromVaultPath(vaultPath) {
    if (!vaultPath || isImagePath(vaultPath)) return null;
    const withoutExt = vaultPath.replace(/\.md$/i, "");
    const raw = withoutExt.split("/");
    const parts = raw.map((seg, i) => {
      const sl = slugifySegment(seg);
      if (i === 0 && /^3-?npcs$/i.test(sl)) return "3-np-cs";
      return sl;
    }).filter(Boolean);
    return sanitizePath(parts.join("/") + "/");
  }

  // Preferred mapping: Obsidian “Images/…” → /img/user/Images/…
  function imageUrlFromVaultPath(vaultPath) {
    if (!vaultPath) return null;
    const stripped = vaultPath.replace(/^Images\//i, "");
    return "/img/user/Images/" + encodePath(stripped);
  }

  // Robust image candidates
  function imageCandidatesFromVaultPath(vaultPath) {
    if (!vaultPath) return [];
    const stripped = vaultPath.replace(/^Images\//i, "");
    const enc = encodePath(stripped);
    const lowerEnc = enc.toLowerCase();

    const m = /^(.*?)(\.[^.]+)?$/.exec(stripped);
    const base = m[1] || stripped;
    const ext = (m[2] || "").toLowerCase();
    const encodeBoth = (b, e) => encodePath(b) + e;

    const extVariants = ext
      ? Array.from(new Set([ext, ext.toUpperCase()]))
      : [".png", ".PNG", ".jpg", ".JPG", ".jpeg", ".JPEG"];

    const prefixes = ["/img/user/Images/", "/img/user/images/", "/img/"];
    const bases = Array.from(new Set([base, base.toLowerCase()]));
    const candidates = [];

    for (const prefix of prefixes) {
      for (const b of bases) {
        for (const e of extVariants) {
          candidates.push(prefix + encodeBoth(b, e));
        }
      }
    }

    candidates.push(
      "/img/user/Images/" + enc,
      "/img/user/images/" + enc,
      "/img/user/Images/" + lowerEnc,
      "/img/user/images/" + lowerEnc,
      "/img/" + enc,
      "/img/" + lowerEnc,
      "/img/Images/" + enc,
      "/canvas/Images/" + enc
    );

    return Array.from(new Set(candidates));
  }

  function extractEmbeddedImages(markdownishText) {
    const text = String(markdownishText || "");
    const regex = /!\[\[([^|\]]+)(?:\|[^]]*)?\]\]/g;
    const files = [];
    let m;
    while ((m = regex.exec(text)) !== null) {
      let f = m[1].trim();
      if (!/[\/\\]/.test(f)) f = "Images/" + f;
      files.push(f);
    }
    return files;
  }

  const stripEmbeddedImages = (s) => String(s || "").replace(/!\[\[[^\]]+\]\]/g, "").trim();

  function extractTitleAndDesc(markdownishText) {
    const text = String(markdownishText || "");
    const lines = text.split(/\r?\n/);
    const first = (lines[0] || "").replace(/^#+\s*/, "").trim();
    const rest = lines.slice(1).join("\n").trim();
    return { title: first || "Text", desc: rest };
  }

  function nameBasedImageCandidates(title) {
    if (!title) return [];
    const raw = title.replace(/\.[^.]+$/, "");
    const variants = Array.from(new Set([
      raw,
      raw.replace(/[,()]/g, "").replace(/\s+/g, " ").trim(),
      raw.replace(/\s+/g, " "),
    ]));
    const exts = [".png", ".jpg", ".jpeg", ".PNG", ".JPG", ".JPEG"];
    const cands = [];
    for (const v of variants) {
      const enc = encodePath(v);
      for (const e of exts) cands.push(`/img/user/Images/${enc}${e}`);
    }
    return cands;
  }

  // -------- Manifest loading & indexing --------
  let ManifestIndex = null;

  async function loadManifest() {
    try {
      const resp = await fetch("/page-manifest.json", { credentials: "same-origin" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const man = await resp.json();
      ManifestIndex = indexManifest(man);
      if (Debug.isOn()) window.__PageManifestIndex = ManifestIndex;
    } catch (e) {
      if (Debug.isOn()) console.warn("Could not load /page-manifest.json; using slug fallback.", e);
      ManifestIndex = { entries: [], byKey: new Map(), byTitleSlug: new Map() };
    }
  }

  function indexManifest(man) {
    const entries = [];
    const byKey = new Map();
    const byTitleSlug = new Map();

    const pushEntry = (obj) => {
      if (!obj) return;
      const url = obj.url || obj.href || obj.permalink || null;
      const filePathStem = obj.filePathStem || obj.filepathStem || obj.stem || null;
      const inputPath = obj.inputPath || obj.input || obj.pageInputPath || obj.source || null;
      const source = obj.sourcePath || obj.page?.inputPath || obj.data?.page?.inputPath || null;
      const title = obj.title || obj.data?.title || null;
      const entry = { url, filePathStem, inputPath, source, title, raw: obj };
      if (entry.url || entry.filePathStem || entry.inputPath || entry.source) entries.push(entry);
    };

    if (Array.isArray(man)) man.forEach(pushEntry);
    else if (man && typeof man === "object") Object.values(man).forEach(pushEntry);

    const addKey = (k, entry) => {
      if (!k) return;
      const key = String(k).trim();
      if (!key) return;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(entry);
    };

    const norm = (s) => String(s || "").replace(/^\.?\/*/, "").toLowerCase();

    for (const e of entries) {
      const stem = e.filePathStem ? e.filePathStem.replace(/^\/*/, "") : "";
      addKey(e.url, e);
      addKey(e.filePathStem, e);
      addKey(e.inputPath, e);
      addKey(e.source, e);
      addKey(norm(stem), e);
      addKey("/" + norm(stem), e);
      addKey(norm(e.inputPath), e);
      addKey(norm(e.source), e);

      if (e.title) {
        const tslug = slugifySegment(e.title);
        if (tslug) {
          if (!byTitleSlug.has(tslug)) byTitleSlug.set(tslug, []);
          byTitleSlug.get(tslug).push(e);
        }
      }

      const segs = (stem || "").split("/").filter(Boolean);
      const last2 = segs.slice(-2).join("/");
      const last3 = segs.slice(-3).join("/");
      addKey(norm(last2), e);
      addKey(norm(last3), e);
    }

    return { entries, byKey, byTitleSlug };
  }

  function normalizeCanvasPath(p) {
    return String(p || "")
      .replace(/\\/g, "/")
      .replace(/^\.?\/*/, "")
      .replace(/\.md$/i, "")
      .trim();
  }

  function manifestCandidatesFromCanvasPath(canvasPath) {
    const base = normalizeCanvasPath(canvasPath);
    const lc = base.toLowerCase();
    const rawParts = lc.split("/").filter(Boolean);
    const slugParts = rawParts.map(slugifySegment);
    if (slugParts[0] === "3-npcs" || slugParts[0] === "3--npcs") slugParts[0] = "3-np-cs";

    const stemCandidate = "/" + slugParts.join("/");
    const last = rawParts[rawParts.length - 1] || "";
    const lastNoPunct = last.replace(/[(),]/g, "").replace(/\s+/g, " ").trim();
    const altLast = slugifySegment(lastNoPunct);
    const altStemCandidate = "/" + slugParts.slice(0, -1).concat([altLast]).join("/");

    const cands = new Set([
      base, lc,
      stemCandidate, stemCandidate.slice(1),
      altStemCandidate, altStemCandidate.slice(1),
      sanitizePath(noteUrlFromVaultPath(canvasPath) || "")
    ]);

    const last2Raw = rawParts.slice(-2).join("/");
    const last3Raw = rawParts.slice(-3).join("/");
    if (last2Raw) {
      cands.add(last2Raw);
      cands.add(slugifySegment(rawParts[rawParts.length - 2]) + "/" + slugifySegment(rawParts[rawParts.length - 1]));
    }
    if (last3Raw) {
      cands.add(last3Raw);
      cands.add(
        slugifySegment(rawParts[rawParts.length - 3]) + "/" +
        slugifySegment(rawParts[rawParts.length - 2]) + "/" +
        slugifySegment(rawParts[rawParts.length - 1])
      );
    }

    cands.add(lc.replace(/[(),]/g, "").replace(/&/g, "and").replace(/\s+/g, "-"));
    return Array.from(cands).filter(Boolean);
  }

  function resolveUrlFromManifest(canvasPath) {
    if (!ManifestIndex) return null;
    const { byKey, byTitleSlug } = ManifestIndex;

    const candidates = manifestCandidatesFromCanvasPath(canvasPath);
    for (const key of candidates) {
      const k = String(key).trim();
      const arr = byKey.get(k);
      if (arr && arr.length) {
        const withUrl = arr.find(e => !!e.url) || arr[0];
        if (withUrl && withUrl.url) return withUrl.url;
      }
    }

    const lastSeg = slugifySegment(normalizeCanvasPath(canvasPath).split("/").pop());
    if (lastSeg && byTitleSlug.has(lastSeg)) {
      const hit = byTitleSlug.get(lastSeg).find(e => !!e.url) || byTitleSlug.get(lastSeg)[0];
      if (hit) return hit.url || null;
    }

    const lcNoMd = normalizeCanvasPath(canvasPath).toLowerCase();
    for (const e of ManifestIndex.entries) {
      if (
        (e.filePathStem && lcNoMd.endsWith(String(e.filePathStem).toLowerCase())) ||
        (e.inputPath && lcNoMd.endsWith(String(e.inputPath).toLowerCase())) ||
        (e.source && lcNoMd.endsWith(String(e.source).toLowerCase()))
      ) {
        return e.url || null;
      }
    }
    return null;
  }

  // --- HTML scraping helpers for enrichment ---
  function firstNonEmptyParagraph(doc) {
    const P_SELECTORS = [
      "main p", "article p", ".content p", ".prose p",
      ".markdown-rendered p", ".markdown-body p", ".post p",
      "#content p", ".page-content p", ".post-content p",
      ".entry-content p", ".document p", ".note-content p", "p"
    ];
    for (const sel of P_SELECTORS) {
      const ps = doc.querySelectorAll(sel);
      for (const p of ps) {
        const text = (p.textContent || "").replace(/\s+/g, " ").trim();
        if (text && text.length > 10) return text;
      }
    }
    return "";
  }

  function firstImageUrl(doc, pageUrl) {
    const og = doc.querySelector('meta[property="og:image"], meta[name="og:image"]');
    if (og && og.content) return new URL(og.content, pageUrl).href;

    const pre = doc.querySelector('link[rel="preload"][as="image"][href]');
    if (pre) return new URL(pre.getAttribute("href"), pageUrl).href;

    const IMG_SELECTORS = [
      "main img", "article img", ".content img", ".prose img",
      ".markdown-rendered img", ".markdown-body img", ".post img",
      "#content img", ".page img", ".page-content img",
      ".entry-content img", ".note-content img", "figure img", "img"
    ];
    for (const sel of IMG_SELECTORS) {
      const img = doc.querySelector(sel);
      if (!img) continue;

      const srcset = img.getAttribute("srcset");
      if (srcset) {
        const first = srcset.split(",")[0].trim().split(/\s+/)[0];
        if (first) return new URL(first, pageUrl).href;
      }

      const lazySrc = img.getAttribute("data-src") || img.getAttribute("data-lazy-src") || img.getAttribute("data-original");
      if (lazySrc) return new URL(lazySrc, pageUrl).href;

      const src = img.getAttribute("src");
      if (src) return new URL(src, pageUrl).href;
    }
    return "";
  }

  // Robust page fetch with URL variants (for ENR404)
  async function tryFetch(url) {
    const u = new URL(url, location.origin);
    const base = sanitizePath(u.pathname);

    const withSlash = base.endsWith("/") ? base : base + "/";
    const withoutSlash = base.endsWith("/") ? base.slice(0, -1) : base;

    const variants = [
      withSlash,
      withoutSlash,
      withSlash + "index.html",
      withSlash + "index.htm",
    ];

    for (const path of variants) {
      const full = new URL(path, location.origin).toString();
      try {
        const resp = await fetch(full, { credentials: "same-origin" });
        if (resp.ok) {
          const html = await resp.text();
          return { ok: true, url: full, html };
        }
      } catch (_) {}
    }
    return { ok: false, url, html: "" };
  }

  const pageCache = new Map();
  async function fetchPageInfo(url) {
    if (pageCache.has(url)) return pageCache.get(url);
    const p = (async () => {
      const attempt = await tryFetch(url);
      if (!attempt.ok) throw new Error(`ENR404 ${url}`);
      const doc = new DOMParser().parseFromString(attempt.html, "text/html");
      return {
        finalUrl: attempt.url,
        image: firstImageUrl(doc, attempt.url),
        teaser: firstNonEmptyParagraph(doc),
      };
    })();
    pageCache.set(url, p);
    return p;
  }

  // Convert Obsidian JSON Canvas -> viewer data
  function adaptJsonCanvas(jsonCanvas) {
    const items = [];
    const edges = [];

    for (const n of jsonCanvas.nodes || []) {
      const common = {
        id: n.id,
        x: typeof n.x === "number" ? n.x : 0,
        y: typeof n.y === "number" ? n.y : 0,
      };

      if (n.type === "text") {
        const embeds = extractEmbeddedImages(n.text);
        const { title, desc } = extractTitleAndDesc(stripEmbeddedImages(n.text));
        const item = { ...common, title, description: desc };
        if (embeds.length) item.imageCandidates = imageCandidatesFromVaultPath(embeds[0]);
        items.push(item);
        continue;
      }

      if (n.type === "file") {
        const f = String(n.file || "");
        if (isImagePath(f)) {
          items.push({
            ...common,
            title: f.split("/").pop().replace(/\.[^.]+$/, ""),
            description: "",
            imageCandidates: imageCandidatesFromVaultPath(f)
          });
        } else {
          const parts = f.replace(/\.md$/i, "").split("/");
          const title = parts.pop();
          const crumb = parts.length ? parts.join(" › ") : "";
          items.push({
            ...common,
            title,
            description: crumb,
            _canvasPath: f,
            _needsManifestResolve: true,
            _needsEnrich: true,
            _nameGuesses: nameBasedImageCandidates(title)
          });
        }
        continue;
      }

      items.push({ ...common, title: n.type || "node", description: n.file || n.text || "" });
    }

    for (const e of (jsonCanvas.edges || [])) {
      edges.push({ from: e.fromNode, to: e.toNode, label: e.label || "" });
    }

    return { items, edges };
  }

  // Visible diagnostics (only when Debug ON)
  function markUnresolvedCards(appInstance) {
    if (!Debug.isOn()) return;
    const unresolved = (appInstance.data.items || []).filter(it => !it.link && !it._needsManifestResolve && it._canvasPath);
    if (!unresolved.length) return;
    for (const it of unresolved) {
      const el = [...document.querySelectorAll('.card')].find(n => n._itemId === it.id);
      if (!el) continue;
      const b = document.createElement('div');
      b.textContent = 'URL ?';
      b.style.cssText = 'position:absolute;top:8px;left:8px;background:#8e44ad;color:#fff;font:bold 11px/1.6 monospace;padding:2px 6px;border-radius:6px;';
      el.appendChild(b);
      console.warn('[Canvas] No URL resolved from manifest for:', it.title, 'canvasPath=', it._canvasPath);
    }
  }

  function resolveNotesViaManifest(appInstance) {
    const items = appInstance.data.items || [];
    for (const it of items) {
      if (!it._needsManifestResolve) continue;
      const url = resolveUrlFromManifest(it._canvasPath);
      it.link = url || noteUrlFromVaultPath(it._canvasPath);
      delete it._needsManifestResolve;
    }
    appInstance.render();
    markUnresolvedCards(appInstance);
  }

  async function enrichNotesFromHtml(appInstance) {
    const items = appInstance.data.items || [];
    const toEnrich = items.filter(it => it._needsEnrich && it.link);

    const queue = toEnrich.slice();
    const MAX_CONCURRENCY = 4;
    let active = 0;

    return new Promise((resolve) => {
      if (!queue.length) return resolve();

      const kick = () => {
        while (active < MAX_CONCURRENCY && queue.length) {
          const item = queue.shift();
          active += 1;
          fetchNote(item).finally(() => {
            active -= 1;
            if (!queue.length && active === 0) resolve();
            else kick();
          });
        }
      };

      const addBadge = (id, text, css) => {
        if (!Debug.isOn()) return; // suppress badges when not debugging
        const el = [...document.querySelectorAll('.card')].find(n => n._itemId === id);
        if (!el) return;
        const b = document.createElement('div');
        b.textContent = text;
        b.style.cssText = css;
        el.appendChild(b);
      };

      const fetchNote = async (item) => {
        try {
          const info = await fetchPageInfo(item.link);

          const cands = [];
          if (info.image) cands.push(info.image);
          if (Array.isArray(item._nameGuesses)) cands.push(...item._nameGuesses);
          if (Array.isArray(item.imageCandidates)) cands.push(...item.imageCandidates);
          item.imageCandidates = Array.from(new Set(cands));

          if (info.teaser) {
            item.description = item.description
              ? `${item.description}\n${info.teaser}`
              : info.teaser;
          }

          if ((!info.teaser || !info.teaser.trim()) &&
              (!item.imageCandidates || item.imageCandidates.length === 0)) {
            addBadge(item.id, 'NO CONTENT', 'position:absolute;top:8px;left:8px;background:#7f8c8d;color:#fff;font:bold 11px/1.6 monospace;padding:2px 6px;border-radius:6px;');
          }

          appInstance.render();
        } catch (err) {
          if (Debug.isOn()) console.warn("Enrich failed for", item.link, err);
          addBadge(item.id, 'ENR 404', 'position:absolute;top:8px;left:8px;background:#555;color:#fff;font:bold 11px/1.6 monospace;padding:2px 6px;border-radius:6px;');
        } finally {
          delete item._needsEnrich;
          delete item._nameGuesses;
        }
      };

      kick();
    });
  }

  async function loadJsonCanvas(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
    return res.json();
  }

  // ---------- boot ----------
  (async () => {
    try {
      await loadManifest();
      const jsonCanvas = await loadJsonCanvas("tir.canvas.json");
      const data = adaptJsonCanvas(jsonCanvas);
      app.setData(data);
      resolveNotesViaManifest(app);
      await enrichNotesFromHtml(app);
    } catch (err) {
      if (Debug.isOn()) console.error("Failed to load/enrich canvas with manifest:", err);
      app.setData({ items: [] });
    }

    const resetBtn = document.getElementById('btn-reset');
    if (resetBtn) resetBtn.addEventListener('click', () => app.resetView());

    const saveBtn = document.getElementById('btn-save');
    if (saveBtn) saveBtn.addEventListener('click', () => {
      const data = app.getData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: 'data.json' });
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    });

// Ensure we have a toolbar element (use existing, else create one in <body>)
function ensureToolbar() {
  let tb = document.querySelector('.toolbar');
  if (!tb) {
    tb = document.createElement('div');
    tb.className = 'toolbar';
    document.body.appendChild(tb);
  }
  return tb;
}

// Create or reuse a button by id
function ensureButton(toolbar, id, label, title) {
  let btn = document.getElementById(id);
  if (!btn) {
    btn = document.createElement('button');
    btn.id = id;
    btn.type = 'button';
    btn.textContent = label;
    if (title) btn.title = title;
    toolbar.appendChild(btn);
  }
  return btn;
}

// --- Save to Repo via Pages Function ---
async function saveCanvasToRepo() {
  const btn = document.getElementById('btn-save-repo');
  try {
    if (btn) {
      btn.classList.add('saving');
      btn.disabled = true;
      btn.textContent = 'Saving…';
    }

    const payload = {
      // path to the canvas JSON inside your repo:
      path: "src/site/canvas/tir.canvas.json",
      data: window.CanvasAppInstance.getData(),
      message: "chore(canvas): update positions from canvas UI"
    };

    const res = await fetch("/api/save-canvas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Save failed (${res.status}) ${txt}`);
    }

    if (btn) {
      btn.textContent = "Saved ✓";
      setTimeout(() => {
        btn.textContent = "Save to Repo";
        btn.classList.remove('saving');
        btn.disabled = false;
      }, 1200);
    }
  } catch (err) {
    console.error(err);
    alert("Save failed. Open DevTools for details.");
    if (btn) {
      btn.textContent = "Save to Repo";
      btn.classList.remove('saving');
      btn.disabled = false;
    }
  }
}

// === Call this during boot (after the app is initialized) ===
(function wireToolbarEnhancements() {
  const toolbar = ensureToolbar();

  // Reuse existing zoom label if you have it; otherwise create it.
  let zoomLabel = document.getElementById('zoom-level');
  if (!zoomLabel) {
    const span = document.createElement('span');
    span.id = 'zoom-level';
    span.textContent = '100%';
    span.style.marginLeft = '8px';
    toolbar.appendChild(span);
  }

  // Add or reuse the Save-to-Repo button
  const saveRepoBtn = ensureButton(toolbar, 'btn-save-repo', 'Save to Repo', 'Commit canvas positions to the repository');
  saveRepoBtn.addEventListener('click', saveCanvasToRepo);

  // If your Debug toggle is created programmatically, just re-init it here.
  // If you used earlier code with Debug.initToggle(), call it now so it attaches to this toolbar.
  if (typeof Debug !== 'undefined' && Debug.initToggle) {
    Debug.initToggle();
  }
})();


    // add the “Debugging” toggle control (default OFF)
    Debug.initToggle();
  })();
})();
