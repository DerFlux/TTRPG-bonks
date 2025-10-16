// src/site/get-theme.js
require("dotenv").config();

const axios = require("axios");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { globSync } = require("glob");

const stylesDir = path.join("src", "site", "styles");
const THEME_ENV = process.env.THEME;
const themeCommentRegex = /\/\*[\s\S]*?\*\//g;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function stripAllButFirstCssComment(css) {
  let skippedFirst = false;
  return String(css).replace(themeCommentRegex, (m) => {
    if (skippedFirst) return "";
    skippedFirst = true;
    return m;
  });
}

function sha256hex(s) {
  const h = crypto.createHash("sha256");
  h.update(s);
  return h.digest("hex");
}

function writeAliasThemeCss(targetHashedFile) {
  const out = `@import url("/styles/${targetHashedFile}");\n`;
  const aliasPath = path.join(stylesDir, "theme.css");
  fs.writeFileSync(aliasPath, out, "utf8");
  console.log(`[get-theme] Wrote theme.css → ${targetHashedFile}`);
}

async function fetchWithSwap(url) {
  // Some Obsidian themes expose theme.css or obsidian.css; try both
  try {
    const res = await axios.get(url, { responseType: "text" });
    if (res.status >= 200 && res.status < 300) return res.data;
  } catch (_) { /* fall through */ }

  let swapped = url;
  if (url.includes("theme.css")) swapped = url.replace("theme.css", "obsidian.css");
  else if (url.includes("obsidian.css")) swapped = url.replace("obsidian.css", "theme.css");
  if (swapped !== url) {
    const res2 = await axios.get(swapped, { responseType: "text" });
    if (res2.status >= 200 && res2.status < 300) return res2.data;
  }
  throw new Error(`Unable to fetch theme from ${url}`);
}

async function main() {
  ensureDir(stylesDir);

  // Remove previous hashed theme files
  const old = globSync(path.join(stylesDir, "_theme.*.css"));
  for (const f of old) {
    try { fs.rmSync(f); } catch {}
  }

  let hashedBasename = null;

  if (THEME_ENV) {
    try {
      const rawCss = await fetchWithSwap(THEME_ENV);
      const css = stripAllButFirstCssComment(rawCss);
      const hash = sha256hex(css).slice(0, 8);
      hashedBasename = `_theme.${hash}.css`;
      const hashedPath = path.join(stylesDir, hashedBasename);
      fs.writeFileSync(hashedPath, css, "utf8");
      console.log(`[get-theme] Downloaded theme and wrote ${hashedBasename}`);
    } catch (err) {
      console.error("[get-theme] Failed to download theme:", err.message || err);
    }
  } else {
    console.warn("[get-theme] THEME env not set; will reuse existing hashed file if present.");
  }

  // If we did not just create one, try to discover an existing hashed file
  if (!hashedBasename) {
    const files = fs.readdirSync(stylesDir);
    const hit = files.find((f) => /^_theme\.[^/]+\.css$/.test(f));
    if (hit) {
      hashedBasename = hit;
      console.log(`[get-theme] Using existing ${hashedBasename}`);
    } else {
      console.warn("[get-theme] No _theme.<hash>.css found; creating minimal placeholder.");
      hashedBasename = `_theme.placeholder.css`;
      fs.writeFileSync(
        path.join(stylesDir, hashedBasename),
        `/* placeholder theme */:root{--color-fg:#eaeaea;--color-bg:#0b0b0f}`,
        "utf8"
      );
    }
  }

  // Always write the stable alias
  writeAliasThemeCss(hashedBasename);
}

main().catch((e) => {
  console.error("[get-theme] Fatal:", e);
  process.exit(1);
});
