// Creates the plugin icons (a "P" with printer grain) with its own engine.
const fs = require("fs");
const path = require("path");
const Core = require(path.join(__dirname, "..", "printer", "core.js"));
const { encodePNG } = require("./png.js");

const dir = path.join(__dirname, "..", "printer", "icons");
fs.mkdirSync(dir, { recursive: true });

function icon(size, file) {
  const alpha = new Uint8Array(size * size);
  const m = size * 0.16, stroke = size * 0.2;
  const cx = size * 0.48, cy = size * 0.36, r = size * 0.2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    // letter P: stem + ring on top
    const inStem = x >= m && x < m + stroke && y >= m && y < size - m;
    const dx = x - cx, dy = y - cy, d = Math.sqrt(dx * dx + dy * dy);
    const inBowl = (x >= cx ? d <= r + stroke / 2 && d >= r - stroke / 2 : (Math.abs(y - (cy - r)) < stroke / 2 || Math.abs(y - (cy + r)) < stroke / 2) && x >= m);
    if (inStem || inBowl) alpha[y * size + x] = 255;
  }
  const p = Object.assign({}, Core.DEFAULTS, { texture: "copygrain", scale: size * 1.5, intensity: 70, toner: 0, dropout: 25, grain: 30, edgeRoughness: 0 });
  const res = Core.computePrint({ alpha, width: size, height: size, originX: 0, originY: 0, pxScale: 1, bounds: { left: 0, top: 0, right: size, bottom: size }, params: p });
  const rgba = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    rgba[i * 4] = 220; rgba[i * 4 + 1] = 220; rgba[i * 4 + 2] = 220;
    rgba[i * 4 + 3] = alpha[i] * res.mask[i] / 255;
  }
  fs.writeFileSync(path.join(dir, file), encodePNG(size, size, rgba, 4));
}

icon(23, "icon@1x.png");
icon(46, "icon@2x.png");
icon(48, "plugin@1x.png");
icon(96, "plugin@2x.png");
console.log("Icons geschrieben:", fs.readdirSync(dir).join(", "));
