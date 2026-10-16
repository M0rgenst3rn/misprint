// Wendet die MS-Printer-Engine auf eine rohe Alpha-Maske an (für Showcase-Bilder).
// Aufruf: node tools/print-raw.js <alpha.raw> <breite> <höhe> '<params-json>' <ausgabe-präfix>
// Schreibt <präfix>.mask/.toner/.stray/.misreg/.light (je w*h Byte, fehlende Teile = 0).
const fs = require("fs");
const path = require("path");
const Core = require(path.join(__dirname, "..", "printer", "core.js"));

const [inFile, w, h, json, prefix] = process.argv.slice(2);
const width = +w, height = +h;
const alpha = new Uint8Array(fs.readFileSync(inFile));
const params = Object.assign({}, Core.DEFAULTS, JSON.parse(json));
const bounds = { left: 0, top: 0, right: width, bottom: height };
const r = Core.computePrint({ alpha, width, height, originX: 0, originY: 0, pxScale: 1, bounds, params });
const empty = new Uint8Array(width * height);
for (const k of ["mask", "toner", "stray", "misreg", "light"]) fs.writeFileSync(`${prefix}.${k}`, r[k] || empty);
