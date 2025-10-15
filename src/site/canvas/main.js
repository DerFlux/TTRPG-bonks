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
      // remove dots used as section markers like "3. NPCs"
      .replace(/\./g, " ")
      // collapse non-letters/digits to hyphen
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      // collapse multiple hyphens
      .replace(/-+/g, "-")
      // trim hyphens
      .replace(/^-|-$/g, "")
      .toLowerCase();
  }

  // Some folders are renamed by your site build (e.g. "3. NPCs" -> "3-np-cs")
  const segmentMap = new Map([
    ["3-npcs", "3-np-cs"],
  ]);

  function mapSegment(seg) {
    const s = slugifySegment(seg);
    return segmentMap.get(s) || s;
  }

  // Build a site URL from an Obsidian vault path to a note (no /notes prefix)
  function noteUrlFromVaultPath(vaultPath) {
    if (!vaultPath) return null;
    if (isImagePath(vaultPath)) return null;

    const withoutExt = vaultPath.replace(/\.md$/i, "");
    const parts = withoutExt.split("/").map(mapSegment).filter(Boolean);

    // Your site uses trailing slash on note pages
    return "/" + parts.join("/") + "/";
  }

  // Map canvas image path to the published image URL in your repo
  function imageUrlFromVaultPath(vaultPath) {
    // Canvas often stores "Images/Foo Bar.png" etc.
    if (!vaultPath) return null;
    const path = vaultPath.replace(/^Images\//i, ""); // strip leading "Images/"
    // Images live in src/site/img/user/Images -> served as /img/user/Images/...
    return "/img/user/Images/" + encodeURI(path);
  }

  // Convert Obsidian JSON Canvas -> viewer data
  function adaptJsonCanvas(jsonCanvas) {
    const items = [];
    const edges = [];

    // Turn the first Markdown heading into a nicer title (optional)
    function extractTitleAndDesc(markdownishText) {
      const text = String(markdownishText || "");
      const lines = text.split(/\r?\n/);
      const first = (lines[0] || "").replace(/^#+\s*/, "").trim();
      const rest = lines.slice(1).join("\n").trim();
      return { title: first || "Text", desc: rest };
    }

    for (const n of jsonCanvas.nodes || []) {
      const common = {
        id: n.id,
        x: typeof n.x === "number" ? n.x : 0,
        y: typeof n.y === "number" ? n.y : 0,
      };

      if (n.type === "text") {
        const { title, desc } = extractTitleAndDesc(n.text);
        items.push({ ...common, title, description: desc });
        continue;
      }

      if (n.type === "file") {
        const f = String(n.file || "");
        if (isImagePath(f)) {
          items.push({
            ...common,
            title: f.split("/").pop().replace(/\.[^.]+$/, ""),
            description: "",
            image: imageUrlFromVaultPath(f),
          });
        } else {
          items.push({
            ...common,
            title: f.split("/").pop().replace(/\.md$/i, ""),
            description: f,
            link: noteUrlFromVaultPath(f),
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
      edges.push({
        from: e.fromNode,
        to: e.toNode,
        label: e.label || "",
      });
    }

    return { items, edges };
  }

  async function loadJsonCanvas(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
    return res.json();
  }

  // ---------- boot ----------
  (async () => {
    try {
      // Load your Obsidian canvas JSON (placed in src/site/canvas/)
      const jsonCanvas = await loadJsonCanvas("tir.canvas.json");
      const data = adaptJsonCanvas(jsonCanvas);
      app.setData(data);
    } catch (err) {
      console.error("Failed to load canvas JSON:", err);
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
})();
