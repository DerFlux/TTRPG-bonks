require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const crypto = require("crypto");
const {globSync} = require("glob");

// src/site/get-theme.js (append this to whatever you already do to compute "hash")
import fs from "fs";
import path from "path";

const stylesDir = "src/site/styles";
const files = fs.readdirSync(stylesDir);
const themeHashed = files.find(f => /^_theme\.[^/]+\.css$/.test(f));
if (!themeHashed) throw new Error("No _theme.<hash>.css found in styles.");

const out = `@import url("/styles/${themeHashed}");\n`;
fs.writeFileSync(path.join(stylesDir, "theme.css"), out, "utf8");
console.log("[get-theme] Wrote theme.css →", themeHashed);



const themeCommentRegex = /\/\*[\s\S]*?\*\//g;

async function getTheme() {
  let themeUrl = process.env.THEME;
  if (themeUrl) {
    //https://forum.obsidian.md/t/1-0-theme-migration-guide/42537
    //Not all themes with no legacy mark have a theme.css file, so we need to check for it
    try {
      await axios.get(themeUrl);
    } catch {
      if (themeUrl.indexOf("theme.css") > -1) {
        themeUrl = themeUrl.replace("theme.css", "obsidian.css");
      } else if (themeUrl.indexOf("obsidian.css") > -1) {
        themeUrl = themeUrl.replace("obsidian.css", "theme.css");
      }
    }

    const res = await axios.get(themeUrl);
    try {
      const existing = globSync("src/site/styles/_theme.*.css");
      existing.forEach((file) => {
        fs.rmSync(file);
      });
    } catch {}
    let skippedFirstComment = false;
    const data = res.data.replace(themeCommentRegex, (match) => {
      if (skippedFirstComment) {
        return "";
      } else {
        skippedFirstComment = true;
        return match;
      }
    });
    const hashSum = crypto.createHash("sha256");
    hashSum.update(data);
    const hex = hashSum.digest("hex");
    fs.writeFileSync(`src/site/styles/_theme.${hex.substring(0, 8)}.css`, data);
  }
}

getTheme();
