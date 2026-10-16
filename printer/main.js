"use strict";
// MS Printer – Photoshop-UXP-Panel.
// Ebenen-Modus: Aussetzer als Ebenenmaske, Toner als geclippte Ebene, optional Streu-Toner und
// Fehldruck-Versatz als eigene Ebenen. Dokument-Modus: eine Overlay-Ebene über allem.

const { app, core, action, imaging } = require("photoshop");
const { batchPlay } = action;
const Core = require("./core.js");
const uxpStorage = require("uxp").storage;
const lfs = uxpStorage.localFileSystem;

const $ = (id) => document.getElementById(id);
const STORE_KEY = "msprinter.state.v1";
const PRESET_KEY = "msprinter.presets.v1";
const SUFFIX = { toner: " · Toner", stray: " · Streutoner", misreg: " · Versatz" };
const OVERLAY_NAME = "MS Printer · Overlay";
const HIST = "MS Printer";

const BUILTIN_PRESETS = {
  "Laserdrucker – Toner leer": { texture: "lowtoner", scale: 120, intensity: 85, toner: 8, dropout: 45, grain: 30, softness: 20 },
  "Laserdrucker – Streifen": { texture: "drumstreaks", scale: 100, intensity: 75, toner: 30, dropout: 15, grain: 20 },
  "Fotokopie": { texture: "copygrain", intensity: 70, toner: 30, dropout: 20, grain: 30, strayAmount: 30, strayDistance: 18 },
  "Fotokopie – 3. Generation": { texture: "copy3", scale: 120, intensity: 90, toner: 40, dropout: 35, grain: 50, edgeRoughness: 3, strayAmount: 50, strayDistance: 25 },
  "Fotokopie – kaputt": { texture: "copy5", scale: 140, intensity: 100, toner: 45, dropout: 40, grain: 60, edgeRoughness: 5, strayAmount: 70, strayDistance: 35, texture2: "glassdust", texture2Mix: 60, texture2Mode: "add" },
  "Riso – Zweifarbig": { texture: "riso", intensity: 70, toner: 12, dropout: 30, grain: 30, misregEnabled: true, misregX: 3, misregY: 2, misregColor: "#ff48b0", misregOpacity: 75 },
  "Riso – Fleckig": { texture: "risomottle", scale: 130, intensity: 75, toner: 10, dropout: 40, grain: 25, inkColor: "#3a2a1a", inkOpacity: 60 },
  "Zeitungsdruck": { texture: "newsprint", intensity: 70, toner: 20, dropout: 25, grain: 15, misregEnabled: true, misregX: 2, misregY: 1, misregColor: "#00a0e0", misregOpacity: 45 },
  "Siebdruck": { texture: "mesh", scale: 90, intensity: 70, toner: 10, dropout: 30, grain: 10, edgeRoughness: 2.5 },
  "Inkjet billig": { texture: "inkband", intensity: 70, toner: 15, dropout: 25, grain: 20, texture2: "nozzle", texture2Mix: 70, texture2Mode: "add" },
  "Fax": { texture: "fax", intensity: 85, toner: 35, dropout: 30, grain: 35, edgeRoughness: 2 },
  "Kassenbon": { texture: "receipt", intensity: 80, toner: 10, dropout: 40, grain: 25, fadeAmount: 60, fadeStyle: "bottom" },
  "Nadeldrucker": { texture: "dotmatrix", scale: 80, intensity: 80, toner: 15, dropout: 45, grain: 10 },
  "Halftone-Poster": { texture: "halftone", scale: 70, intensity: 80, toner: 15, dropout: 40, grain: 10 },
};

const SLIDERS = [
  { key: "scale", label: "Scale", min: 10, max: 500, step: 1, unit: "%", parent: "secTexture" },
  { key: "rotation", label: "Winkel", min: 0, max: 360, step: 1, unit: "°", parent: "secTexture" },
  { key: "grainSize", label: "Korngröße", min: 0.5, max: 8, step: 0.5, unit: "px", parent: "secTexture" },
  { key: "texture2Mix", label: "Mix", min: 0, max: 100, step: 1, unit: "%", parent: "secTexture2" },
  { key: "texture2Scale", label: "Scale 2", min: 10, max: 500, step: 1, unit: "%", parent: "secTexture2" },
  { key: "intensity", label: "Intensität", min: 0, max: 100, step: 1, unit: "%", parent: "secStrength" },
  { key: "toner", label: "Toner (dunkel)", min: 0, max: 100, step: 1, unit: "%", parent: "secStrength" },
  { key: "dropout", label: "Aussetzer (hell)", min: 0, max: 100, step: 1, unit: "%", parent: "secStrength" },
  { key: "grain", label: "Körnung", min: 0, max: 100, step: 1, unit: "%", parent: "secStrength" },
  { key: "softness", label: "Weichheit", min: 0, max: 100, step: 1, unit: "%", parent: "secStrength" },
  { key: "edgeRoughness", label: "Kantenrauheit", min: 0, max: 40, step: 0.5, unit: "px", parent: "secEdges" },
  { key: "strayAmount", label: "Streu-Toner", min: 0, max: 100, step: 1, unit: "%", parent: "secEdges" },
  { key: "strayDistance", label: "Streu-Abstand", min: 2, max: 150, step: 1, unit: "px", parent: "secEdges" },
  { key: "inkOpacity", label: "Toner-Deckkraft", min: 0, max: 100, step: 1, unit: "%", parent: "secColor" },
  { key: "misregX", label: "Versatz X", min: -40, max: 40, step: 0.5, unit: "px", parent: "secMisreg" },
  { key: "misregY", label: "Versatz Y", min: -40, max: 40, step: 0.5, unit: "px", parent: "secMisreg" },
  { key: "misregOpacity", label: "Deckkraft", min: 0, max: 100, step: 1, unit: "%", parent: "secMisreg" },
  { key: "fadeAmount", label: "Stärke", min: 0, max: 100, step: 1, unit: "%", parent: "secFade" },
];
const COLOR_KEYS = ["inkColor", "paperColor", "misregColor"];

let params = loadParams();
let previewSrc = null;   // { mode, w, h, rgba, alpha, sb, pxScale, avg }
let imageTextures = [];  // [{ id: "img:…", name, w, h, file, data: Uint8Array }]
let busy = false;
let pipeCache = { key: "", pipe: null };
const ctl = {};

function texData(id) {
  if (!id) return null;
  return imageTextures.find((t) => t.id === id) || null;
}
function texLabel(id) {
  const t = Core.NOISES.find((x) => x.id === id) || imageTextures.find((x) => x.id === id);
  return t ? t.name : "";
}

// ---------------------------------------------------------------- Persistenz

function loadParams() {
  try { return Object.assign({}, Core.DEFAULTS, JSON.parse(localStorage.getItem(STORE_KEY) || "{}")); }
  catch (e) { return Object.assign({}, Core.DEFAULTS); }
}
function saveParams() { try { localStorage.setItem(STORE_KEY, JSON.stringify(params)); } catch (e) { /* egal */ } }
function loadUserPresets() { try { return JSON.parse(localStorage.getItem(PRESET_KEY) || "{}"); } catch (e) { return {}; } }
function saveUserPresets(p) { try { localStorage.setItem(PRESET_KEY, JSON.stringify(p)); } catch (e) { /* egal */ } }

// ---------------------------------------------------------------- Helfer

function setStatus(msg, isErr) {
  const el = $("status");
  el.textContent = msg || "";
  el.className = isErr ? "status err" : "status";
}
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || "").trim());
  const n = m ? parseInt(m[1], 16) : 0;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}
function allLayers(list, out) {
  out = out || [];
  for (const l of list) { out.push(l); if (l.layers) allLayers(l.layers, out); }
  return out;
}
// Pixel-Bounds + Puffer für Kantenrauheit, Streu-Toner und Versatz
function layerBounds(layer, doc, p) {
  const a = layer.boundsNoEffects || layer.bounds;
  if (a.right - a.left <= 0 || a.bottom - a.top <= 0) return { left: 0, top: 0, right: 0, bottom: 0 };
  p = p || params;
  const pad = Math.ceil(Math.max(12,
    (p.strayAmount > 0 ? p.strayDistance : 0) + 4,
    p.misregEnabled ? Math.max(Math.abs(p.misregX), Math.abs(p.misregY)) + 4 : 0));
  let left = Math.floor(a.left) - pad, top = Math.floor(a.top) - pad;
  let right = Math.ceil(a.right) + pad, bottom = Math.ceil(a.bottom) + pad;
  if (doc) {
    left = Math.max(0, left); top = Math.max(0, top);
    right = Math.min(Math.round(Number(doc.width)), right);
    bottom = Math.min(Math.round(Number(doc.height)), bottom);
  }
  return { left, top, right, bottom };
}
function docBounds(doc) {
  return { left: 0, top: 0, right: Math.round(Number(doc.width)), bottom: Math.round(Number(doc.height)) };
}
function paramsFor(index) {
  const p = Object.assign({}, params);
  if (p.varySeed && index > 0) p.seed = (p.seed | 0) + index * 7919;
  return p;
}
function debounce(fn, ms) {
  let t = null;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

async function selectLayer(id) {
  await batchPlay([{ _obj: "select", _target: [{ _ref: "layer", _id: id }], makeVisible: false }], {});
}
async function selectLayers(ids) {
  const cmds = ids.map((id, i) => {
    const c = { _obj: "select", _target: [{ _ref: "layer", _id: id }], makeVisible: false };
    if (i > 0) c.selectionModifier = { _enum: "selectionModifierType", _value: "addToSelection" };
    return c;
  });
  if (cmds.length) await batchPlay(cmds, {});
}
async function hasUserMask(id) {
  const r = await batchPlay([{ _obj: "get", _target: [{ _property: "hasUserMask" }, { _ref: "layer", _id: id }] }], {});
  return !!(r && r[0] && r[0].hasUserMask);
}
async function maskEnabled(id) {
  const r = await batchPlay([{ _obj: "get", _target: [{ _property: "userMaskEnabled" }, { _ref: "layer", _id: id }] }], {});
  return !(r && r[0] && r[0].userMaskEnabled === false);
}
async function setMaskEnabled(id, on) {
  await batchPlay([{ _obj: "set", _target: [{ _ref: "layer", _id: id }], to: { _obj: "layer", userMaskEnabled: on } }], {});
}
const TARGET = [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }];
async function makeLayerAbove(doc, targetId, name) {
  await selectLayer(targetId);
  await batchPlay([{ _obj: "make", _target: [{ _ref: "layer" }], using: { _obj: "layer", name } }], {});
  return doc.activeLayers[0];
}
async function setBlendMode(mode) {
  await batchPlay([{ _obj: "set", _target: TARGET, to: { _obj: "layer", mode: { _enum: "blendMode", _value: mode } } }], {});
}
async function putRGBA(doc, layerId, buf, w, h, left, top) {
  const d = await imaging.createImageDataFromBuffer(fromBuf8(buf, doc), {
    width: w, height: h, components: 4, chunky: true, colorSpace: "RGB", colorProfile: "sRGB IEC61966-2.1",
  });
  try {
    await imaging.putPixels({ documentID: doc.id, layerID: layerId, imageData: d, targetBounds: { left, top } });
  } finally {
    d.dispose();
  }
}
function solidRGBA(alpha, rgb) {
  const buf = new Uint8Array(alpha.length * 4);
  for (let i = 0; i < alpha.length; i++) {
    buf[i * 4] = rgb.r; buf[i * 4 + 1] = rgb.g; buf[i * 4 + 2] = rgb.b; buf[i * 4 + 3] = alpha[i];
  }
  return buf;
}
function anyNonZero(a) { for (let i = 0; i < a.length; i++) if (a[i]) return true; return false; }

// ---------------------------------------------------------------- Protokoll

const logLines = [];
let logWriteTimer = null;
function log(msg, data) {
  const line = new Date().toISOString() + " " + msg + (data !== undefined ? " " + JSON.stringify(data) : "");
  logLines.push(line);
  if (logLines.length > 400) logLines.splice(0, logLines.length - 400);
  clearTimeout(logWriteTimer);
  logWriteTimer = setTimeout(async () => {
    try {
      const folder = await lfs.getDataFolder();
      const f = await folder.createFile("printer-log.txt", { overwrite: true });
      await f.write(logLines.join("\n") + "\n");
    } catch (e) { console.log("Log nicht schreibbar", e); }
  }, 300);
}
function effectiveParams(p) {
  const out = {};
  for (const k of Object.keys(Core.DEFAULTS)) if (k !== "varySeed") out[k] = p[k];
  return out;
}
function diffParams(a, b) {
  return Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}
const lastApplied = new Map();

async function readLayerUnmasked(ctx, doc, layer, sourceBounds, targetSize) {
  const opts = { documentID: doc.id, layerID: layer.id, sourceBounds, colorSpace: "RGB", componentSize: 8 };
  if (targetSize) opts.targetSize = targetSize;
  let disabled = false, hid = null;
  if (await hasUserMask(layer.id) && await maskEnabled(layer.id)) {
    if (ctx) hid = await ctx.hostControl.suspendHistory({ documentID: doc.id, name: HIST + " lesen" });
    await setMaskEnabled(layer.id, false);
    disabled = true;
  }
  try {
    return await imaging.getPixels(opts);
  } finally {
    if (disabled) {
      if (hid !== null) await ctx.hostControl.resumeHistory(hid, false);
      else await setMaskEnabled(layer.id, true);
    }
  }
}

function extractAlpha(data, comps, n) {
  const alpha = new Uint8Array(n);
  if (comps === 4 || comps === 2) for (let i = 0; i < n; i++) alpha[i] = data[i * comps + comps - 1];
  else alpha.fill(255);
  return alpha;
}
function to8bit(data, componentSize) {
  if (componentSize === 8) return data;
  const out = new Uint8Array(data.length);
  const f = componentSize === 16 ? 255 / 32768 : 255;
  for (let i = 0; i < data.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(data[i] * f)));
  return out;
}
function fromBuf8(buf, doc) {
  const depth = String(doc.bitsPerChannel || "");
  if (depth.indexOf("16") >= 0) {
    const out = new Uint16Array(buf.length);
    for (let i = 0; i < buf.length; i++) out[i] = Math.round(buf[i] * 32768 / 255);
    return out;
  }
  if (depth.indexOf("32") >= 0) {
    const out = new Float32Array(buf.length);
    for (let i = 0; i < buf.length; i++) out[i] = buf[i] / 255;
    return out;
  }
  return buf;
}
// Durchschnittsfarbe der deckenden Pixel (Farbe für Streu-Toner)
function averageColor(raw, comps, n) {
  let r = 0, g = 0, b = 0, c = 0;
  for (let i = 0; i < n; i++) {
    const a = comps >= 4 ? raw[i * comps + 3] : 255;
    if (a < 200) continue;
    r += raw[i * comps]; g += raw[i * comps + 1]; b += raw[i * comps + 2]; c++;
  }
  return c ? { r: r / c, g: g / c, b: b / c } : { r: 0, g: 0, b: 0 };
}

// ---------------------------------------------------------------- UI aufbauen

function buildSliders() {
  for (const s of SLIDERS) {
    const row = document.createElement("div");
    row.className = "ctl";
    row.innerHTML =
      `<span class="ctl-label">${s.label}</span>` +
      `<sp-slider class="ctl-range" min="${s.min}" max="${s.max}" step="${s.step}"></sp-slider>` +
      `<input class="ctl-num" type="text"><span class="ctl-unit">${s.unit}</span>`;
    $(s.parent).appendChild(row);
    const range = row.querySelector(".ctl-range");
    const num = row.querySelector(".ctl-num");
    ctl[s.key] = { range, num, def: s };
    const onRange = () => {
      params[s.key] = Number(range.value);
      num.value = String(params[s.key]);
      changed();
    };
    range.addEventListener("input", onRange);
    range.addEventListener("change", onRange);
    num.addEventListener("change", () => {
      let v = parseFloat(String(num.value).replace(",", "."));
      if (isNaN(v)) v = params[s.key];
      v = Math.max(s.min, Math.min(s.max, v));
      params[s.key] = v;
      syncUI();
      changed();
    });
  }
}

function buildTextureGrid() {
  const grid = $("texGrid");
  grid.innerHTML = "";
  let group = null;
  const addTile = (t) => {
    const tile = document.createElement("div");
    tile.className = "tile";
    tile.dataset.id = t.id;
    tile.title = t.name;
    tile.innerHTML = t.id === "__add"
      ? `<div class="ph add">+</div><div class="lbl">Bild laden…</div>`
      : `<div class="ph"></div><div class="lbl">${t.name}</div>`;
    tile.addEventListener("click", () => {
      if (t.id === "__add") return importImageTextures();
      params.texture = t.id;
      syncUI();
      changed();
    });
    grid.appendChild(tile);
  };
  for (const n of Core.NOISES) {
    if (n.group !== group) {
      group = n.group;
      const g = document.createElement("div");
      g.className = "grp";
      g.textContent = group;
      grid.appendChild(g);
    }
    addTile(n);
  }
  const g = document.createElement("div");
  g.className = "grp";
  g.textContent = "Eigene Scans";
  grid.appendChild(g);
  for (const t of imageTextures) addTile(t);
  addTile({ id: "__add", name: "Bild laden" });
  renderThumbs();
}

async function renderThumbs() {
  if (!imaging || !imaging.encodeImageData) return;
  const size = 38;
  for (const t of Core.NOISES.concat(imageTextures)) {
    try {
      const g = Core.renderThumb(t.id, size, texData(t.id));
      const rgb = new Uint8Array(size * size * 3);
      for (let i = 0; i < g.length; i++) { rgb[i * 3] = g[i]; rgb[i * 3 + 1] = g[i]; rgb[i * 3 + 2] = g[i]; }
      const src = await encodeRGB(rgb, size, size);
      const tile = document.querySelector(`.tile[data-id="${t.id}"]`);
      if (tile && src) {
        const img = document.createElement("img");
        img.src = src;
        tile.replaceChild(img, tile.firstChild);
      }
    } catch (e) { console.log("Thumb-Fehler", t.id, e); return; }
  }
}

async function encodeRGB(rgb, w, h) {
  const imgData = await imaging.createImageDataFromBuffer(rgb, {
    width: w, height: h, components: 3, chunky: true, colorSpace: "RGB", colorProfile: "sRGB IEC61966-2.1",
  });
  try {
    const b64 = await imaging.encodeImageData({ imageData: imgData, base64: true });
    return "data:image/jpeg;base64," + b64;
  } finally {
    imgData.dispose();
  }
}

function buildSelects() {
  $("fadeStyle").innerHTML = Core.FADE_STYLES.map((f) => `<option value="${f.id}">${f.name}</option>`).join("");
  $("texture2Mode").innerHTML = Core.MIX_MODES.map((f) => `<option value="${f.id}">${f.name}</option>`).join("");
  $("blendMode").innerHTML = Core.BLEND_MODES.map((f) => `<option value="${f.id}">${f.name}</option>`).join("");
  buildTexture2Select();
  rebuildPresetSelect();
}

function buildTexture2Select() {
  let html = `<option value="">– keiner –</option>`;
  html += Core.NOISES.map((t) => `<option value="${t.id}">${t.group}: ${t.name}</option>`).join("");
  if (imageTextures.length) {
    html += `<option value="" disabled>── Eigene Scans ──</option>`;
    html += imageTextures.map((t) => `<option value="${t.id}">🖼 ${t.name}</option>`).join("");
  }
  $("texture2").innerHTML = html;
  $("texture2").value = params.texture2 || "";
}

function rebuildPresetSelect() {
  const user = loadUserPresets();
  let html = `<option value="">– Preset wählen –</option>`;
  for (const n of Object.keys(BUILTIN_PRESETS)) html += `<option value="b:${n}">${n}</option>`;
  const userNames = Object.keys(user);
  if (userNames.length) {
    html += `<option value="" disabled>── Eigene ──</option>`;
    for (const n of userNames) html += `<option value="u:${n}">★ ${n}</option>`;
  }
  $("presetSelect").innerHTML = html;
  $("presetSelect").value = "";
}

function syncUI() {
  for (const key of Object.keys(ctl)) {
    ctl[key].range.value = String(params[key]);
    ctl[key].num.value = String(params[key]);
  }
  document.querySelectorAll(".tile").forEach((el) => {
    el.className = el.dataset.id === params.texture ? "tile active" : "tile";
  });
  $("texName").textContent = "· " + texLabel(params.texture) + (params.texture2 ? " + " + texLabel(params.texture2) : "");
  $("deleteImgTex").className = String(params.texture).startsWith("img:") ? "" : "hidden";
  $("texture2").value = params.texture2 || "";
  $("texture2Mode").value = params.texture2Mode;
  $("texture2Invert").checked = !!params.texture2Invert;
  $("tex2Controls").className = params.texture2 ? "" : "hidden";
  $("invert").checked = !!params.invert;
  $("target").value = params.target;
  $("blendMode").value = params.blendMode;
  $("fadeStyle").value = params.fadeStyle;
  $("misregEnabled").checked = !!params.misregEnabled;
  for (const k of COLOR_KEYS) {
    $("hex-" + k).value = params[k];
    $("swatch-" + k).style.backgroundColor = params[k];
  }
  const doc = params.target === "document";
  $("edgeSection").className = doc ? "section hidden" : "section";
  $("misregSection").className = doc ? "section hidden" : "section";
  $("seed").value = String(params.seed);
  $("varySeed").checked = !!params.varySeed;
  $("apply").textContent = doc ? "Overlay anwenden" : "Druck anwenden";
}

function bindControls() {
  $("invert").addEventListener("change", (e) => { params.invert = e.target.checked; changed(); });
  $("target").addEventListener("change", (e) => {
    params.target = e.target.value; liveLast = null; syncUI(); changed(); refreshPreviewSource();
  });
  $("texture2").addEventListener("change", (e) => { params.texture2 = e.target.value; syncUI(); changed(); });
  $("texture2Mode").addEventListener("change", (e) => { params.texture2Mode = e.target.value; changed(); });
  $("texture2Invert").addEventListener("change", (e) => { params.texture2Invert = e.target.checked; changed(); });
  $("deleteImgTex").addEventListener("click", () => deleteImageTexture(params.texture));
  $("blendMode").addEventListener("change", (e) => { params.blendMode = e.target.value; changed(); });
  $("fadeStyle").addEventListener("change", (e) => { params.fadeStyle = e.target.value; changed(); });
  $("misregEnabled").addEventListener("change", (e) => { params.misregEnabled = e.target.checked; changed(); });
  for (const k of COLOR_KEYS) {
    $("hex-" + k).addEventListener("change", (e) => {
      let v = String(e.target.value).trim();
      if (v[0] !== "#") v = "#" + v;
      if (/^#[0-9a-f]{6}$/i.test(v)) params[k] = v.toLowerCase();
      syncUI(); changed();
    });
    $("swatch-" + k).addEventListener("click", () => pickColor(k));
  }
  $("fg-inkColor").addEventListener("click", () => {
    try { params.inkColor = "#" + app.foregroundColor.rgb.hexValue.toLowerCase(); syncUI(); changed(); }
    catch (e) { setStatus("Vordergrundfarbe nicht lesbar: " + e.message, true); }
  });
  $("seed").addEventListener("change", (e) => {
    const v = parseInt(e.target.value, 10);
    if (!isNaN(v)) params.seed = v;
    syncUI(); changed();
  });
  $("dice").addEventListener("click", () => { params.seed = Math.floor(Math.random() * 99999); syncUI(); changed(); });
  $("varySeed").addEventListener("change", (e) => { params.varySeed = e.target.checked; saveParams(); });
  $("previewDark").addEventListener("change", () => renderPreview());
  $("refreshPreview").addEventListener("click", () => refreshPreviewSource());

  $("presetSelect").addEventListener("change", (e) => {
    const v = e.target.value;
    if (!v) return;
    const src = v.startsWith("b:") ? BUILTIN_PRESETS[v.slice(2)] : loadUserPresets()[v.slice(2)];
    if (!src) return;
    params = Object.assign({}, Core.DEFAULTS, { seed: params.seed, varySeed: params.varySeed, target: params.target }, src);
    syncUI(); changed();
    setStatus(`Preset „${v.slice(2)}“ geladen.`);
  });
  $("presetSave").addEventListener("click", () => {
    const name = String($("presetName").value || "").trim();
    if (!name) return setStatus("Bitte einen Namen für das Preset eingeben.", true);
    const user = loadUserPresets();
    user[name] = Object.assign({}, params);
    saveUserPresets(user);
    rebuildPresetSelect();
    $("presetName").value = "";
    setStatus(`Preset „${name}“ gespeichert.`);
  });
  $("presetDelete").addEventListener("click", () => {
    const v = $("presetSelect").value;
    if (!v.startsWith("u:")) return setStatus("Wähle zuerst ein eigenes Preset (★) aus.", true);
    const user = loadUserPresets();
    delete user[v.slice(2)];
    saveUserPresets(user);
    rebuildPresetSelect();
    setStatus("Preset gelöscht.");
  });
  $("resetAll").addEventListener("click", () => {
    params = Object.assign({}, Core.DEFAULTS, { target: params.target });
    syncUI(); changed();
  });

  $("liveCanvas").addEventListener("change", (e) => {
    liveLast = null;
    if (e.target.checked) applyPrint(true);
    else setStatus("Live aus – der aktuelle Stand bleibt auf dem Canvas.");
  });
  $("apply").addEventListener("click", () => applyPrint(false));
  $("remove").addEventListener("click", removePrint);
  $("verify").addEventListener("click", verifyCanvas);
  $("selfTest").addEventListener("click", runSelfTest);
}

const debouncedPreview = debounce(() => renderPreview(), 60);
function changed() {
  saveParams();
  debouncedPreview();
  if ($("liveCanvas").checked) debouncedLive();
  else showSyncHint();
}

function appliedKey(doc, layerId) { return doc.id + ":" + (params.target === "document" ? "doc" : layerId); }

function showSyncHint() {
  try {
    const doc = app.activeDocument;
    if (!doc) return;
    const layer = doc.activeLayers[0];
    const applied = lastApplied.get(appliedKey(doc, layer && layer.id));
    if (!applied) return;
    const diff = diffParams(effectiveParams(paramsFor(0)), applied);
    if (diff.length) setStatus(`● Noch nicht auf dem Canvas: ${diff.join(", ")} – „Anwenden“ klicken oder Live einschalten.`);
    else setStatus("Canvas entspricht den Einstellungen.");
  } catch (e) { /* egal */ }
}

// ---------------------------------------------------------------- Farbwähler

async function pickColor(key) {
  const c0 = hexToRgb(params[key]);
  try {
    let res;
    await core.executeAsModal(async () => {
      res = await batchPlay([{
        _obj: "showColorPicker", _target: { _ref: "application" }, context: "MS Printer",
        color: { _obj: "RGBColor", red: c0.r, grain: c0.g, blue: c0.b },
      }], {});
    }, { commandName: "Farbe wählen" });
    const c = res && res[0] && (res[0].RGBFloatColor || res[0].color);
    if (c && c.red !== undefined) {
      params[key] = rgbToHex(c.red, c.grain !== undefined ? c.grain : c.green, c.blue);
      if (key === "misregColor") params.misregEnabled = true;
      syncUI(); changed();
    }
  } catch (e) {
    setStatus("Farbwähler nicht verfügbar – Hex-Wert eintippen.", true);
  }
}

// ---------------------------------------------------------------- Vorschau

async function refreshPreviewSource() {
  if (busy) return;
  const doc = app.activeDocument;
  if (!doc) { previewSrc = null; $("layerName").textContent = "–"; return renderPreview("Kein Dokument geöffnet."); }
  const docMode = params.target === "document";
  const layer = doc.activeLayers[0];
  if (!docMode && !layer) { previewSrc = null; $("layerName").textContent = "–"; return renderPreview("Keine Ebene ausgewählt."); }
  $("layerName").textContent = docMode ? "Ganzes Dokument"
    : doc.activeLayers.length > 1 ? `${layer.name} (+${doc.activeLayers.length - 1})` : layer.name;
  const b = docMode ? docBounds(doc) : layerBounds(layer, doc);
  const bw = b.right - b.left, bh = b.bottom - b.top;
  if (bw <= 0 || bh <= 0) { previewSrc = null; return renderPreview("Ebene ist leer."); }
  const f = Math.min(1, 300 / bw, 168 / bh);
  const ts = { width: Math.max(1, Math.round(bw * f)), height: Math.max(1, Math.round(bh * f)) };
  try {
    let src = null;
    await core.executeAsModal(async (ctx) => {
      const res = docMode
        ? await imaging.getPixels({ documentID: doc.id, sourceBounds: b, targetSize: ts, colorSpace: "RGB", componentSize: 8 })
        : await readLayerUnmasked(ctx, doc, layer, b, ts);
      const id = res.imageData;
      const raw = to8bit(await id.getData({ chunky: true }), id.componentSize || 8);
      const n = id.width * id.height, comps = id.components;
      const rgba = new Uint8Array(n * 4);
      for (let i = 0; i < n; i++) {
        rgba[i * 4] = raw[i * comps]; rgba[i * 4 + 1] = raw[i * comps + 1]; rgba[i * 4 + 2] = raw[i * comps + 2];
        rgba[i * 4 + 3] = comps >= 4 ? raw[i * comps + 3] : 255;
      }
      const sb = res.sourceBounds || b;
      const alpha = docMode ? new Uint8Array(n).fill(255) : extractAlpha(raw, comps, n);
      src = { mode: params.target, w: id.width, h: id.height, rgba, alpha, sb, pxScale: (sb.right - sb.left) / id.width, avg: averageColor(raw, comps, n) };
      id.dispose();
    }, { commandName: HIST + " Vorschau" });
    ignoreEventsUntil = Date.now() + 600;
    previewSrc = src;
    renderPreview();
  } catch (e) {
    previewSrc = null;
    renderPreview("Vorschau nicht möglich: " + (e.message || e));
  }
}

function getPipeline(p, bounds) {
  const key = JSON.stringify([p.texture, p.scale, p.rotation, p.invert, p.seed, p.texture2, p.texture2Scale,
    p.texture2Mix, p.texture2Mode, p.texture2Invert, bounds]);
  if (pipeCache.key !== key) pipeCache = { key, pipe: Core.buildPipeline(p, bounds, texData(p.texture), texData(p.texture2)) };
  return pipeCache.pipe;
}

let previewToken = 0;
async function renderPreview(msg) {
  const img = $("preview"), m = $("previewMsg");
  if (msg || !previewSrc) {
    img.className = "hidden"; m.className = "preview-msg";
    m.textContent = msg || "Ebene auswählen…";
    return;
  }
  if (previewSrc.mode !== params.target) return refreshPreviewSource();
  const token = ++previewToken;
  const s = previewSrc;
  const p = paramsFor(0);
  const { sampler, cdf } = getPipeline(p, s.sb);
  const out = Core.computePrint({
    alpha: s.alpha, width: s.w, height: s.h, originX: s.sb.left, originY: s.sb.top,
    pxScale: s.pxScale, bounds: s.sb, params: p, sampler, cdf,
  });
  const rgb = composite(s, out, p, $("previewDark").checked);
  try {
    const src = await encodeRGB(rgb, s.w, s.h);
    if (token !== previewToken) return;
    img.src = src;
    img.className = ""; m.className = "hidden";
  } catch (e) {
    img.className = "hidden"; m.className = "preview-msg";
    m.textContent = "Vorschau benötigt Photoshop 24.2 oder neuer.";
  }
}

// Setzt Ebene + Effekt-Ebenen so zusammen, wie Photoshop sie zeigt (für die Vorschau)
function composite(s, out, p, dark) {
  const c1 = dark ? 34 : 255, c2 = dark ? 44 : 228;
  const ink = hexToRgb(p.inkColor), paper = hexToRgb(p.paperColor), mis = hexToRgb(p.misregColor);
  const inkC = [ink.r, ink.g, ink.b], paperC = [paper.r, paper.g, paper.b], misC = [mis.r, mis.g, mis.b];
  const avgC = [s.avg.r, s.avg.g, s.avg.b];
  const mode = p.blendMode;
  const rgb = new Uint8Array(s.w * s.h * 3);
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      const i = y * s.w + x;
      const bg = ((x >> 3) + (y >> 3)) & 1 ? c2 : c1;
      const docMode = p.target === "document";
      const la = docMode ? s.rgba[i * 4 + 3] / 255 : (s.alpha[i] / 255) * (out.mask[i] / 255);
      const ma = out.misreg ? out.misreg[i] / 255 : 0;
      const ta = out.toner[i] / 255;
      const sa = out.stray ? out.stray[i] / 255 : 0;
      const pa = out.light ? out.light[i] / 255 : 0;
      for (let ch = 0; ch < 3; ch++) {
        let v = bg;
        v = v * (1 - ma) + v * misC[ch] / 255 * ma;               // Versatz (multiplizieren, unten)
        const base = s.rgba[i * 4 + ch];
        v = v * (1 - la) + base * la;                              // Ebene
        if (docMode) {
          v = v * (1 - ta) + inkC[ch] * ta;                        // Overlay: Toner …
          v = v * (1 - pa) + paperC[ch] * pa;                      // … und Papier
        } else {
          const tk = ta * out.mask[i] / 255; // geclippt: Toner-Deckkraft × Ebenenmaske (Alpha steckt schon in ta)
          let blended;
          if (mode === "normal") blended = inkC[ch];
          else if (mode === "linearBurn") blended = Math.max(0, v + inkC[ch] - 255);
          else if (mode === "darken") blended = Math.min(v, inkC[ch]);
          else if (mode === "colorBurn") blended = inkC[ch] <= 0 ? 0 : Math.max(0, 255 - (255 - v) * 255 / inkC[ch]);
          else blended = v * inkC[ch] / 255;                       // multiply (+ overlay/softLight näherungsweise)
          v = v * (1 - tk) + blended * tk;
          v = v * (1 - sa) + avgC[ch] * sa;                        // Streu-Toner
        }
        rgb[i * 3 + ch] = v;
      }
    }
  }
  return rgb;
}

// ---------------------------------------------------------------- Bild-Texturen (eigene Scans)

const TEX_MAX = 2048;

async function texFolder() {
  const data = await lfs.getDataFolder();
  try { return await data.getEntry("textures"); } catch (e) { return await data.createFolder("textures"); }
}
async function saveTextureIndex() {
  const folder = await texFolder();
  const f = await folder.createFile("index.json", { overwrite: true });
  await f.write(JSON.stringify(imageTextures.map(({ id, name, w, h, file }) => ({ id, name, w, h, file }))));
}
async function loadImageTextures() {
  try {
    const folder = await texFolder();
    let index = [];
    try { index = JSON.parse(await (await folder.getEntry("index.json")).read()); } catch (e) { index = []; }
    for (const t of index) {
      try {
        const buf = await (await folder.getEntry(t.file)).read({ format: uxpStorage.formats.binary });
        imageTextures.push(Object.assign({}, t, { data: new Uint8Array(buf) }));
      } catch (e) { console.log("Textur fehlt", t.file); }
    }
  } catch (e) { console.log("Textur-Bibliothek nicht lesbar", e); }
}

async function importImageTextures() {
  if (busy) return;
  let files;
  try {
    files = await lfs.getFileForOpening({ allowMultiple: true, types: ["png", "jpg", "jpeg", "tif", "tiff", "psd", "webp", "bmp", "gif"] });
  } catch (e) { return setStatus("Dateiauswahl nicht möglich: " + (e.message || e), true); }
  const list = !files ? [] : Array.isArray(files) ? files : [files];
  if (!list.length) return;
  busy = true;
  setStatus(`Importiere ${list.length} Scan(s)…`);
  const added = [];
  const prevDoc = app.activeDocument;
  try {
    const folder = await texFolder();
    for (const file of list) {
      let tex = null;
      await core.executeAsModal(async () => {
        const d = await app.open(file);
        try {
          const W = Number(d.width), H = Number(d.height);
          const f = Math.min(1, TEX_MAX / Math.max(W, H));
          const res = await imaging.getPixels({
            documentID: d.id, colorSpace: "RGB", componentSize: 8,
            targetSize: { width: Math.max(1, Math.round(W * f)), height: Math.max(1, Math.round(H * f)) },
          });
          const id = res.imageData;
          const raw = to8bit(await id.getData({ chunky: true }), id.componentSize || 8);
          const n = id.width * id.height, comps = id.components;
          const data = new Uint8Array(n);
          for (let i = 0; i < n; i++) {
            const a = comps >= 4 ? raw[i * comps + 3] / 255 : 1;
            const lum = (0.299 * raw[i * comps] + 0.587 * raw[i * comps + 1] + 0.114 * raw[i * comps + 2]) * a + 255 * (1 - a);
            data[i] = 255 - Math.round(lum); // 255 = dunkel (Toner)
          }
          tex = { w: id.width, h: id.height, data };
          id.dispose();
        } finally {
          await d.closeWithoutSaving();
          if (prevDoc) { try { app.activeDocument = prevDoc; } catch (e) { /* egal */ } }
        }
      }, { commandName: HIST + " Scan importieren" });
      if (!tex) continue;
      const id = "img:" + Date.now().toString(36) + Math.floor(Math.random() * 1e5).toString(36);
      const fileName = id.slice(4) + ".bin";
      const fe = await folder.createFile(fileName, { overwrite: true });
      await fe.write(tex.data.buffer, { format: uxpStorage.formats.binary });
      const t = { id, name: file.name.replace(/\.[^.]+$/, ""), w: tex.w, h: tex.h, file: fileName, data: tex.data };
      imageTextures.push(t);
      added.push(t);
    }
    await saveTextureIndex();
  } catch (e) {
    setStatus("Import fehlgeschlagen: " + (e.message || e), true);
  }
  busy = false;
  if (added.length) {
    params.texture = added[added.length - 1].id;
    buildTextureGrid(); buildTexture2Select(); syncUI(); changed();
    setStatus(`${added.length} Scan(s) hinzugefügt.`);
  }
}

async function deleteImageTexture(id) {
  const t = imageTextures.find((x) => x.id === id);
  if (!t) return;
  imageTextures = imageTextures.filter((x) => x.id !== id);
  try { await (await (await texFolder()).getEntry(t.file)).delete(); } catch (e) { /* egal */ }
  await saveTextureIndex();
  if (params.texture === id) params.texture = "toner";
  if (params.texture2 === id) params.texture2 = "";
  buildTextureGrid(); buildTexture2Select(); syncUI(); changed();
  setStatus(`Scan „${t.name}“ gelöscht.`);
}

// ---------------------------------------------------------------- Anwenden / Entfernen

async function deleteGenerated(doc, layer) {
  const names = Object.values(SUFFIX).map((s) => layer.name + s);
  for (const l of allLayers(doc.layers).filter((x) => names.indexOf(x.name) >= 0)) await l.delete();
}

async function applyToLayer(doc, layer, p) {
  if (layer.isBackgroundLayer) throw new Error("Hintergrundebene – bitte erst in normale Ebene umwandeln oder Ziel „Ganzes Dokument“ nutzen");
  if (layer.allLocked) throw new Error("Ebene ist gesperrt");
  const b = layerBounds(layer, doc, p);
  if (b.right - b.left <= 0 || b.bottom - b.top <= 0) throw new Error("Ebene ist leer");

  await deleteGenerated(doc, layer);
  await selectLayer(layer.id);
  const hadMask = await hasUserMask(layer.id);
  if (hadMask && await maskEnabled(layer.id)) await setMaskEnabled(layer.id, false);
  const res = await imaging.getPixels({ documentID: doc.id, layerID: layer.id, sourceBounds: b, colorSpace: "RGB", componentSize: 8 });
  if (hadMask) await setMaskEnabled(layer.id, true);
  const id = res.imageData;
  const w = id.width, h = id.height, comps = id.components;
  const raw = to8bit(await id.getData({ chunky: true }), id.componentSize || 8);
  const alpha = extractAlpha(raw, comps, w * h);
  const avg = averageColor(raw, comps, w * h);
  id.dispose();
  const sb = res.sourceBounds || b;

  const { sampler, cdf } = Core.buildPipeline(p, sb, texData(p.texture), texData(p.texture2));
  const out = Core.computePrint({ alpha, width: w, height: h, originX: sb.left, originY: sb.top, pxScale: 1, bounds: sb, params: p, sampler, cdf });

  // Aussetzer -> Ebenenmaske
  if (!hadMask) {
    await batchPlay([{
      _obj: "make", new: { _class: "channel" },
      at: { _ref: "channel", _enum: "channel", _value: "mask" },
      using: { _enum: "userMaskEnabled", _value: "revealAll" },
    }], {});
  }
  const maskData = await imaging.createImageDataFromBuffer(fromBuf8(out.mask, doc), {
    width: w, height: h, components: 1, chunky: true, colorSpace: "Grayscale", colorProfile: "Gray Gamma 2.2",
  });
  try {
    await imaging.putLayerMask({ documentID: doc.id, layerID: layer.id, imageData: maskData, targetBounds: { left: sb.left, top: sb.top }, replace: false });
  } finally {
    maskData.dispose();
  }

  // Reihenfolge (oben -> unten): Streutoner, Toner (geclippt), Ebene, Versatz
  const made = {};
  if (out.misreg && anyNonZero(out.misreg)) {
    const l = await makeLayerAbove(doc, layer.id, layer.name + SUFFIX.misreg);
    await putRGBA(doc, l.id, solidRGBA(out.misreg, hexToRgb(p.misregColor)), w, h, sb.left, sb.top);
    await setBlendMode("multiply");
    await batchPlay([{ _obj: "move", _target: TARGET, to: { _ref: "layer", _enum: "ordinal", _value: "previous" } }], {});
    made.misreg = true;
  }
  if (out.stray && anyNonZero(out.stray)) {
    const l = await makeLayerAbove(doc, layer.id, layer.name + SUFFIX.stray);
    await putRGBA(doc, l.id, solidRGBA(out.stray, avg), w, h, sb.left, sb.top);
    made.stray = true;
  }
  if (anyNonZero(out.toner)) {
    const l = await makeLayerAbove(doc, layer.id, layer.name + SUFFIX.toner);
    await putRGBA(doc, l.id, solidRGBA(out.toner, hexToRgb(p.inkColor)), w, h, sb.left, sb.top);
    await batchPlay([{ _obj: "groupEvent", _target: TARGET }], {});
    await setBlendMode(p.blendMode);
    made.toner = true;
  }

  let dropped = 0, tonered = 0, opaque = 0;
  for (let i = 0; i < w * h; i++) if (alpha[i] > 0) { opaque++; if (out.mask[i] < 128) dropped++; if (out.toner[i] > 64) tonered++; }
  log("  Ebene", { name: layer.name, id: layer.id, bounds: sb, aussetzerProzent: opaque ? Math.round(dropped / opaque * 100) : 0,
    tonerProzent: opaque ? Math.round(tonered / opaque * 100) : 0, ebenen: made });
  lastApplied.set(doc.id + ":" + layer.id, effectiveParams(p));
}

async function applyDocument(doc, p) {
  const b = docBounds(doc);
  const w = b.right, h = b.bottom;
  for (const l of allLayers(doc.layers).filter((x) => x.name === OVERLAY_NAME)) await l.delete();
  const alpha = new Uint8Array(w * h).fill(255);
  const { sampler, cdf } = Core.buildPipeline(p, b, texData(p.texture), texData(p.texture2));
  const out = Core.computePrint({ alpha, width: w, height: h, originX: 0, originY: 0, pxScale: 1, bounds: b, params: p, sampler, cdf });
  const ink = hexToRgb(p.inkColor), paper = hexToRgb(p.paperColor);
  const buf = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const t = out.toner[i], l = out.light[i];
    const c = t >= l ? ink : paper;
    buf[i * 4] = c.r; buf[i * 4 + 1] = c.g; buf[i * 4 + 2] = c.b; buf[i * 4 + 3] = Math.max(t, l);
  }
  // Ganz oben anlegen
  const top = doc.layers[0];
  if (top) await selectLayer(top.id);
  await batchPlay([{ _obj: "make", _target: [{ _ref: "layer" }], using: { _obj: "layer", name: OVERLAY_NAME } }], {});
  const ol = doc.activeLayers[0];
  await putRGBA(doc, ol.id, buf, w, h, 0, 0);
  log("  Overlay", { breite: w, hoehe: h });
  lastApplied.set(doc.id + ":doc", effectiveParams(p));
}

let liveLast = null;
let livePending = false;
function historyStateId(doc) {
  try { return doc.activeHistoryState ? doc.activeHistoryState.id : null; } catch (e) { return null; }
}

async function applyPrint(live) {
  live = live === true;
  if (busy) { if (live) livePending = true; return; }
  const doc = app.activeDocument;
  if (!doc) return setStatus("Kein Dokument geöffnet.", true);
  const docMode = params.target === "document";
  const layers = docMode ? [] : doc.activeLayers.slice();
  if (!docMode && !layers.length) return setStatus("Keine Ebene ausgewählt.", true);
  busy = true;
  setStatus(live ? "Live-Update…" : docMode ? "Erzeuge Overlay…" : `Wende an auf ${layers.length} Ebene(n)…`);
  const ids = layers.map((l) => l.id);
  const key = docMode ? "doc" : ids.join(",");
  const errors = [];
  let ok = 0;
  const t0 = Date.now();
  const replaceLast = live && liveLast && liveLast.docId === doc.id &&
    liveLast.stateId !== null && liveLast.stateId === historyStateId(doc) && liveLast.key === key;
  log(live ? "LIVE" : "ANWENDEN", { ziel: docMode ? "Dokument" : layers.map((l) => l.name), ersetztLetztenSchritt: !!replaceLast, params: effectiveParams(params) });
  try {
    await core.executeAsModal(async (ctx) => {
      if (replaceLast) {
        await batchPlay([{ _obj: "select", _target: [{ _ref: "historyState", _enum: "ordinal", _value: "previous" }] }], {});
      }
      const hid = await ctx.hostControl.suspendHistory({ documentID: doc.id, name: live ? HIST + " Live" : HIST });
      try {
        if (docMode) {
          try { await applyDocument(doc, paramsFor(0)); ok++; } catch (e) { errors.push("Dokument: " + (e.message || e)); }
        } else {
          for (let i = 0; i < layers.length; i++) {
            try { await applyToLayer(doc, layers[i], paramsFor(i)); ok++; }
            catch (e) { errors.push(`${layers[i].name}: ${e.message || e}`); }
          }
          await selectLayers(ids);
        }
      } finally {
        await ctx.hostControl.resumeHistory(hid);
      }
    }, { commandName: HIST + " anwenden" });
  } catch (e) {
    errors.push(e.message || String(e));
  }
  liveLast = live && ok > 0 ? { docId: doc.id, stateId: historyStateId(doc), key } : null;
  log("  Ergebnis", { ok, fehler: errors, ms: Date.now() - t0 });
  ignoreEventsUntil = Date.now() + 600;
  busy = false;
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (errors.length) setStatus(`${ok} ok, ${errors.length} Fehler – ${errors.join(" | ")}`, true);
  else if (live) setStatus(`Live aktualisiert (${secs}s).`);
  else setStatus(`Fertig in ${secs}s. Rückgängig mit ⌘Z.`);
  if (livePending && $("liveCanvas").checked) {
    livePending = false;
    applyPrint(true);
  }
}
const debouncedLive = debounce(() => applyPrint(true), 220);

async function removePrint() {
  if (busy) return;
  const doc = app.activeDocument;
  if (!doc) return setStatus("Kein Dokument geöffnet.", true);
  const docMode = params.target === "document";
  const layers = doc.activeLayers.slice();
  if (!docMode && !layers.length) return setStatus("Keine Ebene ausgewählt.", true);
  const ids = layers.map((l) => l.id);
  busy = true;
  try {
    await core.executeAsModal(async (ctx) => {
      const hid = await ctx.hostControl.suspendHistory({ documentID: doc.id, name: HIST + " entfernen" });
      try {
        if (docMode) {
          for (const l of allLayers(doc.layers).filter((x) => x.name === OVERLAY_NAME)) await l.delete();
        } else {
          for (const layer of layers) {
            await deleteGenerated(doc, layer);
            if (await hasUserMask(layer.id)) {
              await selectLayer(layer.id);
              await batchPlay([{ _obj: "delete", _target: [{ _ref: "channel", _enum: "channel", _value: "mask" }] }], {});
            }
          }
          await selectLayers(ids);
        }
      } finally {
        await ctx.hostControl.resumeHistory(hid);
      }
    }, { commandName: HIST + " entfernen" });
    if (docMode) lastApplied.delete(doc.id + ":doc");
    for (const id of ids) lastApplied.delete(doc.id + ":" + id);
    log("ENTFERNEN", { ziel: docMode ? "Dokument" : layers.map((l) => l.name) });
    setStatus(docMode ? "Overlay-Ebene entfernt." : "Maske(n) und Druck-Ebenen entfernt.");
  } catch (e) {
    setStatus("Fehler beim Entfernen: " + (e.message || e), true);
  }
  busy = false;
}

// ---------------------------------------------------------------- Prüfen
// Vergleicht Maske und Toner-Ebene in Photoshop mit dem Sollwert für die aktuellen Einstellungen.

async function readAlphaOf(doc, layerId, sb, w, h) {
  const r = await imaging.getPixels({ documentID: doc.id, layerID: layerId, sourceBounds: sb, colorSpace: "RGB", componentSize: 8 });
  const d = r.imageData;
  const raw = to8bit(await d.getData({ chunky: true }), d.componentSize || 8);
  const rb = r.sourceBounds || sb;
  const a = extractAlpha(raw, d.components, d.width * d.height);
  const out = new Uint8Array(w * h);
  // in das Soll-Raster einsortieren (getPixels liefert nur den nicht-leeren Bereich)
  for (let y = 0; y < d.height; y++) for (let x = 0; x < d.width; x++) {
    const tx = rb.left - sb.left + x, ty = rb.top - sb.top + y;
    if (tx >= 0 && ty >= 0 && tx < w && ty < h) out[ty * w + tx] = a[y * d.width + x];
  }
  d.dispose();
  return out;
}
function compare(exp, act, alpha) {
  let big = 0, n = 0;
  for (let i = 0; i < exp.length; i++) {
    if (alpha && alpha[i] < 128) continue;
    n++;
    if (Math.abs(exp[i] - act[i]) > 100) big++;
  }
  return n ? Math.round(big / n * 1000) / 10 : 0;
}

async function verifyLayer(ctx, doc, layer, p) {
  const r = { ebene: layer.name };
  const b = layerBounds(layer, doc, p);
  if (b.right - b.left <= 0 || b.bottom - b.top <= 0) { r.fehler = "leer"; return r; }
  const px = await readLayerUnmasked(ctx, doc, layer, b);
  const pd = px.imageData;
  const raw = to8bit(await pd.getData({ chunky: true }), pd.componentSize || 8);
  const alpha = extractAlpha(raw, pd.components, pd.width * pd.height);
  const sb = px.sourceBounds || b;
  const w = pd.width, h = pd.height;
  pd.dispose();
  const { sampler, cdf } = Core.buildPipeline(p, sb, texData(p.texture), texData(p.texture2));
  const exp = Core.computePrint({ alpha, width: w, height: h, originX: sb.left, originY: sb.top, pxScale: 1, bounds: sb, params: p, sampler, cdf });
  const all = allLayers(doc.layers);
  const find = (suffix) => all.filter((l) => l.name === layer.name + suffix);
  const want = { toner: anyNonZero(exp.toner), stray: !!(exp.stray && anyNonZero(exp.stray)), misreg: !!(exp.misreg && anyNonZero(exp.misreg)) };
  r.ebenen = {};
  for (const k of Object.keys(SUFFIX)) {
    const n = find(SUFFIX[k]).length;
    r.ebenen[k] = n;
    if ((n > 0) !== want[k] || n > 1) r.fehler = (r.fehler ? r.fehler + ", " : "") + `${k}-Ebene ${n ? "zu viel" : "fehlt"}`;
  }
  if (!(await hasUserMask(layer.id))) { r.fehler = (r.fehler ? r.fehler + ", " : "") + "keine Maske"; return r; }
  const mr = await imaging.getLayerMask({ documentID: doc.id, layerID: layer.id, kind: "user", sourceBounds: sb, targetSize: { width: w, height: h } });
  const md = mr.imageData;
  const mraw = to8bit(await md.getData({ chunky: true }), md.componentSize || 8);
  md.dispose();
  r.maskeAbweichung = compare(exp.mask, mraw, alpha);
  const tl = find(SUFFIX.toner)[0];
  if (tl) r.tonerAbweichung = compare(exp.toner, await readAlphaOf(doc, tl.id, sb, w, h), alpha);
  // Versatz liegt direkt unter, Toner direkt über der Ebene?
  const siblings = (layer.parent ? layer.parent.layers : doc.layers);
  const idx = siblings.findIndex((l) => l.id === layer.id);
  if (tl && !(idx > 0 && siblings[idx - 1].id === tl.id)) r.fehler = (r.fehler ? r.fehler + ", " : "") + "Toner-Ebene nicht direkt darüber";
  const ml = find(SUFFIX.misreg)[0];
  if (ml && !(siblings[idx + 1] && siblings[idx + 1].id === ml.id)) r.fehler = (r.fehler ? r.fehler + ", " : "") + "Versatz-Ebene nicht direkt darunter";
  r.ok = !r.fehler && r.maskeAbweichung <= 1 && (r.tonerAbweichung === undefined || r.tonerAbweichung <= 1);
  return r;
}

async function verifyDocument(doc, p) {
  const r = { ebene: OVERLAY_NAME };
  const ols = allLayers(doc.layers).filter((x) => x.name === OVERLAY_NAME);
  r.anzahl = ols.length;
  if (ols.length !== 1) { r.fehler = ols.length ? "mehrere Overlays" : "Overlay fehlt"; return r; }
  if (doc.layers[0].id !== ols[0].id) r.fehler = "Overlay nicht ganz oben";
  const b = docBounds(doc);
  const w = b.right, h = b.bottom;
  const { sampler, cdf } = Core.buildPipeline(p, b, texData(p.texture), texData(p.texture2));
  const exp = Core.computePrint({ alpha: new Uint8Array(w * h).fill(255), width: w, height: h, originX: 0, originY: 0, pxScale: 1, bounds: b, params: p, sampler, cdf });
  const e = new Uint8Array(w * h);
  for (let i = 0; i < e.length; i++) e[i] = Math.max(exp.toner[i], exp.light[i]);
  r.abweichung = compare(e, await readAlphaOf(doc, ols[0].id, b, w, h), null);
  r.ok = !r.fehler && r.abweichung <= 1;
  return r;
}

async function verifyAllNow(doc, layers, docMode) {
  const out = [];
  await core.executeAsModal(async (ctx) => {
    if (docMode) out.push(await verifyDocument(doc, paramsFor(0)));
    else for (let i = 0; i < layers.length; i++) out.push(await verifyLayer(ctx, doc, layers[i], paramsFor(i)));
  }, { commandName: HIST + " prüfen" });
  return out;
}

async function verifyCanvas() {
  if (busy) return;
  const doc = app.activeDocument;
  if (!doc) return setStatus("Kein Dokument geöffnet.", true);
  const docMode = params.target === "document";
  const layers = doc.activeLayers.slice();
  if (!docMode && !layers.length) return setStatus("Keine Ebene ausgewählt.", true);
  busy = true;
  let report = [];
  try { report = await verifyAllNow(doc, layers, docMode); }
  catch (e) { report.push({ fehler: e.message || String(e) }); }
  busy = false;
  ignoreEventsUntil = Date.now() + 600;
  log("PRÜFEN", report);
  const bad = report.filter((r) => !r.ok);
  if (!bad.length) setStatus("✓ Canvas entspricht den aktuellen Einstellungen.");
  else setStatus("✗ " + bad.map((r) => `${r.ebene || ""}: ${r.fehler || ""} ${r.maskeAbweichung !== undefined ? "Maske " + r.maskeAbweichung + "%" : ""} ${r.tonerAbweichung !== undefined ? "Toner " + r.tonerAbweichung + "%" : ""}${r.abweichung !== undefined ? r.abweichung + "% anders" : ""}`).join(" | ") + " (Details im Log)", true);
}

// ---------------------------------------------------------------- Selbsttest

function testShapePixels(w, h) {
  const buf = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const inBar = x >= 40 && x < 360 && y >= 40 && y < 190;
    const dx = x - 520, dy = y - 115, d = Math.sqrt(dx * dx + dy * dy);
    const i = (y * w + x) * 4;
    if (inBar) { buf[i] = 210; buf[i + 1] = 40; buf[i + 2] = 60; buf[i + 3] = 255; }
    else if (d < 85) { buf[i] = 30; buf[i + 1] = 70; buf[i + 2] = 190; buf[i + 3] = Math.round(255 * Math.min(1, 85 - d)); }
  }
  return buf;
}

async function runSelfTest() {
  if (busy) return;
  const saved = Object.assign({}, params);
  const wasLive = $("liveCanvas").checked;
  $("liveCanvas").checked = false;
  const results = [];
  const t0 = Date.now();
  let doc = null;
  log("SELBSTTEST START");
  setStatus("Selbsttest läuft… (ca. 2 Minuten, bitte nichts anklicken)");
  try {
    await core.executeAsModal(async () => {
      doc = await app.documents.add({ width: 680, height: 400, resolution: 72, mode: "RGBColorMode", fill: "white", name: "MS Printer Selbsttest" });
      await batchPlay([{ _obj: "make", _target: [{ _ref: "layer" }], using: { _obj: "layer", name: "Test Pixel" } }], {});
      const pl = doc.activeLayers[0];
      const W = 680, H = 230;
      const id = await imaging.createImageDataFromBuffer(testShapePixels(W, H), { width: W, height: H, components: 4, chunky: true, colorSpace: "RGB", colorProfile: "sRGB IEC61966-2.1" });
      await imaging.putPixels({ documentID: doc.id, layerID: pl.id, imageData: id, targetBounds: { left: 0, top: 0 } });
      id.dispose();
      try {
        await batchPlay([{
          _obj: "make", _target: [{ _ref: "textLayer" }],
          using: {
            _obj: "textLayer", textKey: "PRINT",
            textClickPoint: { _obj: "paint", horizontal: { _unit: "percentUnit", _value: 5 }, vertical: { _unit: "percentUnit", _value: 93 } },
            textStyleRange: [{ _obj: "textStyleRange", from: 0, to: 5, textStyle: { _obj: "textStyle", size: { _unit: "pointsUnit", _value: 130 }, color: { _obj: "RGBColor", red: 20, grain: 20, blue: 20 } } }],
          },
        }], {});
      } catch (e) { log("  Textebene nicht erstellbar", String(e.message || e)); }
    }, { commandName: HIST + " Selbsttest vorbereiten" });

    const layers = allLayers(doc.layers).filter((l) => !l.isBackgroundLayer);
    const ids = layers.map((l) => l.id);
    const D = Object.assign({}, Core.DEFAULTS, { seed: 4242, varySeed: false, target: "layers" });
    const cases = [];
    for (const n of Core.NOISES) cases.push([`Druckfehler ${n.id}`, { texture: n.id }]);
    for (const m of Core.MIX_MODES) cases.push([`2. Druckfehler ${m.id}`, { texture: "toner", texture2: "drumstreaks", texture2Mix: 70, texture2Mode: m.id }]);
    for (const f of Core.FADE_STYLES) cases.push([`Verlauf ${f.id}`, { fadeAmount: 80, fadeStyle: f.id }]);
    for (const bm of Core.BLEND_MODES) cases.push([`Mischmodus ${bm.id}`, { blendMode: bm.id }]);
    cases.push(["Tauschen", { invert: true }]);
    cases.push(["Winkel 30", { rotation: 30 }]);
    cases.push(["Korngröße 4", { grainSize: 4, grain: 60 }]);
    cases.push(["Nur Aussetzer", { toner: 0, grain: 0, dropout: 50 }]);
    cases.push(["Intensität 0", { intensity: 0, edgeRoughness: 0 }]);
    cases.push(["Alles 100", { intensity: 100, toner: 100, dropout: 0, grain: 100 }]);
    cases.push(["Streu-Toner AN", { strayAmount: 80, strayDistance: 30 }]);
    cases.push(["Versatz AN", { misregEnabled: true, misregX: 6, misregY: -3 }]);
    cases.push(["Streu + Versatz", { strayAmount: 60, misregEnabled: true }]);
    cases.push(["Streu + Versatz wieder AUS", { strayAmount: 0, misregEnabled: false }]);
    cases.push(["2. Druckfehler wieder AUS", { texture2: "" }]);

    for (const [name, over] of cases) {
      params = Object.assign({}, D, over);
      await selectLayersModal(ids);
      await applyPrint(false);
      const r = await verifyAllNow(doc, layers, false);
      results.push({ test: name, ok: r.every((x) => x.ok), details: r });
      setStatus(`Selbsttest: ${results.length}/${cases.length + 7} – ${name}`);
    }

    // Live-Modus
    params = Object.assign({}, D, { texture: "riso" });
    await selectLayersModal(ids);
    liveLast = null;
    const s0 = historyStateId(doc);
    await applyPrint(true);
    params = Object.assign({}, D, { texture: "fax", misregEnabled: true });
    await applyPrint(true);
    params = Object.assign({}, D, { texture: "halftone", misregEnabled: false });
    await applyPrint(true);
    const states = doc.historyStates;
    const ai = states.findIndex((st) => st.id === historyStateId(doc));
    const before = ai > 0 ? states[ai - 1].id : null;
    results.push({ test: "Live: Protokoll zusammengefasst", ok: before === s0 && states[ai].name === HIST + " Live", details: { s0, before } });
    const rl = await verifyAllNow(doc, layers, false);
    results.push({ test: "Live: Canvas = letzte Einstellung", ok: rl.every((x) => x.ok), details: rl });

    // Rückgängig
    await core.executeAsModal(async () => {
      await batchPlay([{ _obj: "select", _target: [{ _ref: "historyState", _enum: "ordinal", _value: "previous" }] }], {});
    }, { commandName: HIST + " Test" });
    liveLast = null;
    params = Object.assign({}, D, { texture2: "" });
    const ru = await verifyAllNow(doc, layers, false);
    results.push({ test: "Rückgängig stellt vorherigen Stand her", ok: ru.every((x) => x.ok), details: ru });

    // Entfernen (Ebenen)
    await selectLayersModal(ids);
    await removePrint();
    let removedOk = true;
    await core.executeAsModal(async () => {
      for (const l of layers) {
        if (await hasUserMask(l.id)) removedOk = false;
        for (const s of Object.values(SUFFIX)) if (allLayers(doc.layers).some((x) => x.name === l.name + s)) removedOk = false;
      }
    }, { commandName: HIST + " Test" });
    results.push({ test: "Entfernen (Ebenen)", ok: removedOk });

    // Dokument-Modus
    params = Object.assign({}, D, { target: "document", texture: "copy3" });
    await applyPrint(false);
    params = Object.assign({}, D, { target: "document", texture: "newsprint", paperColor: "#f4ecd8" });
    await applyPrint(false);
    const rd = await verifyAllNow(doc, layers, true);
    results.push({ test: "Dokument: Overlay ersetzt, ganz oben, korrekt", ok: rd.every((x) => x.ok), details: rd });
    await removePrint();
    results.push({ test: "Entfernen (Dokument)", ok: !allLayers(doc.layers).some((x) => x.name === OVERLAY_NAME) });
  } catch (e) {
    results.push({ test: "Abbruch", ok: false, details: String(e && e.stack || e) });
  }
  params = saved;
  $("liveCanvas").checked = wasLive;
  syncUI();
  const failed = results.filter((r) => !r.ok);
  log("SELBSTTEST ERGEBNIS", { bestanden: results.length - failed.length, gesamt: results.length, sekunden: Math.round((Date.now() - t0) / 1000) });
  for (const r of results) log((r.ok ? "  ✓ " : "  ✗ ") + r.test, r.ok ? undefined : r.details);
  setStatus(`Selbsttest: ${results.length - failed.length}/${results.length} bestanden` +
    (failed.length ? ` – fehlgeschlagen: ${failed.map((r) => r.test).join(", ")}` : " ✓"), failed.length > 0);
  refreshPreviewSource();
}

async function selectLayersModal(ids) {
  await core.executeAsModal(async () => { await selectLayers(ids); }, { commandName: HIST + " Test" });
}

// ---------------------------------------------------------------- Start

let ignoreEventsUntil = 0;
const onPsEvent = debounce(() => {
  if (busy || Date.now() < ignoreEventsUntil) return;
  refreshPreviewSource();
}, 350);

// Menüpunkt Zusatzmodule › MS Printer › Selbsttest ausführen
try {
  require("uxp").entrypoints.setup({
    panels: { printerPanel: { show() { /* Inhalt kommt aus index.html */ } } },
    commands: { selfTest: { run() { return runSelfTest(); } } },
  });
} catch (e) { console.log("Einstiegspunkte nicht registrierbar", e); }

async function init() {
  log("START", { ps: app.version });
  await loadImageTextures();
  if (String(params.texture).startsWith("img:") && !texData(params.texture)) params.texture = "toner";
  if (String(params.texture2).startsWith("img:") && !texData(params.texture2)) params.texture2 = "";
  buildSliders();
  buildSelects();
  buildTextureGrid();
  bindControls();
  syncUI();
  try {
    action.addNotificationListener(["select", "make", "delete", "open", "close", "set", "move", "transform", "placedLayerEditContents"], onPsEvent);
  } catch (e) { console.log("Event-Listener nicht verfügbar", e); }
  refreshPreviewSource();
}

init();
