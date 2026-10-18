// Applies MS Printer to a whole image (for tests and README images).
// Usage: node tools/print-raw.js <input.rgb> <width> <height> '<params-json>' <output.rgb>
// Input and output: raw RGB data (3 bytes per pixel). Result = image + simulated group "MS Printer".
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
