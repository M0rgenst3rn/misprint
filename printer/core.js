"use strict";
// MS Printer – Kern-Engine.
// Prozedurale Druckerfehler (Toner, Kopierer, Inkjet, Riso, Raster, Fax …) und die Berechnung
// von Aussetzer-Maske, Toner-Ebene, Streu-Toner und Fehldruck-Versatz.
// Reines JavaScript ohne Photoshop-Abhängigkeit (läuft im Plugin und in Node).

// ---------------------------------------------------------------- Rauschen

function hashi(x, y, s) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
function rnd(x, y, s) { return hashi(x, y, s) / 4294967296; }
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function smooth(a, b, v) {
  if (b <= a) return v < a ? 0 : 1;
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

const GX = new Float32Array([1, -1, 0, 0, 0.7071, -0.7071, 0.7071, -0.7071]);
const GY = new Float32Array([0, 0, 1, -1, 0.7071, 0.7071, -0.7071, -0.7071]);

function perlin(x, y, s) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  let h = hashi(ix, iy, s) & 7;
  const a = GX[h] * fx + GY[h] * fy;
  h = hashi(ix + 1, iy, s) & 7;
  const b = GX[h] * (fx - 1) + GY[h] * fy;
  h = hashi(ix, iy + 1, s) & 7;
  const c = GX[h] * fx + GY[h] * (fy - 1);
  h = hashi(ix + 1, iy + 1, s) & 7;
  const d = GX[h] * (fx - 1) + GY[h] * (fy - 1);
  const ab = a + (b - a) * u, cd = c + (d - c) * u;
  return (ab + (cd - ab) * v) * 1.4;
}

function fbm(x, y, oct, s) {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * perlin(x * f + i * 17.3, y * f - i * 9.1, s + i * 1013);
    norm += amp; amp *= 0.5; f *= 2.03;
  }
  return sum / norm;
}

function ridged(x, y, oct, s) {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    const n = 1 - Math.abs(perlin(x * f, y * f, s + i * 1013));
    sum += amp * n * n; norm += amp; amp *= 0.5; f *= 2.03;
  }
  return sum / norm;
}

// Weißes Rauschen in Zellen der Größe 1/f (Einheiten) – das eigentliche "Druckerkorn"
function wn(x, y, s, f) { return rnd(Math.floor(x * f), Math.floor(y * f), s) * 2 - 1; }

let F1 = 0, F2 = 0, CID = 0;
function cellular(x, y, s) {
  const ix = Math.floor(x), iy = Math.floor(y);
  F1 = 9; F2 = 9; CID = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = ix + i, cy = iy + j;
      const h = hashi(cx, cy, s);
      const dx = cx + (h & 0xffff) / 65536 - x;
      const dy = cy + (h >>> 16) / 65536 - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < F1) { F2 = F1; F1 = d; CID = h; } else if (d < F2) F2 = d;
    }
  }
}
function cidRand(salt) { return hashi(CID, salt, 7) / 4294967296; }

// Linie bei |n| < w (für Streifen/Haare), 1 auf der Linie, 0 daneben
function line(n, w) { return 1 - clamp01(Math.abs(n) / w); }

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

// ---------------------------------------------------------------- Druckerfehler
// Jede Funktion liefert einen Rohwert. NIEDRIG = Toner/Tinte (dunkel), HOCH = Aussetzer (Papier).
// Die Werte werden danach gleichverteilt, damit „Toner 20 %“ bei jedem Typ ~20 % Fläche bedeutet.
// Einheiten: 1 = 64 px bei Scale 100 %.

const NOISES = [
  // --- Laser / Toner
  { id: "toner", group: "Laser", name: "Toner fein", make: (s) => (x, y) =>
    0.55 * wn(x, y, s, 40) + 0.35 * perlin(x * 18, y * 18, s + 1) + 0.35 * fbm(x * 0.8, y * 0.8, 3, s + 2) },
  { id: "tonercoarse", group: "Laser", name: "Toner grob", make: (s) => (x, y) =>
    0.4 * wn(x, y, s, 16) + 0.45 * perlin(x * 7, y * 7, s + 1) + 0.4 * fbm(x * 0.6, y * 0.6, 3, s + 2) },
  { id: "speckles", group: "Laser", name: "Toner-Sprenkel", make: (s) => (x, y) => {
    cellular(x * 6, y * 6, s);
    const dark = clamp01((0.05 + 0.13 * Math.pow(cidRand(1), 3) - F1) / 0.04);
    cellular(x * 5, y * 5, s + 5);
    const light = clamp01((0.04 + 0.1 * Math.pow(cidRand(2), 3) - F1) / 0.04);
    return light - dark + 0.12 * fbm(x * 1.5, y * 1.5, 3, s + 3) + 0.08 * wn(x, y, s + 4, 40);
  } },
  { id: "clumps", group: "Laser", name: "Toner-Klumpen", make: (s) => (x, y) => {
    const w = fbm(x * 2, y * 2, 3, s + 1) * 0.15;
    cellular(x * 2.2 + w, y * 2.2 - w, s);
    const blob = clamp01((0.08 + 0.25 * Math.pow(cidRand(1), 2) - F1) / 0.06);
    return 0.35 * fbm(x * 1.2, y * 1.2, 4, s + 2) - blob + 0.1 * wn(x, y, s + 3, 30);
  } },
  { id: "lowtoner", group: "Laser", name: "Toner leer", make: (s) => (x, y) =>
    0.8 * fbm(x * 0.45, y * 0.45, 4, s) + 0.3 * wn(x, y, s + 1, 40) + 0.3 * perlin(x * 6, y * 6, s + 2) },
  { id: "drumstreaks", group: "Laser", name: "Trommel-Streifen", make: (s) => (x, y) =>
    0.8 * fbm(x * 9, y * 0.05, 3, s) + 0.25 * wn(x, y, s + 1, 40) + 0.2 * fbm(x * 0.5, y * 0.5, 2, s + 2) },
  { id: "drumscratch", group: "Laser", name: "Trommel-Kratzer", make: (s) => (x, y) => {
    const col = Math.floor(x * 24);
    const on = rnd(col, 1, s) > 0.86 ? 1 : 0;
    const fx = x * 24 - col - 0.5;
    const len = clamp01(fbm(x * 0.2, y * 0.15, 2, s + col) * 2 + 0.6);
    return on * line(fx, 0.35) * len * 1.2 + 0.25 * wn(x, y, s + 2, 40) + 0.2 * fbm(x, y, 3, s + 3);
  } },
  { id: "banding", group: "Laser", name: "Banding", make: (s) => (x, y) =>
    0.45 * Math.sin((y * 1.3 + fbm(x * 0.1, y * 0.1, 2, s) * 0.3) * Math.PI * 2) + 0.35 * fbm(x * 0.3, y * 5, 3, s + 1) + 0.25 * wn(x, y, s + 2, 40) },
  { id: "fuser", group: "Laser", name: "Fixierer-Schliere", make: (s) => (x, y) =>
    fbm(x * 0.05, y * 9, 4, s) + 0.3 * fbm(x * 2, y * 2, 3, s + 1) + 0.15 * wn(x, y, s + 2, 40) },
  { id: "ghost", group: "Laser", name: "Laser-Ghosting", make: (s) => (x, y) =>
    0.5 * Math.sin((y * 0.6 + fbm(x * 0.3, y * 0.3, 2, s) * 0.5) * Math.PI * 2) * fbm(x * 0.6, y * 0.6, 3, s + 1) + 0.3 * wn(x, y, s + 2, 40) + 0.3 * fbm(x * 3, y * 3, 2, s + 3) },
  // --- Kopierer / Scanner
  { id: "copygrain", group: "Kopierer", name: "Kopierer-Korn", make: (s) => (x, y) =>
    0.5 * wn(x, y, s, 30) + 0.4 * perlin(x * 12, y * 12, s + 1) + 0.3 * fbm(x * 0.4, y * 0.4, 3, s + 2) },
  { id: "copy3", group: "Kopierer", name: "Kopie 3. Gen.", make: (s) => (x, y) =>
    0.5 * fbm(x * 2, y * 2, 5, s) + 0.5 * wn(x, y, s + 1, 22) + 0.35 * ridged(x * 0.4, y * 0.4, 3, s + 2) - 0.2 },
  { id: "copy5", group: "Kopierer", name: "Kopie 5. Gen.", make: (s) => (x, y) => {
    const w = fbm(x * 0.8, y * 0.8, 3, s + 3) * 0.4;
    return 0.6 * fbm(x * 3 + w, y * 3 - w, 5, s) + 0.5 * wn(x, y, s + 1, 16) + 0.4 * perlin(x * 0.3, y * 0.3, s + 2);
  } },
  { id: "glassdust", group: "Kopierer", name: "Glas-Staub", make: (s) => (x, y) => {
    cellular(x * 3, y * 3, s);
    const dot = clamp01((0.02 + 0.1 * Math.pow(cidRand(1), 5) - F1) / 0.02);
    const hair = line(fbm(x * 0.35, y * 0.35, 3, s + 2), 0.01) * clamp01(perlin(x * 0.2, y * 0.2, s + 3) * 3 - 0.5);
    return 0.2 * wn(x, y, s + 4, 40) + 0.15 * fbm(x, y, 2, s + 5) - Math.max(dot, hair * 0.8);
  } },
  { id: "scanlines", group: "Kopierer", name: "Scanner-Linien", make: (s) => (x, y) => {
    const col = Math.floor(x * 30);
    const r = rnd(col, 1, s);
    const v = r > 0.93 ? -1 : r < 0.05 ? 1 : 0;
    return v * line(x * 30 - col - 0.5, 0.4) + 0.25 * wn(x, y, s + 2, 40) + 0.2 * fbm(x * 0.5, y * 0.5, 2, s + 3);
  } },
  { id: "copyedge", group: "Kopierer", name: "Deckel-Schatten", make: (s) => (x, y) =>
    0.7 * fbm(x * 0.15, y * 0.15, 3, s) - 0.5 * ridged(x * 0.6, y * 0.6, 3, s + 1) + 0.3 * wn(x, y, s + 2, 30) },
  // --- Inkjet
  { id: "inkband", group: "Inkjet", name: "Inkjet-Banding", make: (s) => (x, y) =>
    0.4 * Math.sin(y * Math.PI * 2 * 10) + 0.45 * fbm(x * 0.2, y * 10, 3, s) + 0.2 * wn(x, y, s + 1, 40) },
  { id: "nozzle", group: "Inkjet", name: "Düsen-Aussetzer", make: (s) => (x, y) => {
    const row = Math.floor(y * 18);
    const on = rnd(row, 3, s) > 0.82 ? 1 : 0;
    const gap = clamp01(fbm(x * 0.3, row, 2, s + 1) * 3 + 0.6);
    return on * gap * line(y * 18 - row - 0.5, 0.35) + 0.2 * wn(x, y, s + 2, 40) + 0.2 * fbm(x, y, 3, s + 4);
  } },
  { id: "headstrike", group: "Inkjet", name: "Kopf-Schmierer", make: (s) => (x, y) =>
    0.8 * fbm(x * 0.08, y * 3, 4, s) + 0.3 * fbm(x * 1.5, y * 1.5, 3, s + 1) + 0.15 * wn(x, y, s + 2, 40) },
  { id: "dotgain", group: "Inkjet", name: "Dot Gain", make: (s) => (x, y) => {
    cellular(x * 16, y * 16, s);
    return F1 - 0.3 + 0.3 * fbm(x * 0.8, y * 0.8, 3, s + 1);
  } },
  { id: "mottle", group: "Inkjet", name: "Tinten-Mottle", make: (s) => (x, y) =>
    fbm(x * 1.6, y * 1.6, 5, s) + 0.2 * perlin(x * 10, y * 10, s + 1) + 0.1 * wn(x, y, s + 2, 40) },
  { id: "wetink", group: "Inkjet", name: "Nasse Tinte", make: (s) => (x, y) => {
    const wx = fbm(x * 0.9, y * 0.9, 3, s + 1);
    return fbm(x * 1.2 + wx * 1.5, y * 1.2 - wx * 1.5, 5, s) + 0.1 * wn(x, y, s + 2, 40);
  } },
  { id: "starve", group: "Inkjet", name: "Tinte läuft aus", make: (s) => (x, y) =>
    0.6 * fbm(x * 0.2, y * 0.2, 3, s) + 0.45 * fbm(x * 5, y * 0.1, 3, s + 1) + 0.25 * wn(x, y, s + 2, 40) },
  // --- Riso
  { id: "riso", group: "Riso", name: "Riso-Korn", make: (s) => (x, y) =>
    0.5 * wn(x, y, s, 35) + 0.5 * fbm(x * 1.2, y * 1.2, 4, s + 1) },
  { id: "risomottle", group: "Riso", name: "Riso-Fleckig", make: (s) => (x, y) =>
    fbm(x * 0.7, y * 0.7, 5, s) + 0.25 * perlin(x * 16, y * 16, s + 1) + 0.15 * wn(x, y, s + 2, 40) },
  { id: "risoroller", group: "Riso", name: "Riso-Walze", make: (s) => (x, y) =>
    0.6 * fbm(x * 0.06, y * 1.2, 3, s) + 0.3 * Math.sin(y * Math.PI * 2 * 0.7) + 0.3 * wn(x, y, s + 1, 35) },
  { id: "risomaster", group: "Riso", name: "Riso-Master", make: (s) => (x, y) => {
    cellular(x * 22, y * 22, s);
    return 0.5 * (F1 - 0.35) + 0.5 * fbm(x * 0.9, y * 0.9, 4, s + 1) + 0.15 * wn(x, y, s + 2, 40);
  } },
  // --- Raster / Offset / Sieb
  { id: "halftone", group: "Raster", name: "AM-Raster", make: (s) => (x, y) => {
    const gx = (x + y) * 0.7071 * 9, gy = (y - x) * 0.7071 * 9;
    const cx = gx - Math.floor(gx) - 0.5, cy = gy - Math.floor(gy) - 0.5;
    return Math.sqrt(cx * cx + cy * cy) - (0.5 + 0.5 * fbm(x * 0.4, y * 0.4, 3, s)) * 0.55;
  } },
  { id: "lines", group: "Raster", name: "Linienraster", make: (s) => (x, y) => {
    const g = (x * 0.5 + y * 0.866) * 10;
    return Math.abs(g - Math.floor(g) - 0.5) - (0.25 + 0.2 * fbm(x * 0.5, y * 0.5, 3, s));
  } },
  { id: "fm", group: "Raster", name: "FM-Raster", make: (s) => (x, y) => {
    cellular(x * 26, y * 26, s);
    return 0.6 * F1 + 0.4 * fbm(x * 0.7, y * 0.7, 4, s + 1);
  } },
  { id: "moire", group: "Raster", name: "Moiré", make: (s) => {
    const a = 0.12 + rnd(1, 2, s) * 0.1, ca = Math.cos(a), sa = Math.sin(a);
    return (x, y) => {
      const f = 10;
      const v1 = Math.cos(x * f * Math.PI * 2) * Math.cos(y * f * Math.PI * 2);
      const xr = x * ca - y * sa, yr = x * sa + y * ca;
      const v2 = Math.cos(xr * f * Math.PI * 2) * Math.cos(yr * f * Math.PI * 2);
      return v1 + v2 + 0.2 * wn(x, y, s, 40);
    };
  } },
  { id: "newsprint", group: "Raster", name: "Zeitungsdruck", make: (s) => (x, y) => {
    const gx = (x + y) * 0.7071 * 7, gy = (y - x) * 0.7071 * 7;
    const cx = gx - Math.floor(gx) - 0.5, cy = gy - Math.floor(gy) - 0.5;
    return 0.6 * (Math.sqrt(cx * cx + cy * cy) - 0.3) + 0.35 * fbm(x * 1.5, y * 1.5, 4, s) + 0.25 * wn(x, y, s + 1, 30);
  } },
  { id: "mesh", group: "Raster", name: "Siebdruck-Gewebe", make: (s) => (x, y) =>
    0.45 * Math.sin(x * 22 * Math.PI) * Math.sin(y * 22 * Math.PI) + 0.5 * fbm(x * 0.9, y * 0.9, 4, s) + 0.15 * wn(x, y, s + 1, 40) },
  { id: "offsetmottle", group: "Raster", name: "Offset-Wolkig", make: (s) => (x, y) =>
    0.8 * fbm(x * 0.5, y * 0.5, 5, s) + 0.2 * Math.sin(x * 9 * Math.PI) * Math.sin(y * 9 * Math.PI) + 0.1 * wn(x, y, s + 1, 40) },
  // --- Fax / Thermo / Nadel
  { id: "fax", group: "Fax & Bon", name: "Fax-Linien", make: (s) => (x, y) => {
    const row = Math.floor(y * 24);
    return 0.5 * (rnd(row, 1, s) - 0.5) + 0.4 * fbm(x * 3, row * 0.37, 2, s + 1) + 0.3 * wn(x, y, s + 2, 30);
  } },
  { id: "thermal", group: "Fax & Bon", name: "Thermodruck", make: (s) => (x, y) =>
    0.7 * fbm(x * 0.05, y * 0.8, 3, s) + 0.3 * wn(x, y, s + 1, 40) + 0.2 * fbm(x * 2, y * 2, 2, s + 2) },
  { id: "receipt", group: "Fax & Bon", name: "Kassenbon", make: (s) => (x, y) =>
    0.5 * fbm(x * 0.05, y * 0.6, 3, s) + 0.4 * fbm(x * 8, y * 0.04, 3, s + 1) + 0.25 * wn(x, y, s + 2, 40) },
  { id: "dotmatrix", group: "Fax & Bon", name: "Nadeldrucker", make: (s) => (x, y) => {
    const ry = y * 10, row = Math.floor(ry);
    const off = (rnd(row, 4, s) - 0.5) * 0.25;
    const rx = x * 14 + off;
    const dx = rx - Math.floor(rx) - 0.5, dy = ry - row - 0.5;
    return Math.sqrt(dx * dx + dy * dy) - 0.38 + 0.25 * fbm(x * 0.4, y * 2, 3, s + 1);
  } },
  // --- Digital / Papier
  { id: "bayer", group: "Digital & Papier", name: "Bayer-Dither", make: (s) => (x, y) => {
    const ix = Math.floor(x * 32) & 3, iy = Math.floor(y * 32) & 3;
    return BAYER4[iy * 4 + ix] / 16 - (0.5 + 0.5 * fbm(x * 0.5, y * 0.5, 3, s));
  } },
  { id: "dither", group: "Digital & Papier", name: "Fehlerdiffusion", make: (s) => (x, y) =>
    0.7 * wn(x, y, s, 48) - 0.6 * fbm(x * 0.6, y * 0.6, 3, s + 1) },
  { id: "paper", group: "Digital & Papier", name: "Papierkorn", make: (s) => (x, y) =>
    0.5 * fbm(x * 3, y * 3, 4, s) + 0.5 * perlin(x * 25, y * 25, s + 1) },
  { id: "fibers", group: "Digital & Papier", name: "Papierfasern", make: (s) => {
    const A = [];
    for (let k = 0; k < 4; k++) { const a = rnd(k, 3, s) * Math.PI; A.push([Math.cos(a), Math.sin(a)]); }
    return (x, y) => {
      let v = 0;
      for (let k = 0; k < 4; k++) {
        const xr = x * A[k][0] - y * A[k][1], yr = x * A[k][1] + y * A[k][0];
        v = Math.max(v, line(perlin(xr * 0.5, yr * 10, s + k * 31), 0.08));
      }
      return v * 0.6 + 0.3 * fbm(x * 1.2, y * 1.2, 3, s + 90) + 0.1 * wn(x, y, s + 9, 40);
    };
  } },
  { id: "tonerdust", group: "Digital & Papier", name: "Toner-Staub", make: (s) => (x, y) => {
    cellular(x * 9, y * 9, s);
    return 0.6 * wn(x, y, s + 1, 45) + 0.6 * F1 + 0.2 * fbm(x * 0.5, y * 0.5, 2, s + 2);
  } },
];
const NOISE_BY_ID = {};
for (const n of NOISES) NOISE_BY_ID[n.id] = n;

const DEFAULTS = {
  // Druckfehler-Textur
  texture: "copygrain",
  scale: 100,
  rotation: 0,
  invert: false,
  grainSize: 1.5,
  texture2: "",
  texture2Scale: 100,
  texture2Mix: 50,
  texture2Mode: "blend",
  texture2Invert: false,
  // Ebene "Toner" (dunkle Flecken)
  tonerEnabled: true,
  toner: 25,
  tonerOpacity: 85,
  inkColor: "#161616",
  tonerBlend: "multiply",
  // Ebene "Aussetzer" (Papier scheint durch)
  dropoutEnabled: true,
  dropout: 20,
  dropoutOpacity: 100,
  paperColor: "#ffffff",
  dropoutBlend: "normal",
  // gemeinsam
  grain: 20,
  softness: 15,
  paperDirt: 30,
  autoAdapt: true,          // Fehler an Dokumentfarben anpassen (dunkle Flächen -> helle Fehlstellen)
  strength: 35,             // Deckkraft der ganzen Gruppe "MS Printer"
  fadeAmount: 0,
  fadeStyle: "frame",
  // Papier
  paperGrain: 30,
  paperTone: 0,
  paperToneColor: "#efe4cc",
  seed: 2024,
};

const FADE_STYLES = [
  { id: "top", name: "Von oben" },
  { id: "bottom", name: "Von unten" },
  { id: "left", name: "Von links" },
  { id: "right", name: "Von rechts" },
  { id: "diagonal", name: "Diagonal" },
  { id: "center", name: "Radial – Mitte" },
  { id: "edges", name: "Radial – Rand" },
  { id: "frame", name: "Rahmen" },
  { id: "random", name: "Zufällige Wolken" },
];

const MIX_MODES = [
  { id: "blend", name: "Überblenden" },
  { id: "add", name: "Addieren (beide)" },
  { id: "mask", name: "Maskieren (Überschneidung)" },
];

const BLEND_MODES = [
  { id: "multiply", name: "Multiplizieren" },
  { id: "linearBurn", name: "Linear nachbelichten" },
  { id: "colorBurn", name: "Farbig nachbelichten" },
  { id: "darken", name: "Abdunkeln" },
  { id: "normal", name: "Normal" },
  { id: "overlay", name: "Ineinanderkopieren" },
  { id: "softLight", name: "Weiches Licht" },
];

const LIGHT_MODES = [
  { id: "normal", name: "Normal" },
  { id: "screen", name: "Negativ multiplizieren" },
  { id: "lighten", name: "Aufhellen" },
  { id: "softLight", name: "Weiches Licht" },
  { id: "overlay", name: "Ineinanderkopieren" },
];

// ---------------------------------------------------------------- Sampler + Verteilung

function buildSampler(params, customTex) {
  const seed = params.seed | 0;
  const unit = 64 * Math.max(1, params.scale) / 100;
  const ang = (params.rotation || 0) * Math.PI / 180;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const ox = rnd(seed, 11, 3) * 4096, oy = rnd(seed, 13, 5) * 4096;
  let gen;
  if (customTex && !NOISE_BY_ID[params.texture]) {
    // Bild-Textur (gespiegelt gekachelt); Bilddaten: 255 = dunkel -> invertieren, da hier hoch = Papier
    const { w, h, data } = customTex;
    const k = customTex.k || 1;
    const w2 = w * 2, h2 = h * 2;
    gen = (x, y) => {
      let px = (x * 64) / k, py = (y * 64) / k;
      px = ((px % w2) + w2) % w2; py = ((py % h2) + h2) % h2;
      if (px >= w) px = w2 - px - 1e-3;
      if (py >= h) py = h2 - py - 1e-3;
      if (px < 0) px = 0;
      if (py < 0) py = 0;
      const x0 = px | 0, y0 = py | 0, x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
      const fx = px - x0, fy = py - y0;
      const a = data[y0 * w + x0], b = data[y0 * w + x1], c = data[y1 * w + x0], d = data[y1 * w + x1];
      const ab = a + (b - a) * fx, cd = c + (d - c) * fx;
      return -(ab + (cd - ab) * fy);
    };
  } else {
    gen = (NOISE_BY_ID[params.texture] || NOISES[0]).make(seed);
  }
  const sign = params.invert ? -1 : 1;
  return (xd, yd) => {
    const x = xd / unit, y = yd / unit;
    return sign * gen(x * ca - y * sa + ox, x * sa + y * ca + oy);
  };
}

const BINS = 2048;
function buildCDF(sampler, bounds, n) {
  n = n || 128;
  const bw = Math.max(1, bounds.right - bounds.left), bh = Math.max(1, bounds.bottom - bounds.top);
  const vals = new Float32Array(n * n);
  let min = Infinity, max = -Infinity;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const v = sampler(bounds.left + (i + rnd(i, j, 77)) / n * bw, bounds.top + (j + rnd(i, j, 78)) / n * bh);
      vals[j * n + i] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  const inv = BINS / ((max - min) || 1);
  const hist = new Float64Array(BINS);
  for (let i = 0; i < vals.length; i++) hist[Math.min(BINS - 1, ((vals[i] - min) * inv) | 0)]++;
  const cdf = new Float32Array(BINS + 1);
  for (let i = 0; i < BINS; i++) cdf[i + 1] = cdf[i] + hist[i] / vals.length;
  return { min, inv, cdf };
}

function lookupCDF(c, v) {
  const t = (v - c.min) * c.inv;
  if (t <= 0) return 0;
  if (t >= BINS) return 1;
  const i = t | 0;
  return c.cdf[i] + (c.cdf[i + 1] - c.cdf[i]) * (t - i);
}

// Rauschen 1 (+ optional Rauschen 2) -> { sampler, cdf }
function buildPipeline(p, bounds, tex1, tex2) {
  const s1 = buildSampler(p, tex1);
  const useSecond = p.texture2 && p.texture2Mix > 0 && (NOISE_BY_ID[p.texture2] || tex2);
  if (!useSecond) return { sampler: s1, cdf: buildCDF(s1, bounds) };
  const c1 = buildCDF(s1, bounds);
  const p2 = Object.assign({}, p, {
    texture: p.texture2, scale: p.texture2Scale, seed: (p.seed | 0) + 101, invert: !!p.texture2Invert,
  });
  const s2 = buildSampler(p2, tex2);
  const c2 = buildCDF(s2, bounds);
  const m = Math.min(1, p.texture2Mix / 100);
  const mode = p.texture2Mode;
  const sampler = (xd, yd) => {
    const a = lookupCDF(c1, s1(xd, yd)), b = lookupCDF(c2, s2(xd, yd));
    // "Addieren": beide Fehlerarten sichtbar -> extremere Abweichung von 0.5 gewinnt
    if (mode === "add") { const e = Math.abs(b - 0.5) > Math.abs(a - 0.5) ? b : a; return a + (e - a) * m; }
    if (mode === "mask") return a + ((a - 0.5) * (b < 0.5 ? 1 - b * 2 : (b - 0.5) * 2) + 0.5 - a) * m;
    return a + (b - a) * m;
  };
  return { sampler, cdf: buildCDF(sampler, bounds) };
}

function makeFade(p, b, seed) {
  const bw = Math.max(1, b.right - b.left), bh = Math.max(1, b.bottom - b.top);
  const fu = Math.max(bw, bh) / 3;
  const style = p.fadeStyle;
  return (xd, yd) => {
    const nx = (xd - b.left) / bw, ny = (yd - b.top) / bh;
    let g;
    switch (style) {
      case "top": g = 1 - ny; break;
      case "bottom": g = ny; break;
      case "left": g = 1 - nx; break;
      case "right": g = nx; break;
      case "diagonal": g = 1 - (nx + ny) / 2; break;
      case "center": { const dx = nx - 0.5, dy = ny - 0.5; g = 1 - Math.min(1, Math.sqrt(dx * dx + dy * dy) / 0.7071); break; }
      case "edges": { const dx = nx - 0.5, dy = ny - 0.5; g = Math.min(1, Math.sqrt(dx * dx + dy * dy) / 0.7071); break; }
      case "frame": g = 1 - Math.min(nx, 1 - nx, ny, 1 - ny) * 2; break;
      case "random": g = 0.5 + fbm(xd / fu, yd / fu, 4, seed + 321) * 1.6; break;
      default: g = 1;
    }
    return smooth(0, 1, clamp01(g));
  };
}

// ---------------------------------------------------------------- Overlay-Berechnung
// Berechnet die Textur-Ebenen für das GANZE Dokument (oder einen verkleinerten Ausschnitt für
// die Vorschau; originX/Y + pxScale bilden Pixel auf Dokument-Koordinaten ab).
//   coverage – optional: Farbdeckung des Dokuments (0 = Papier/weiß, 255 = voll bedruckt).
//              Steuert, wie viel Toner-Schmutz auf Papierflächen landet und dass Aussetzer nur
//              auf bedruckten Stellen sichtbar werden.
// Liefert (je w*h Byte):
//   toner – Deckkraft der Toner-Ebene     light – Deckkraft der Aussetzer-Ebene
//   paper – Grauwert der Papierstruktur (128 = neutral für "Weiches Licht") oder null
function computeOverlay(o) {
  const { width: w, height: h, originX, originY, bounds, coverage, luma } = o;
  const pxScale = o.pxScale || 1;
  const p = Object.assign({}, DEFAULTS, o.params);
  const seed = p.seed | 0;
  let sampler = o.sampler, cdf = o.cdf;
  if (!sampler || !cdf) ({ sampler, cdf } = buildPipeline(p, bounds, o.customTex, o.customTex2));
  const fade = makeFade(p, bounds, seed);

  const tonerAmt = p.tonerEnabled ? p.toner / 100 : 0;
  const dropAmt = p.dropoutEnabled ? p.dropout / 100 : 0;
  const grainAmt = p.grain / 100;
  const soft = 0.004 + (p.softness / 100) * 0.2;
  const fadeAmt = p.fadeAmount / 100;
  const gs = Math.max(0.5, p.grainSize);
  const dirt = p.paperDirt / 100;
  const pg = p.paperGrain / 100;
  const auto = !!p.autoAdapt;

  const toner = new Uint8Array(w * h);
  const light = new Uint8Array(w * h);
  const paper = pg > 0 ? new Uint8Array(w * h) : null;

  for (let y = 0; y < h; y++) {
    const yd = originY + (y + 0.5) * pxScale;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const xd = originX + (x + 0.5) * pxScale;
      const F = fadeAmt > 0 ? 1 - fadeAmt * (1 - fade(xd, yd)) : 1;
      const t = lookupCDF(cdf, sampler(xd, yd));
      const drop = dropAmt * F, dark = tonerAmt * F;

      let keep = 1, darkness = 0;
      if (drop > 0) {
        const thr = (1 + soft) - drop * (1 + 2 * soft);
        keep = 1 - smooth(thr - soft, thr + soft, t);
      }
      if (dark > 0) {
        const thr = -soft + dark * (1 + 2 * soft);
        darkness = 1 - smooth(thr - soft, thr + soft, t);
      }
      if (grainAmt > 0) {
        const g = rnd(Math.floor(xd / gs), Math.floor(yd / gs), seed + 77) * 2 - 1;
        const G = grainAmt * F;
        if (g > 0.4 && dropAmt > 0) keep *= 1 - G * (g - 0.4) / 0.6;
        else if (g < -0.4 && tonerAmt > 0) darkness = Math.max(darkness, G * (-g - 0.4) / 0.6);
      }
      const cov = coverage ? coverage[i] / 255 : 1;
      let tonerA = darkness * (cov + (1 - cov) * dirt);
      let lightA = (1 - keep) * Math.min(1, cov * 1.5);
      if (auto && luma) {
        // Dunkle Flecken sieht man nur auf hellen Flächen. Auf dunklen Flächen erscheint derselbe
        // Fehler als helle Stelle (fehlender Toner, Staub) – so wirkt der Look auf jedem Motiv.
        const lum = luma[i] / 255;
        tonerA *= smooth(0.06, 0.4, lum);
        lightA = Math.max(lightA, darkness * (1 - smooth(0.12, 0.5, lum)) * 0.6);
        lightA *= 1 - 0.4 * (1 - smooth(0.08, 0.45, lum)); // große schwarze Flächen nicht vergrauen
      }
      toner[i] = (tonerA * 255 + 0.5) | 0;
      light[i] = (lightA * 255 + 0.5) | 0;
      if (paper) {
        const v = 0.6 * fbm(xd / 40, yd / 40, 4, seed + 900) + 0.4 * perlin(xd / 3, yd / 3, seed + 901);
        paper[i] = Math.max(0, Math.min(255, Math.round(128 + v * 127 * pg * 1.6)));
      }
    }
  }
  return { toner, light, paper };
}

// Farbdeckung aus RGB(A)-Daten: 0 = weißes Papier, 255 = dunkel/bunt bedruckt
function coverageFromRGBA(data, comps, n) {
  const cov = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = data[i * comps], g = data[i * comps + 1], b = data[i * comps + 2];
    const a = comps >= 4 ? data[i * comps + 3] / 255 : 1;
    // Abstand zu Weiß (Helligkeit + Sättigung), damit auch helle bunte Flächen als bedruckt zählen
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    cov[i] = Math.min(255, Math.round(((255 - lum) + sat * 0.6) * 1.4 * a));
  }
  return cov;
}

// Helligkeit (0 = schwarz, 255 = weiß)
function lumaFromRGBA(data, comps, n) {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.round(0.299 * data[i * comps] + 0.587 * data[i * comps + 1] + 0.114 * data[i * comps + 2]);
  return out;
}

// Kurze Analyse fürs Panel: wie viel des Dokuments ist dunkel / bedruckt?
function analyzeDocument(luma, coverage) {
  let dark = 0, ink = 0;
  for (let i = 0; i < luma.length; i++) { if (luma[i] < 90) dark++; if (coverage[i] > 128) ink++; }
  return { darkShare: dark / luma.length, inkShare: ink / luma.length };
}

// Photoshop-Mischmodi (Werte 0..1)
function blend(mode, a, b) {
  switch (mode) {
    case "multiply": return a * b;
    case "linearBurn": return Math.max(0, a + b - 1);
    case "colorBurn": return b <= 0 ? 0 : Math.max(0, 1 - (1 - a) / b);
    case "darken": return Math.min(a, b);
    case "screen": return 1 - (1 - a) * (1 - b);
    case "lighten": return Math.max(a, b);
    case "overlay": return a < 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b);
    case "softLight": return b < 0.5 ? a - (1 - 2 * b) * a * (1 - a) : a + (2 * b - 1) * ((a < 0.25 ? ((16 * a - 12) * a + 4) * a : Math.sqrt(a)) - a);
    default: return b;
  }
}

function hexRGB01(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  const n = m ? parseInt(m[1], 16) : 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// Simuliert die Gruppe „MS Printer“ über dem Dokument (unten -> oben: Papierton, Papierstruktur,
// Toner, Aussetzer) – für Vorschau, Tests und README-Bilder. Liefert RGB (3 Byte/Pixel).
function compositeOverlay(src, comps, out, p) {
  p = Object.assign({}, DEFAULTS, p);
  const toneC = hexRGB01(p.paperToneColor), inkC = hexRGB01(p.inkColor), paperC = hexRGB01(p.paperColor);
  const toneOp = p.paperTone / 100, tonerOp = p.tonerEnabled ? p.tonerOpacity / 100 : 0, dropOp = p.dropoutEnabled ? p.dropoutOpacity / 100 : 0;
  const grpOp = p.strength / 100;
  const n = src.length / comps;
  const rgb = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const ta = out.toner[i] / 255 * tonerOp, la = out.light[i] / 255 * dropOp;
    const pg = out.paper ? out.paper[i] / 255 : 0.5;
    for (let ch = 0; ch < 3; ch++) {
      let v = src[i * comps + ch] / 255;
      if (toneOp > 0) v = v * (1 - toneOp) + blend("multiply", v, toneC[ch]) * toneOp;
      if (out.paper) v = blend("softLight", v, pg);
      if (ta > 0) v = v * (1 - ta) + blend(p.tonerBlend, v, inkC[ch]) * ta;
      if (la > 0) v = v * (1 - la) + blend(p.dropoutBlend, v, paperC[ch]) * la;
      // Deckkraft der ganzen Gruppe
      v = src[i * comps + ch] / 255 * (1 - grpOp) + v * grpOp;
      rgb[i * 3 + ch] = Math.max(0, Math.min(255, Math.round(v * 255)));
    }
  }
  return rgb;
}

// Kachel-Vorschau: mittelgraue Fläche mit Toner (dunkel) und Aussetzern (weiß)
function renderThumb(texId, size, customTex) {
  const p = Object.assign({}, DEFAULTS, { texture: texId, seed: 7 });
  const sampler = buildSampler(p, customTex);
  const region = customTex ? Math.max(customTex.w, customTex.h) * (customTex.k || 1) : 160;
  const px = region / size;
  const b = { left: 0, top: 0, right: region, bottom: region };
  const cdf = buildCDF(sampler, b, 64);
  const out = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = lookupCDF(cdf, sampler((x + 0.5) * px, (y + 0.5) * px));
      const dark = 1 - smooth(0.2, 0.3, t), lightV = smooth(0.72, 0.82, t);
      out[y * size + x] = (120 - dark * 105 + lightV * 130) | 0;
    }
  }
  return out;
}

module.exports = {
  NOISES: NOISES.map((n) => ({ id: n.id, name: n.name, group: n.group })),
  FADE_STYLES, MIX_MODES, BLEND_MODES, LIGHT_MODES, DEFAULTS,
  buildSampler, buildCDF, buildPipeline, computeOverlay, coverageFromRGBA, lumaFromRGBA, analyzeDocument, compositeOverlay, renderThumb,
};
