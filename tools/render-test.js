// Rendert alle Druckfehler auf eine Testform -> PNG, um die Engine ohne Photoshop zu prüfen.
// Aufruf: node tools/render-test.js <ausgabe.png> [json-params]
const fs = require("fs");
const path = require("path");
const Core = require(path.join(__dirname, "..", "printer", "core.js"));
const { encodePNG } = require("./png.js");

const out = process.argv[2] || "test.png";
const extra = process.argv[3] ? JSON.parse(process.argv[3]) : {};
const tw = 300, th = 150, pad = 24;
// Testform: Balken + Kreis
const alpha = new Uint8Array(tw * th);
for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
  const inBar = x >= pad && x < 190 && y >= pad && y < th - pad;
  const dx = x - 236, dy = y - 75;
  if (inBar || dx * dx + dy * dy < 50 * 50) alpha[y * tw + x] = 255;
}
const list = Core.NOISES;
const cols = 5, gap = 10;
const rows = Math.ceil(list.length / cols);
const W = cols * (tw + gap) + gap, H = rows * (th + gap) + gap;
const img = new Uint8Array(W * H * 3).fill(246);
const ink = [214, 40, 56];
let total = 0;
list.forEach((n, k) => {
  const params = Object.assign({}, Core.DEFAULTS, { texture: n.id, strayAmount: 40 }, extra);
  const bounds = { left: 0, top: 0, right: tw, bottom: th };
  const t0 = Date.now();
  const r = Core.computePrint({ alpha, width: tw, height: th, originX: 0, originY: 0, pxScale: 1, bounds, params });
  total += Date.now() - t0;
  const ox = gap + (k % cols) * (tw + gap), oy = gap + Math.floor(k / cols) * (th + gap);
  const inkC = [0x16, 0x16, 0x16];
  for (let i = 0; i < tw * th; i++) {
    const o = ((oy + Math.floor(i / tw)) * W + ox + (i % tw)) * 3;
    const a = alpha[i] / 255 * r.mask[i] / 255;
    for (let c = 0; c < 3; c++) {
      let v = img[o + c] * (1 - a) + ink[c] * a;
      const ta = r.toner[i] / 255 * a; // geclippt
      v = v * (1 - ta) + v * inkC[c] / 255 * ta;
      if (r.stray) { const sa = r.stray[i] / 255; v = v * (1 - sa) + ink[c] * sa; }
      img[o + c] = v;
    }
  }
});
fs.writeFileSync(out, encodePNG(W, H, img, 3));
console.log(`${list.length} Druckfehler, Ø ${(total / list.length).toFixed(0)} ms je ${tw}x${th}px`);
