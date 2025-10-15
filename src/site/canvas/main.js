// main.js
(function () {
  const container = document.getElementById('canvas-container');
  const world = document.getElementById('world');
  const app = new CanvasApp(container, world);

  // --- small helpers --------------------------------------------------------
  const isImagePath = (p) => /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(p || "");
  const baseNameNoExt = (p) =>
    String(p || "").split("/").pop().replace(/\.[^.]+$/, "");

  // Map an Obsidian vault file path to your site URL.
  // In your Digital Garden setup, links resolve like /notes/<slugified-path>.
  // We'll mimic that by:
  // - removing the .md suffix
  // - slugifying path segments (basic slug)
  const slugify = s => s
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w\-\/]+/g, "")
    .replace(/\/+/g, "/");

  function noteUrlFromVaultPath(vaultPath) {
    if (!vaultPath) return null;
    if (isImagePath(vaultPath)) return null; // handled as image card
    const withoutExt = vaultPath.replace(/\.md$/i, "");
    // Example: "2. Locations/Astra/Astra" -> "/notes/2-locations/astra/astra"
    return "/notes/" + slugify(withoutExt.replace(/\./g, ""));
  }

  // Convert Obsidian JSON Canvas -> our viewer's data format
  function adaptJsonCanvas(jsonCanvas) {
    const items = [];
    const edges = [];

    for (const n of jsonCanvas.nodes || []) {
      const common = {
        id: n.id,
        x: typeof n.x === "number" ? n.x : 0,
        y: typeof n.y === "number" ? n.y : 0
      };

      if (n.type === "text") {
        // Take first heading line as title, rest as description
        const text = String(n.text || "");
        const lines = text.split(/\r?\n/);
        const first = (lines[0] || "").replace(/^#+\s*/, "").trim();
        const rest = lines.slice(1).join("\n").trim();

        items.push({
          ...common,
          title: first || "Text",
          description: rest
        });
      } else if (n.type === "file") {
        const f = String(n.file || "");
        if (isImagePath(f)) {
          // Treat as image card. If the canvas path starts with "Images/",
          // your site serves them from /img/user/Images/...
          const siteImgPath = f.startsWith("Images/")
            ? "/img/user/Images/" + f.substring("Images/".length)
            : "/img/user/Images/" + f; // adjust if all your images live there
          items.push({
            ...common,
            title: baseNameNoExt(f),
            description: "",
            image: siteImgPath
          });
        } else {
          // Link to the rendered note page
          items.push({
            ...common,
            title: baseNameNoExt(f),
            description: f,
            link: noteUrlFromVaultPath(f)
          });
        }
      } else {
        // Unknown node type -> fall back to a generic card
        items.push({
          ...common,
          title: (n.type || "node"),
          description: n.file || n.text || ""
        });
      }
    }

    for (const e of jsonCanvas.edges || []) {
      edges.push({
        from: e.fromNode,
        to: e.toNode,
        label: e.label || ""
      });
    }

    return { items, edges };
  }

  async function loadJsonCanvas(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
    return res.json();
  }

  // --- boot --------------------------------------------------------
  (async () => {
    try {
      // Load your Obsidian canvas JSON directly
      const jsonCanvas = await loadJsonCanvas("tir.canvas.json");
      const data = adaptJsonCanvas(jsonCanvas);
      app.setData(data);
    } catch (err) {
      console.error("Failed to load canvas JSON:", err);
      app.setData({ items: [] });
    }

    // UI: Reset & Save
    document.getElementById('btn-reset').addEventListener('click', () => app.resetView());
    document.getElementById('btn-save').addEventListener('click', () => {
      const data = app.getData(); // positions updated
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: 'data.json' });
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    });
  })();
})();
