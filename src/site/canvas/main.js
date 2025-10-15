// main.js
(function () {
  const container = document.getElementById('canvas-container');
  const world = document.getElementById('world');
  const app = new CanvasApp(container, world);

  // ---------- helpers ----------
  const isImagePath = (p) => /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(p || "");

  // Slugify a single path segment similar to Eleventy's output
  function slugifySegment(seg) {
    return String(seg || "")
      .trim()
      .replace(/\./g, " ")                 // "3. NPCs" → "3 NPCs"
      .replace(/[^\p{L}\p{N}]+/gu, "-")    // spaces/punct → hyphen
      .replace(/-+/g, "-")                 // collapse hyphens
      .replace(/^-|-$/g, "")               // trim hyphens
      .toLowerCase();
  }

  // Some folders are renamed by your site build (e.g. "3. NPCs" -> "3-np-cs")
  const segmentMap = new Map([
    ["3-npcs", "3-np-cs"],
  ]);
  const mapSegment = (seg) => segmentMap.get(slugifySegment(seg)) || slugifySegment(seg);

  // Build a site URL from an Obsidian vault path to a note (no /notes prefix)
  function noteUrlFromVaultPath(vaultPath) {
    if (!vaultPath) return null;
    if (isImagePath(vaultPath)) return null;

    const withoutExt = vaultPath.replace(/\.md$/i, "");
    const parts = withoutExt.split("/").map(mapSegment).filter(Boolean);
    return "/" + parts.join("/") + "/"; // your site uses trailing slashes
  }

  // Encode each path segment safely (spaces, parentheses, etc.)
  const encodePath = (p) =>
    p.split("/").map((seg) => encodeURIComponent(seg)).join("/");

  // Preferred mapping: Obsidian “Images/…” → /img/user/Images/…
  function imageUrlFromVaultPath(vaultPath) {
    if (!vaultPath) return null;
    const stripped = vaultPath.replace(/^Images\//i, "");
    return "/img/user/Images/" + encodePath(stripped);
  }

  // Robust fallbacks: multiple locations, case and extension variants
  function imageCandidatesFromVaultPath(vaultPath) {
    if (!vaultPath) return [];
    const stripped = vaultPath.replace(/^Images\//i, "");
    const enc = encodePath(stripped);
    const lowerEnc = enc.toLowerCase();

    // split base/ext
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
      "/img/", // just in case images ended up directly under /img
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

    // Also include the raw encodings
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
        if (embeds.length) {
          item.imageCandidates = imageCandidatesFromVaultPath(embeds[0]);
        }
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
          // Note card (Markdown). Start with a clean breadcrumb; enrich later via fetch.
          const parts = f.replace(/\.md$/i, "").split("/");
          const title = parts.pop();
          const crumb = parts.length ? parts.join(" › ") : "";

          items.push({
            ...common,
            title,
            description: crumb,
            link: noteUrlFromVaultPath(f),
            _needsEnrich: true // mark for HTML fetch
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

  // --------- enrichment: fetch built HTML of notes to pull first image + teaser text
  async function enrichNotesFromHtml(appInstance) {
    const items = appInstance.data.items || [];
    const toEnrich = items.filter(it => it._needsEnrich && it.link);

    // Limit concurrency a bit
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
          const resp = await fetch(item.link, { credentials: "same-origin" });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const html = await resp.text();
          const doc = new DOMParser().parseFromString(html, "text/html");

          // pick first image (prefer images inside main/article/content)
          let img = doc.querySelector("main img, article img, .content img, .post img, img");
          if (img && img.getAttribute("src")) {
            const abs = new URL(img.getAttribute("src"), item.link).href;
            const cands = item.imageCandidates ? item.imageCandidates.slice() : [];
            if (!cands.includes(abs)) cands.unshift(abs);
            item.imageCandidates = cands;
          }

          // pick first meaningful paragraph of text
          let p = doc.querySelector("main p, article p, .content p, .post p, p");
          if (p) {
            const text = p.textContent.trim().replace(/\s+/g, " ");
            if (text) {
              // keep breadcrumb if present, add a line break + teaser
              item.description = item.description
                ? `${item.description}\n${text}`
                : text;
            }
          }

          // reflect changes on screen
          appInstance.render();
        } catch (err) {
          // Silent-ish: leave the card as-is
          console.warn("Enrich failed for", item.link, err);
        } finally {
          delete item._needsEnrich;
        }
      };

      kick();
    });
  }

  // ---------- boot ----------
  (async () => {
    try {
      // Load your Obsidian canvas JSON (placed in src/site/canvas/)
      const jsonCanvas = await loadJsonCanvas("tir.canvas.json");
      const data = adaptJsonCanvas(jsonCanvas);

      // Initial render (fast)
      app.setData(data);

      // Progressive enrichment (fetch first image + paragraph for note cards)
      await enrichNotesFromHtml(app);
    } catch (err) {
      console.error("Failed to load/enrich canvas:", err);
      app.setData({ items: [] });
    }

    document.getElementById('btn-reset').addEventListener('click', () => app.resetView());
    document.getElementById('btn-save').addEventListener('click', () => {
      const data = app.getData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: 'data.json' });
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    });
  })();

  async function loadJsonCanvas(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
    return res.json();
  }
})();
