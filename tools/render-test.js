// Renders every print defect over a test artwork -> PNG, to check the engine without Photoshop.
// Usage: node tools/render-test.js <output.png> [json-params]
const fs = require("fs");
const path = require("path");
const Core = require(path.join(__dirname, "..", "printer", "core.js"));
const { encodePNG } = require("./png.js");

const out = process.argv[2] || "test.png";
const extra = process.argv[3] ? JSON.parse(process.argv[3]) : {};
const tw = 300, th = 170;
// test artwork: white paper, black bar, red circle, blue stripe
const art = new Uint8Array(tw * th * 3).fill(255);
for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
  let c = null;
  if (x >= 18 && x < 170 && y >= 18 && y < 90) c = [24, 24, 28];
  const dx = x - 232, dy = y - 60;
  if (dx * dx + dy * dy < 45 * 45) c = [214, 40, 56];
  if (x >= 18 && x < 282 && y >= 115 && y < 140) c = [40, 90, 200];
  if (c) art.set(c, (y * tw + x) * 3);
}
const coverage = Core.coverageFromRGBA(art, 3, tw * th);
const list = Core.NOISES;
const cols = 5, gap = 10;
const rows = Math.ceil(list.length / cols);
const W = cols * (tw + gap) + gap, H = rows * (th + gap) + gap;
const img = new Uint8Array(W * H * 3).fill(200);
let total = 0;
list.forEach((n, k) => {
  const params = Object.assign({}, Core.DEFAULTS, { texture: n.id }, extra);
  const bounds = { left: 0, top: 0, right: tw, bottom: th };
  const t0 = Date.now();
  const r = Core.computeOverlay({ width: tw, height: th, originX: 0, originY: 0, pxScale: 1, bounds, params, coverage });
  const rgb = Core.compositeOverlay(art, 3, r, params);
  total += Date.now() - t0;
  const ox = gap + (k % cols) * (tw + gap), oy = gap + Math.floor(k / cols) * (th + gap);
  for (let y = 0; y < th; y++) img.set(rgb.subarray(y * tw * 3, (y + 1) * tw * 3), ((oy + y) * W + ox) * 3);
});
fs.writeFileSync(out, encodePNG(W, H, img, 3));
console.log(`${list.length} Druckfehler, Ø ${(total / list.length).toFixed(0)} ms je ${tw}x${th}px`);
