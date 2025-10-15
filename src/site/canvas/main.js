// main.js
(function () {
  const container = document.getElementById('canvas-container');
  const world = document.getElementById('world');
  const app = new CanvasApp(container, world);
  // expose for quick console checks
  window.CanvasAppInstance = app;

  // ---------- helpers ----------
  const isImagePath = (p) => /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(p || "");

  // Slugify (still used for fallback URL construction, but manifest is preferred)
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

  // You can keep segmentMap; manifest generally makes this unnecessary
  const segmentMap = new Map([
    ["3-npcs", "3-np-cs"],
  ]);
  const mapSegment = (seg) => segmentMap.get(slugifySegment(seg)) || slugifySegment(seg);

  // Fallback builder when manifest cannot resolve
  function noteUrlFromVaultPath(vaultPath) {
    if (!vaultPath) return null;
    if (isImagePath(vaultPath)) return null;
    const withoutExt = vaultPath.replace(/\.md$/i, "");
    const parts = withoutExt.split("/").map(mapSegment).filter(Boolean);
    return "/" + parts.join("/") + "/"; // your site uses trailing slashes
  }

  // Encode each path segment safely (spaces, parentheses, etc.)
  const encodePath = (p) => p.split("/").map((seg) => encodeURIComponent(seg)).join("/");

  // Preferred mapping: Obsidian “Images/…” → /img/user/Images/…
  function imageUrlFromVaultPath(vaultPath) {
    if (!vaultPath) return null;
    const stripped = vaultPath.replace(/^Images\//i, "");
    return "/img/user/Images/" + encodePath(stripped);
  }

  // Robust fallbacks for image nodes
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

    const prefixes = [
      "/img/user/Images/",
      "/img/user/images/",
      "/img/",
    ];

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

  // Extract embedded image wikilinks from text, e.g. "![[Abigail Teach.png]]"
  function extractEmbeddedImages(markdownishText) {
    const text = String(markdownishText || "");
    const regex = /!\[\[([^|\]]+)(?:\|[^]]*)?\]\]/g;
    const files = [];
    let m;
    while ((m = regex.exec(text)) !== null) {
      let f = m[1].trim();
      if (!/[\/\\]/.test(f)) f = "Images/" + f; // filename only → Images/<file>
      files.push(f);
    }
    return files;
  }

  // Remove embedded image syntax for cleaner description
  const stripEmbeddedImages = (s) => String(s || "").replace(/!\[\[[^\]]+\]\]/g, "").trim();

  // Use first Markdown heading as title, rest as description
  function extractTitleAndDesc(markdownishText) {
    const text = String(markdownishText || "");
    const lines = text.split(/\r?\n/);
    const first = (lines[0] || "").replace(/^#+\s*/, "").trim();
    const rest = lines.slice(1).join("\n").trim();
    return { title: first || "Text", desc: rest };
  }

  // Guess image name from a note title (for NPCs etc.)
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
      for (const e of exts) {
        cands.push(`/img/user/Images/${enc}${e}`);
      }
    }
    return cands;
  }

  // -------- Manifest loading & indexing --------
  let ManifestIndex = null; // built form

  async function loadManifest() {
    try {
      const resp = await fetch("/page-manifest.json", { credentials: "same-origin" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const man = await resp.json();
      ManifestIndex = indexManifest(man);
      // expose for debugging
      window.__PageManifestIndex = ManifestIndex;
    } catch (e) {
      console.warn("Could not load /page-manifest.json; will use slug fallback.", e);
      ManifestIndex = { entries: [], byKey: new Map() };
    }
  }

  // Accepts either an array of entries or an object map.
  // Tries to extract {url, filePathStem, inputPath, source, title}
  function indexManifest(man) {
    const entries = [];

    const pushEntry = (obj) => {
      if (!obj) return;
      const url = obj.url || obj.href || obj.permalink || null;
      const filePathStem = obj.filePathStem || obj.filepathStem || obj.stem || null;
      const inputPath = obj.inputPath || obj.input || obj.pageInputPath || obj.source || null;
      const source = obj.sourcePath || obj.page?.inputPath || obj.data?.page?.inputPath || null;
      const title = obj.title || obj.data?.title || null;

      const entry = { url, filePathStem, inputPath, source, title, raw: obj };
      if (entry.url || entry.filePathStem || entry.inputPath || entry.source) {
        entries.push(entry);
      }
    };

    if (Array.isArray(man)) {
      man.forEach(pushEntry);
    } else if (man && typeof man === "object") {
      // If it's a dictionary, the values might be entries
      Object.values(man).forEach(pushEntry);
    }

    // Build key map with a bunch of lookup keys
    const byKey = new Map();

    const addKey = (k, entry) => {
      if (!k) return;
      const key = String(k).trim();
      if (!key) return;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(entry);
    };

    for (const e of entries) {
      // direct keys
      addKey(e.url, e);
      addKey(e.filePathStem, e);
      addKey(e.inputPath, e);
      addKey(e.source, e);

      // normalized variants
      const norm = (s) => String(s || "").replace(/^\.?\/*/, "").toLowerCase();
      const stem = e.filePathStem ? e.filePathStem.replace(/^\/*/, "") : "";
      addKey(norm(stem), e);              // "2-locations/terra/terra"
      addKey("/" + norm(stem), e);        // "/2-locations/terra/terra"
      addKey(norm(e.inputPath), e);
      addKey(norm(e.source), e);

      // also store last 2–3 segments for fuzzy lookups
      const segs = (stem || "").split("/").filter(Boolean);
      const last2 = segs.slice(-2).join("/");
      const last3 = segs.slice(-3).join("/");
      addKey(norm(last2), e);
      addKey(norm(last3), e);
    }

    return { entries, byKey };
  }

  // Resolve a canvas markdown path via manifest
  function resolveUrlFromManifest(canvasPath) {
    if (!ManifestIndex) return null;
    const { byKey } = ManifestIndex;

    const raw = String(canvasPath || "");
    const noMd = raw.replace(/\.md$/i, "");
    const lcNoMd = noMd.toLowerCase();

    const norm = (s) => String(s || "").replace(/^\.?\/*/, "").toLowerCase();
    const parts = norm(noMd).split("/").filter(Boolean);

    // filePathStem-ish candidate (slugified segments)
    const stemCandidate = "/" + parts.map(slugifySegment).join("/");

    // try a bunch of keys in priority order
    const candidates = [
      raw,
      noMd,
      lcNoMd,
      norm(raw),
      norm(noMd),
      stemCandidate,                  // "/2-locations/terra/terra"
      stemCandidate.replace(/^\//, ""), // "2-locations/terra/terra"
    ];

    // also try last-2 and last-3 segments
    const last2 = parts.slice(-2).join("/");
    const last3 = parts.slice(-3).join("/");
    if (last3) candidates.push(last3, norm(last3));
    if (last2) candidates.push(last2, norm(last2));

    for (const key of candidates) {
      const arr = byKey.get(String(key).trim());
      if (arr && arr.length) {
        // prefer entries that actually have a URL
        const withUrl = arr.find(e => !!e.url) || arr[0];
        return withUrl.url || null;
      }
    }

    // as a last resort, try contains-search on entries (expensive but rare)
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
      ".markdown-rendered p", ".markdown-body p", ".post p", "#content p", "p"
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
      "#content img", ".page img", "img"
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

  const pageCache = new Map();
  async function fetchPageInfo(url) {
    if (pageCache.has(url)) return pageCache.get(url);
    const p = (async () => {
      const resp = await fetch(url, { credentials: "same-origin" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
      const html = await resp.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      return {
        image: firstImageUrl(doc, url),
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
          // Markdown note card. Build a clean breadcrumb; URL resolved via manifest later.
          const parts = f.replace(/\.md$/i, "").split("/");
          const title = parts.pop();
          const crumb = parts.length ? parts.join(" › ") : "";
          items.push({
            ...common,
            title,
            description: crumb,
            _canvasPath: f,                 // keep original path for manifest lookup
            _needsManifestResolve: true,    // mark for manifest resolution
            _needsEnrich: true,             // then enrichment
            _nameGuesses: nameBasedImageCandidates(title)
          });
        }
        continue;
      }

      // Fallback
      items.push({
        ...common,
        title: n.type || "node",
        description: n.file || n.text || "",
      });
    }

    for (const e of (jsonCanvas.edges || [])) {
      edges.push({ from: e.fromNode, to: e.toNode, label: e.label || "" });
    }

    return { items, edges };
  }

  // Resolve all Markdown notes via manifest; then attach .link
  function resolveNotesViaManifest(appInstance) {
    const items = appInstance.data.items || [];
    for (const it of items) {
      if (!it._needsManifestResolve) continue;
      const url = resolveUrlFromManifest(it._canvasPath);
      it.link = url || noteUrlFromVaultPath(it._canvasPath); // fallback if manifest misses
      delete it._needsManifestResolve;
    }
    appInstance.render();
  }

  // Enrichment (first image + teaser) using real URL
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

          appInstance.render();
        } catch (err) {
          console.warn("Enrich failed for", item.link, err);
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
      // 1) Load manifest first
      await loadManifest();

      // 2) Load your Obsidian canvas JSON (placed in src/site/canvas/)
      const jsonCanvas = await loadJsonCanvas("tir.canvas.json");
      const data = adaptJsonCanvas(jsonCanvas);

      // 3) Initial render
      app.setData(data);

      // 4) Resolve Markdown note URLs via manifest
      resolveNotesViaManifest(app);

      // 5) Progressive enrichment (fetch first image + paragraph for note cards)
      await enrichNotesFromHtml(app);
    } catch (err) {
      console.error("Failed to load/enrich canvas with manifest:", err);
      app.setData({ items: [] });
    }

    // Buttons (if present)
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
  })();
})();
