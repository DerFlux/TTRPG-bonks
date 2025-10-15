require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const crypto = require("crypto");
const {globSync} = require("glob");

const themeCommentRegex = /\/\*[\s\S]*?\*\//g;
    
    const fs = require('fs');
    const path = require('path');
    const chosen = path.join(__dirname, '../styles/_theme.YOURHASH.css'); // your existing variable
    const stable = path.join(__dirname, '../styles/theme.css');
    fs.copyFileSync(chosen, stable);
    console.log('Wrote stable theme.css');

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
