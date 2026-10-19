// Creates the plugin icons (an "M" with print grain) with its own engine.
const fs = require("fs");
const path = require("path");
const { encodePNG } = require("./png.js");

const dir = path.join(__dirname, "..", "printer", "icons");
fs.mkdirSync(dir, { recursive: true });

function icon(size, file) {
  const alpha = new Uint8Array(size * size);
  const m = size * 0.16, stroke = size * 0.2;
  const cx = size * 0.48, cy = size * 0.36, r = size * 0.2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    // letter M: two stems + two diagonals meeting in the middle
    const sw = stroke * 0.8, midX = size / 2, midY = size * 0.62;
    const inStem = (x >= m && x < m + sw || x >= size - m - sw && x < size - m) && y >= m && y < size - m;
    const seg = (ax, ay, bx, by) => { const vx = bx - ax, vy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy))); return Math.hypot(x - (ax + t * vx), y - (ay + t * vy)); };
    const inBowl = seg(m + sw / 2, m + sw / 2, midX, midY) <= sw / 2 || seg(size - m - sw / 2, m + sw / 2, midX, midY) <= sw / 2;
    if (inStem || inBowl) alpha[y * size + x] = 255;
  }
  // print grain: small dropouts from a hash, like missing toner
  const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) >>> 0; h = ((h ^ (h >>> 13)) * 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const rgba = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const x = i % size, y = (i / size) | 0;
    const drop = hash(Math.floor(x / (size / 24 + 0.5)), Math.floor(y / (size / 24 + 0.5))) < 0.2 ? 0.15 : 1;
    rgba[i * 4] = 220; rgba[i * 4 + 1] = 220; rgba[i * 4 + 2] = 220;
    rgba[i * 4 + 3] = alpha[i] * drop;
  }
  fs.writeFileSync(path.join(dir, file), encodePNG(size, size, rgba, 4));
}

icon(23, "icon@1x.png");
icon(46, "icon@2x.png");
icon(48, "plugin@1x.png");
icon(96, "plugin@2x.png");
console.log("Icons geschrieben:", fs.readdirSync(dir).join(", "));
