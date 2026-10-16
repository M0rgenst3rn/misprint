// Wendet MS Printer auf ein ganzes Bild an (für Tests und README-Bilder).
// Aufruf: node tools/print-raw.js <eingabe.rgb> <breite> <höhe> '<params-json>' <ausgabe.rgb>
// Ein- und Ausgabe: rohe RGB-Daten (3 Byte pro Pixel). Ergebnis = Bild + simulierte Gruppe „MS Printer“.
const fs = require("fs");
const path = require("path");
const Core = require(path.join(__dirname, "..", "printer", "core.js"));

const [inFile, w, h, json, outFile] = process.argv.slice(2);
const width = +w, height = +h;
const rgb = new Uint8Array(fs.readFileSync(inFile));
const params = Object.assign({}, Core.DEFAULTS, JSON.parse(json));
const bounds = { left: 0, top: 0, right: width, bottom: height };
const coverage = Core.coverageFromRGBA(rgb, 3, width * height);
const luma = Core.lumaFromRGBA(rgb, 3, width * height);
const out = Core.computeOverlay({ width, height, originX: 0, originY: 0, pxScale: 1, bounds, params, coverage, luma });
fs.writeFileSync(outFile, Core.compositeOverlay(rgb, 3, out, params));
