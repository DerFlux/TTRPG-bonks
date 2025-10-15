// src/site/page-manifest.11ty.js
exports.data = {
  permalink: "page-manifest.json",
  eleventyExcludeFromCollections: true,
};

function normPath(p) {
  return String(p || "")
    .replace(/\\/g, "/")
    .replace(/^\.?\/*/, "")            // strip leading ./ or /
    .replace(/\/+/g, "/");
}

function stripNotesRoot(inputPath) {
  // Try to strip ".../src/site/notes/" so we get vault-like paths
  const n = normPath(inputPath);
  const idx = n.toLowerCase().lastIndexOf("/src/site/notes/");
  if (idx >= 0) return n.slice(idx + "/src/site/notes/".length);
  return n;
}

function makeKeys(p) {
  const base = normPath(p);
  const lc = base.toLowerCase();
  // Keys that often appear in Obsidian canvas
  return Array.from(new Set([
    base,                        // exact
    lc,                          // case-insensitive
    base.replace(/\.md$/i, ""),  // without extension
    lc.replace(/\.md$/i, ""),
  ]));
}

exports.render = ({ collections }) => {
  const all = (collections.all || []).map((p) => {
    const inputPath = normPath(p.inputPath || "");
    const filePathStem = normPath(p.filePathStem || "");
    const url = p.url || "";
    const srcRel = stripNotesRoot(inputPath); // e.g. "2. Locations/Terra/Terra.md"
    const keys = [
      ...makeKeys(srcRel),
      ...makeKeys(filePathStem), // e.g. "2-locations/terra/terra"
    ];
    return { inputPath, filePathStem, srcRel, url, keys };
  });

  // Build a simple index for fast lookups (last one wins is fine)
  const index = {};
  for (const page of all) {
    for (const k of page.keys) index[k] = page.url;
  }

  return JSON.stringify({ pages: all, index }, null, 2);
};
