"use strict";
// MS Printer – Photoshop-UXP-Panel.
// Lässt das GANZE Dokument aussehen wie gedruckt: legt oben eine Gruppe „MS Printer“ mit echten
// Textur-Ebenen an (Toner, Aussetzer, Papierstruktur, Papierton) – prozedural und auf das Dokument
// abgestimmt (Toner-Schmutz auf Papier, Aussetzer nur im Druck).

const { app, core, action, imaging } = require("photoshop");
const { batchPlay } = action;
const Core = require("./core.js");
const UI = require("./ms-ui.js");
const uxpStorage = require("uxp").storage;
const lfs = uxpStorage.localFileSystem;

const $ = (id) => document.getElementById(id);
const STORE_KEY = "msprinter.state.v2";
const PRESET_KEY = "msprinter.presets.v2";
const GROUP_NAME = "MS Printer";
const L = { dropout: "Aussetzer", toner: "Toner", paper: "Papierstruktur", tone: "Papierton" };
const HIST = "MS Printer";

const BUILTIN_PRESETS = {
  "Fotokopie": { texture: "copygrain", toner: 25, dropout: 18, grain: 30, paperDirt: 45, paperGrain: 25 },
  "Fotokopie – 3. Generation": { texture: "copy3", scale: 120, toner: 38, dropout: 30, grain: 50, paperDirt: 70, paperGrain: 35, softness: 8 },
  "Fotokopie – kaputt": { texture: "copy5", scale: 140, toner: 45, dropout: 40, grain: 60, paperDirt: 90, texture2: "glassdust", texture2Mix: 60, texture2Mode: "add" },
  "Laserdrucker – Toner leer": { texture: "lowtoner", scale: 120, toner: 6, dropout: 45, grain: 30, paperDirt: 10, softness: 20 },
  "Laserdrucker – Streifen": { texture: "drumstreaks", toner: 30, dropout: 15, grain: 20, paperDirt: 60 },
  "Riso – Fleckig": { texture: "risomottle", scale: 130, toner: 10, dropout: 38, grain: 25, inkColor: "#2b2236", tonerOpacity: 60, paperGrain: 40, paperTone: 35 },
  "Riso – Korn": { texture: "riso", toner: 12, dropout: 30, grain: 35, paperGrain: 35, paperTone: 25 },
  "Zeitungsdruck": { texture: "newsprint", toner: 20, dropout: 25, grain: 15, paperGrain: 40, paperTone: 45, paperToneColor: "#e9e1cc" },
  "Siebdruck": { texture: "mesh", scale: 90, toner: 8, dropout: 30, grain: 10, paperGrain: 30 },
  "Inkjet billig": { texture: "inkband", toner: 15, dropout: 25, grain: 20, texture2: "nozzle", texture2Mix: 70, texture2Mode: "add" },
  "Fax": { texture: "fax", toner: 35, dropout: 30, grain: 35, paperDirt: 60, paperTone: 20, paperToneColor: "#ecebe4" },
  "Kassenbon": { texture: "receipt", toner: 10, dropout: 40, grain: 25, fadeAmount: 60, fadeStyle: "bottom", paperTone: 15 },
  "Nadeldrucker": { texture: "dotmatrix", scale: 80, toner: 12, dropout: 45, grain: 10 },
  "Altes Papier": { texture: "paper", toner: 8, dropout: 12, grain: 15, paperGrain: 70, paperTone: 60, paperToneColor: "#e8d9b5", fadeAmount: 50, fadeStyle: "frame" },
};

const SLIDERS = [
  { key: "strength", label: "Deckkraft", min: 0, max: 100, step: 1, unit: "%", parent: "secStrengthTop" },
  { key: "scale", label: "Größe", min: 10, max: 500, step: 1, unit: "%", parent: "secTexture" },
  { key: "rotation", label: "Winkel", min: 0, max: 360, step: 1, unit: "°", parent: "secTexture" },
  { key: "grainSize", label: "Korngröße", min: 0.5, max: 8, step: 0.5, unit: "px", parent: "secTexture" },
  { key: "texture2Mix", label: "Anteil", min: 0, max: 100, step: 1, unit: "%", parent: "secTexture2" },
  { key: "texture2Scale", label: "Größe", min: 10, max: 500, step: 1, unit: "%", parent: "secTexture2" },
  { key: "toner", label: "Menge", min: 0, max: 100, step: 1, unit: "%", parent: "secToner" },
  { key: "tonerOpacity", label: "Deckkraft", min: 0, max: 100, step: 1, unit: "%", parent: "secToner" },
  { key: "paperDirt", label: "Schmutz auf Papier", min: 0, max: 100, step: 1, unit: "%", parent: "secToner" },
  { key: "dropout", label: "Menge", min: 0, max: 100, step: 1, unit: "%", parent: "secDropout" },
  { key: "dropoutOpacity", label: "Deckkraft", min: 0, max: 100, step: 1, unit: "%", parent: "secDropout" },
  { key: "paperGrain", label: "Struktur", min: 0, max: 100, step: 1, unit: "%", parent: "secPaper" },
  { key: "paperTone", label: "Papierton", min: 0, max: 100, step: 1, unit: "%", parent: "secPaper" },
  { key: "grain", label: "Körnung", min: 0, max: 100, step: 1, unit: "%", parent: "secStructure" },
  { key: "softness", label: "Weichheit", min: 0, max: 100, step: 1, unit: "%", parent: "secStructure" },
  { key: "fadeAmount", label: "Stärke", min: 0, max: 100, step: 1, unit: "%", parent: "secFade" },
];
const COLOR_KEYS = ["inkColor", "paperColor", "paperToneColor"];

let params = loadParams();
let previewSrc = null;   // { mode, w, h, rgba, cov, sb, full, pxScale, docId }
let previewMode = "fit"; // "fit" | "detail"
let imageTextures = [];
let busy = false;
let pipeCache = { key: "", pipe: null };
const ctl = {};

function texData(id) { return id ? imageTextures.find((t) => t.id === id) || null : null; }
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
function docBounds(doc) {
  return { left: 0, top: 0, right: Math.round(Number(doc.width)), bottom: Math.round(Number(doc.height)) };
}
function debounce(fn, ms) {
  let t = null;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
const TARGET = [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }];
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
function findGroups(doc) { return doc.layers.filter((l) => l.name === GROUP_NAME && l.layers); }
// Lose MS-Printer-Ebenen außerhalb der Gruppe (dürfen nie übrig bleiben)
function strayLayers(doc) {
  const names = Object.values(L);
  return doc.layers.filter((l) => !l.layers && names.indexOf(l.name) >= 0);
}
// Gruppe MIT Inhalt löschen – Layer.delete() auf einer Gruppe lässt die Kinder sonst stehen
async function deleteGroups(doc) {
  for (const g of findGroups(doc)) {
    for (const c of g.layers.slice()) await c.delete();
    await g.delete();
  }
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
function anyNonZero(a) { for (let i = 0; i < a.length; i++) if (a[i]) return true; return false; }

// Liest das Dokument OHNE die MS-Printer-Gruppe (Gruppe kurz ausblenden, Protokoll zurückrollen).
async function readComposite(ctx, doc, sourceBounds, targetSize) {
  const groups = findGroups(doc).filter((g) => g.visible);
  let hid = null;
  if (groups.length) {
    hid = await ctx.hostControl.suspendHistory({ documentID: doc.id, name: HIST + " lesen" });
    for (const g of groups) g.visible = false;
  }
  try {
    const opts = { documentID: doc.id, sourceBounds, colorSpace: "RGB", componentSize: 8 };
    if (targetSize) opts.targetSize = targetSize;
    const res = await imaging.getPixels(opts);
    const id = res.imageData;
    const raw = to8bit(await id.getData({ chunky: true }), id.componentSize || 8);
    const out = { w: id.width, h: id.height, comps: id.components, raw, sb: res.sourceBounds || sourceBounds };
    id.dispose();
    return out;
  } finally {
    if (hid !== null) await ctx.hostControl.resumeHistory(hid, false);
  }
}

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
  for (const k of Object.keys(Core.DEFAULTS)) out[k] = p[k];
  return out;
}
function diffParams(a, b) { return Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])); }
const lastApplied = new Map(); // docId -> Parameter

// ---------------------------------------------------------------- Bedienelemente (Morgenstern-Design, ms-ui.js)

function buildSliders() {
  for (const s of SLIDERS) {
    ctl[s.key] = UI.slider($(s.parent), Object.assign({ def: Core.DEFAULTS[s.key] }, s), {
      get: () => params[s.key],
      set: (v) => { params[s.key] = v; changed(); },
      done: () => syncUI(),
    });
  }
}

// Druckfehler: Kategorie wählen, dann Kachel. „Haupt“ setzt den ersten, „Zweiter“ den zweiten Druckfehler.
const SCANS = "Eigene Scans";
let texSlot = "1";
let texGroup = null;
const thumbCache = {};
function groupOf(id) { const n = Core.NOISES.find((x) => x.id === id); return n ? n.group : (String(id).startsWith("img:") ? SCANS : null); }
function texGroups() { return Core.NOISES.map((n) => n.group).filter((g, i, a) => a.indexOf(g) === i).concat([SCANS]); }
function buildTextureGrid() {
  if (!texGroup) texGroup = groupOf(params.texture) || Core.NOISES[0].group;
  UI.seg($("groupSeg"), texGroups().map((g) => ({ id: g, name: g })), (g) => { texGroup = g; buildTextureGrid(); });
  const grid = $("texGrid");
  grid.innerHTML = "";
  const addTile = (t) => {
    const tile = document.createElement("div");
    tile.className = "tile";
    tile.dataset.id = t.id;
    tile.title = t.name;
    tile.innerHTML = t.id === "__add"
      ? `<div class="ph add">+</div><div class="lbl">Scan laden…</div>`
      : (thumbCache[t.id] ? `<img src="${thumbCache[t.id]}">` : `<div class="ph"></div>`) + `<div class="lbl">${UI.esc(t.name)}</div>`;
    tile.addEventListener("click", () => {
      if (t.id === "__add") return importImageTextures();
      if (texSlot === "2") params.texture2 = t.id; else params.texture = t.id;
      syncUI(); changed();
    });
    grid.appendChild(tile);
  };
  if (texGroup === SCANS) { for (const t of imageTextures) addTile(t); addTile({ id: "__add", name: "Scan laden" }); }
  else for (const n of Core.NOISES) if (n.group === texGroup) addTile(n);
  syncUI();
  renderThumbs();
}

async function renderThumbs() {
  if (!imaging || !imaging.encodeImageData) return;
  const size = 38;
  for (const t of Core.NOISES.concat(imageTextures)) {
    try {
      if (!thumbCache[t.id]) {
        const g = Core.renderThumb(t.id, size, texData(t.id));
        const rgb = new Uint8Array(size * size * 3);
        for (let i = 0; i < g.length; i++) { rgb[i * 3] = g[i]; rgb[i * 3 + 1] = g[i]; rgb[i * 3 + 2] = g[i]; }
        thumbCache[t.id] = await encodeRGB(rgb, size, size);
      }
      const tile = document.querySelector(`.tile[data-id="${t.id}"]`);
      if (tile && thumbCache[t.id] && tile.firstChild && tile.firstChild.tagName !== "IMG") {
        const img = document.createElement("img");
        img.src = thumbCache[t.id];
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
    return "data:image/jpeg;base64," + await imaging.encodeImageData({ imageData: imgData, base64: true });
  } finally {
    imgData.dispose();
  }
}

const pick = (key) => (v) => { params[key] = v; syncUI(); changed(); };
function buildSelects() {
  UI.seg($("fadeStyleSeg"), Core.FADE_STYLES, pick("fadeStyle"));
  UI.seg($("texture2ModeSeg"), Core.MIX_MODES.map((m) => ({ id: m.id, name: m.name.replace(/ \(.*\)$/, ""), tip: m.name })), pick("texture2Mode"));
  UI.seg($("tonerBlendSeg"), Core.BLEND_MODES, pick("tonerBlend"));
  UI.seg($("dropoutBlendSeg"), Core.LIGHT_MODES, pick("dropoutBlend"));
  UI.seg($("slotSeg"), [{ id: "1", name: "Haupt" }, { id: "2", name: "Zweiter" }], (v) => {
    texSlot = v;
    const id = v === "2" ? params.texture2 : params.texture;
    if (id && groupOf(id) !== texGroup) { texGroup = groupOf(id); buildTextureGrid(); } else syncUI();
  });
  UI.seg($("lookList"), Object.keys(BUILTIN_PRESETS).map((n) => ({ id: n, name: n })), (n) => {
    params = Object.assign({}, Core.DEFAULTS, { seed: params.seed, strength: params.strength }, BUILTIN_PRESETS[n]);
    texSlot = "1"; texGroup = groupOf(params.texture); buildTextureGrid(); changed();
    setStatus(`Look „${n}“ – alle Regler bleiben frei einstellbar.`);
  });
  rebuildPresetSelect();
}
// eingebaute Looks: aktiv, solange alle Werte dazu passen
function activeLook() {
  for (const n of Object.keys(BUILTIN_PRESETS)) {
    const ref = Object.assign({}, Core.DEFAULTS, BUILTIN_PRESETS[n]);
    if (Object.keys(ref).every((k) => k === "seed" || k === "strength" || JSON.stringify(ref[k]) === JSON.stringify(params[k]))) return n;
  }
  return "";
}
function buildTexture2Select() { /* zweiter Druckfehler wird über die Kacheln gewählt */ }

// eigene Presets als Liste: Klick lädt, × löscht
function rebuildPresetSelect() {
  UI.presetList($("presetList"), Object.keys(loadUserPresets()),
    (n) => { params = Object.assign({}, Core.DEFAULTS, { seed: params.seed }, loadUserPresets()[n]); texGroup = groupOf(params.texture); buildTextureGrid(); changed(); setStatus(`Preset „${n}“ geladen.`); },
    (n) => { const u = loadUserPresets(); delete u[n]; saveUserPresets(u); rebuildPresetSelect(); setStatus(`Preset „${n}“ gelöscht.`); });
}

function syncUI() {
  for (const key of Object.keys(ctl)) ctl[key].set(params[key]);
  const cur = texSlot === "2" ? params.texture2 : params.texture;
  document.querySelectorAll(".tile").forEach((el) => {
    const id = el.dataset.id;
    el.className = "tile" + (id === cur ? " active" : (texSlot === "1" && id === params.texture2) || (texSlot === "2" && id === params.texture) ? " second" : "");
  });
  UI.syncSeg($("slotSeg"), texSlot);
  UI.syncSeg($("groupSeg"), texGroup);
  $("texName").textContent = texLabel(params.texture) + (params.texture2 ? " + " + texLabel(params.texture2) : "");
  $("slot1").className = texSlot === "1" ? "" : "hidden";
  $("slot2").className = texSlot === "2" ? "" : "hidden";
  $("deleteImgTex").className = String(params.texture).startsWith("img:") ? "btn small ghost" : "btn small ghost hidden";
  $("tex2Empty").className = params.texture2 ? "empty hidden" : "empty";
  $("tex2Controls").className = params.texture2 ? "" : "hidden";
  $("invert").checked = !!params.invert;
  $("texture2Invert").checked = !!params.texture2Invert;
  $("tonerEnabled").checked = !!params.tonerEnabled;
  $("dropoutEnabled").checked = !!params.dropoutEnabled;
  $("autoAdapt").checked = !!params.autoAdapt;
  $("tonerCard").className = params.tonerEnabled ? "group" : "group off";
  $("dropoutCard").className = params.dropoutEnabled ? "group" : "group off";
  UI.syncSeg($("texture2ModeSeg"), params.texture2Mode);
  UI.syncSeg($("tonerBlendSeg"), params.tonerBlend);
  UI.syncSeg($("dropoutBlendSeg"), params.dropoutBlend);
  UI.syncSeg($("fadeStyleSeg"), params.fadeStyle);
  $("fadeStyleRow").className = params.fadeAmount > 0 ? "field stack sub" : "field stack sub hidden";
  UI.syncSeg($("lookList"), activeLook());
  $("lookName").textContent = activeLook();
  for (const k of COLOR_KEYS) $("swatch-" + k).style.backgroundColor = params[k];
  $("seed").value = String(params.seed);
  document.querySelectorAll("#previewModeSeg .seg-btn").forEach((el) => {
    el.className = el.dataset.mode === previewMode ? "seg-btn active" : "seg-btn";
  });
  UI.syncSwitches();
}

const SEC_KEY = "msprinter.sections.v1";
const SEC_DEFAULT = { looks: true, texture: true, layers: true, structure: false, more: false };
function bindControls() {
  UI.sections(SEC_KEY, SEC_DEFAULT);
  const bindCheck = (id, key) => UI.bindSwitch(id, (on) => { params[key] = on; syncUI(); changed(); });
  bindCheck("invert", "invert");
  bindCheck("texture2Invert", "texture2Invert");
  bindCheck("tonerEnabled", "tonerEnabled");
  bindCheck("dropoutEnabled", "dropoutEnabled");
  bindCheck("autoAdapt", "autoAdapt");
  UI.bindSwitch("previewOriginal", () => renderPreview());
  UI.bindSwitch("liveCanvas", (on) => {
    liveLast = null;
    if (on) applyPrint(true);
    else setStatus("Live aus – der aktuelle Stand bleibt im Dokument.");
  });
  $("clearTex2").addEventListener("click", () => { params.texture2 = ""; syncUI(); changed(); });
  $("deleteImgTex").addEventListener("click", () => deleteImageTexture(params.texture));
  for (const k of COLOR_KEYS) {
    $("swatch-" + k).addEventListener("click", (e) => {
      e.stopPropagation();
      UI.openColorPop({
        pop: $("colorPop"), key: k, anchor: $("swatch-" + k).parentNode,
        get: () => params[k],
        set: (c) => { params[k] = c; syncUI(); changed(); },
        exact: () => pickColor(k),
      });
    });
  }
  $("seed").addEventListener("change", (e) => {
    const v = parseInt(e.target.value, 10);
    if (!isNaN(v)) params.seed = v;
    syncUI(); changed();
  });
  $("dice").addEventListener("click", () => { params.seed = Math.floor(Math.random() * 99999); syncUI(); changed(); });
  document.querySelectorAll("#previewModeSeg .seg-btn").forEach((el) => el.addEventListener("click", () => {
    previewMode = el.dataset.mode;
    syncUI();
    refreshPreviewSource();
  }));
  $("refreshPreview").addEventListener("click", () => refreshPreviewSource());
  $("presetSave").addEventListener("click", () => {
    const name = String($("presetName").value || "").trim();
    if (!name) return setStatus("Gib dem Preset zuerst einen Namen.", true);
    const user = loadUserPresets();
    user[name] = Object.assign({}, params);
    saveUserPresets(user);
    rebuildPresetSelect();
    $("presetName").value = "";
    setStatus(`Preset „${name}“ gespeichert.`);
  });
  $("resetAll").addEventListener("click", () => { params = Object.assign({}, Core.DEFAULTS); syncUI(); changed(); });
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

function showSyncHint() {
  try {
    const doc = app.activeDocument;
    if (!doc) return;
    const applied = lastApplied.get(doc.id);
    if (!applied) return;
    const diff = diffParams(effectiveParams(params), applied);
    if (diff.length) setStatus(`● Noch nicht im Dokument: ${diff.join(", ")} – „Anwenden“ klicken oder Live einschalten.`);
    else setStatus("Dokument entspricht den Einstellungen.");
  } catch (e) { /* egal */ }
}

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
      syncUI(); changed();
    }
  } catch (e) {
    setStatus("Farbwähler nicht verfügbar – Hex-Wert eintippen.", true);
  }
}

// ---------------------------------------------------------------- Vorschau
// "Ganzes Dokument": verkleinert. "Detail 1:1": Ausschnitt aus der Mitte in Originalgröße,
// damit man das echte Korn sieht.

async function refreshPreviewSource() {
  if (busy) return;
  const doc = app.activeDocument;
  if (!doc) { previewSrc = null; $("docName").textContent = "–"; return renderPreview("Kein Dokument geöffnet."); }
  $("docName").textContent = doc.name || "Dokument";
  const full = docBounds(doc);
  let b = full, ts = null;
  if (previewMode === "detail") {
    const w = Math.min(full.right, 300), h = Math.min(full.bottom, 168);
    const left = Math.floor((full.right - w) / 2), top = Math.floor((full.bottom - h) / 2);
    b = { left, top, right: left + w, bottom: top + h };
  } else {
    const f = Math.min(1, 300 / full.right, 168 / full.bottom);
    ts = { width: Math.max(1, Math.round(full.right * f)), height: Math.max(1, Math.round(full.bottom * f)) };
  }
  try {
    let src = null;
    await core.executeAsModal(async (ctx) => {
      const c = await readComposite(ctx, doc, b, ts);
      const n = c.w * c.h;
      const rgba = new Uint8Array(n * 4);
      for (let i = 0; i < n; i++) {
        rgba[i * 4] = c.raw[i * c.comps]; rgba[i * 4 + 1] = c.raw[i * c.comps + 1]; rgba[i * 4 + 2] = c.raw[i * c.comps + 2];
        rgba[i * 4 + 3] = 255;
      }
      const cov = Core.coverageFromRGBA(c.raw, c.comps, n), luma = Core.lumaFromRGBA(c.raw, c.comps, n);
      src = { mode: previewMode, docId: doc.id, w: c.w, h: c.h, rgba, cov, luma, info: Core.analyzeDocument(luma, cov),
        sb: c.sb, full, pxScale: (c.sb.right - c.sb.left) / c.w };
    }, { commandName: HIST + " Vorschau" });
    ignoreEventsUntil = Date.now() + 600;
    previewSrc = src;
    renderPreview();
    if (src.mode === "fit") showDocInfo(src.info);
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
    m.textContent = msg || "Dokument öffnen…";
    return;
  }
  const token = ++previewToken;
  const s = previewSrc;
  const p = Object.assign({}, params);
  const { sampler, cdf } = getPipeline(p, s.full);
  const out = Core.computeOverlay({
    width: s.w, height: s.h, originX: s.sb.left, originY: s.sb.top, pxScale: s.pxScale,
    bounds: s.full, params: p, sampler, cdf, coverage: s.cov, luma: s.luma,
  });
  const rgb = $("previewOriginal").checked ? stripAlpha(s.rgba) : Core.compositeOverlay(s.rgba, 4, out, p);
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
// Kurzinfo, wie MS Printer das Dokument einschätzt
function showDocInfo(info) {
  if (!info || busy) return;
  const dark = Math.round(info.darkShare * 100);
  if (!params.autoAdapt) return;
  if (dark > 60) setStatus(`Dokument ist überwiegend dunkel (${dark} %) – Fehler erscheinen als helle Fehlstellen.`);
  else if (dark > 20) setStatus(`Gemischtes Dokument (${dark} % dunkel) – hell auf dunklen, dunkel auf hellen Flächen.`);
  else setStatus(`Helles Dokument – Fehler erscheinen als Toner und Aussetzer.`);
}

function stripAlpha(rgba) {
  const out = new Uint8Array(rgba.length / 4 * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) { out[j] = rgba[i]; out[j + 1] = rgba[i + 1]; out[j + 2] = rgba[i + 2]; }
  return out;
}

// ---------------------------------------------------------------- Eigene Scans

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
          const res = await imaging.getPixels({ documentID: d.id, colorSpace: "RGB", componentSize: 8,
            targetSize: { width: Math.max(1, Math.round(W * f)), height: Math.max(1, Math.round(H * f)) } });
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
  if (params.texture === id) params.texture = "copygrain";
  if (params.texture2 === id) params.texture2 = "";
  buildTextureGrid(); buildTexture2Select(); syncUI(); changed();
  setStatus(`Scan „${t.name}“ gelöscht.`);
}

// ---------------------------------------------------------------- Anwenden / Entfernen

// Berechnet die Ebenen-Inhalte für das ganze Dokument (ohne bestehende MS-Printer-Gruppe)
async function computeForDocument(ctx, doc, p) {
  const b = docBounds(doc);
  const c = await readComposite(ctx, doc, b, null);
  const cov = Core.coverageFromRGBA(c.raw, c.comps, c.w * c.h);
  const luma = Core.lumaFromRGBA(c.raw, c.comps, c.w * c.h);
  const { sampler, cdf } = Core.buildPipeline(p, b, texData(p.texture), texData(p.texture2));
  const out = Core.computeOverlay({ width: c.w, height: c.h, originX: 0, originY: 0, pxScale: 1, bounds: b, params: p, sampler, cdf, coverage: cov, luma });
  return { out, w: c.w, h: c.h };
}

function solidRGBA(n, rgb, alpha) {
  const buf = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    buf[i * 4] = rgb.r; buf[i * 4 + 1] = rgb.g; buf[i * 4 + 2] = rgb.b; buf[i * 4 + 3] = alpha ? alpha[i] : 255;
  }
  return buf;
}
function grayRGBA(gray) {
  const buf = new Uint8Array(gray.length * 4);
  for (let i = 0; i < gray.length; i++) { buf[i * 4] = buf[i * 4 + 1] = buf[i * 4 + 2] = gray[i]; buf[i * 4 + 3] = 255; }
  return buf;
}

async function makeTextureLayer(doc, name, buf, w, h, mode, opacity) {
  await batchPlay([{ _obj: "make", _target: [{ _ref: "layer" }], using: { _obj: "layer", name } }], {});
  const layer = doc.activeLayers[0];
  const d = await imaging.createImageDataFromBuffer(fromBuf8(buf, doc), {
    width: w, height: h, components: 4, chunky: true, colorSpace: "RGB", colorProfile: "sRGB IEC61966-2.1",
  });
  try {
    await imaging.putPixels({ documentID: doc.id, layerID: layer.id, imageData: d, targetBounds: { left: 0, top: 0 } });
  } finally {
    d.dispose();
  }
  await batchPlay([{ _obj: "set", _target: TARGET, to: { _obj: "layer", mode: { _enum: "blendMode", _value: mode }, opacity: { _unit: "percentUnit", _value: opacity } } }], {});
  return layer.id;
}

async function applyToDocument(ctx, doc, p) {
  await deleteGroups(doc);
  const { out, w, h } = await computeForDocument(ctx, doc, p);
  const n = w * h;
  const made = [];
  // ganz oben anfangen; jede neue Ebene landet über der vorherigen
  if (doc.layers[0]) await selectLayer(doc.layers[0].id);
  if (p.paperTone > 0) made.push(await makeTextureLayer(doc, L.tone, solidRGBA(n, hexToRgb(p.paperToneColor)), w, h, "multiply", p.paperTone));
  if (out.paper) made.push(await makeTextureLayer(doc, L.paper, grayRGBA(out.paper), w, h, "softLight", 100));
  if (p.tonerEnabled && anyNonZero(out.toner)) made.push(await makeTextureLayer(doc, L.toner, solidRGBA(n, hexToRgb(p.inkColor), out.toner), w, h, p.tonerBlend, p.tonerOpacity));
  if (p.dropoutEnabled && anyNonZero(out.light)) made.push(await makeTextureLayer(doc, L.dropout, solidRGBA(n, hexToRgb(p.paperColor), out.light), w, h, p.dropoutBlend, p.dropoutOpacity));
  if (made.length) {
    await selectLayers(made);
    await batchPlay([{ _obj: "make", _target: [{ _ref: "layerSection" }], from: { _ref: "layer", _enum: "ordinal", _value: "targetEnum" }, name: GROUP_NAME }], {});
    await batchPlay([{ _obj: "set", _target: TARGET, to: { _obj: "layer", name: GROUP_NAME } }], {});
    // Gesamt-Deckkraft direkt an der Gruppe setzen (per batchPlay auf eine frische Gruppe wird sie ignoriert)
    const g = findGroups(doc)[0];
    if (g) g.opacity = p.strength;
  }
  log("  Gruppe", { ebenen: made.length, breite: w, hoehe: h });
  lastApplied.set(doc.id, effectiveParams(p));
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
  busy = true;
  setStatus(live ? "Live-Update…" : "Erzeuge Druck-Look…");
  const t0 = Date.now();
  let error = null;
  const replaceLast = live && liveLast && liveLast.docId === doc.id && liveLast.stateId !== null && liveLast.stateId === historyStateId(doc);
  log(live ? "LIVE" : "ANWENDEN", { ersetztLetztenSchritt: !!replaceLast, params: effectiveParams(params) });
  try {
    await core.executeAsModal(async (ctx) => {
      if (replaceLast) await batchPlay([{ _obj: "select", _target: [{ _ref: "historyState", _enum: "ordinal", _value: "previous" }] }], {});
      const hid = await ctx.hostControl.suspendHistory({ documentID: doc.id, name: live ? HIST + " Live" : HIST });
      try { await applyToDocument(ctx, doc, Object.assign({}, params)); }
      finally { await ctx.hostControl.resumeHistory(hid); }
    }, { commandName: HIST + " anwenden" });
  } catch (e) {
    error = e.message || String(e);
  }
  liveLast = live && !error ? { docId: doc.id, stateId: historyStateId(doc) } : null;
  log("  Ergebnis", { fehler: error, ms: Date.now() - t0 });
  ignoreEventsUntil = Date.now() + 600;
  busy = false;
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (error) setStatus("Fehler: " + error, true);
  else setStatus(live ? `Live aktualisiert (${secs}s).` : `Fertig in ${secs}s – Gruppe „${GROUP_NAME}“ liegt oben. Rückgängig mit ⌘Z.`);
  if (livePending && $("liveCanvas").checked) { livePending = false; applyPrint(true); }
}
const debouncedLive = debounce(() => applyPrint(true), 250);

async function removePrint() {
  if (busy) return;
  const doc = app.activeDocument;
  if (!doc) return setStatus("Kein Dokument geöffnet.", true);
  busy = true;
  try {
    await core.executeAsModal(async (ctx) => {
      const hid = await ctx.hostControl.suspendHistory({ documentID: doc.id, name: HIST + " entfernen" });
      try { await deleteGroups(doc); }
      finally { await ctx.hostControl.resumeHistory(hid); }
    }, { commandName: HIST + " entfernen" });
    lastApplied.delete(doc.id);
    log("ENTFERNEN");
    setStatus(`Gruppe „${GROUP_NAME}“ entfernt.`);
  } catch (e) {
    setStatus("Fehler beim Entfernen: " + (e.message || e), true);
  }
  busy = false;
}

// ---------------------------------------------------------------- Prüfen

async function readLayerAlpha(doc, layerId, w, h) {
  const r = await imaging.getPixels({ documentID: doc.id, layerID: layerId, colorSpace: "RGB", componentSize: 8 });
  const d = r.imageData;
  const raw = to8bit(await d.getData({ chunky: true }), d.componentSize || 8);
  const rb = r.sourceBounds || { left: 0, top: 0 };
  const out = new Uint8Array(w * h);
  const c = d.components;
  for (let y = 0; y < d.height; y++) for (let x = 0; x < d.width; x++) {
    const tx = rb.left + x, ty = rb.top + y;
    if (tx >= 0 && ty >= 0 && tx < w && ty < h) out[ty * w + tx] = c >= 4 ? raw[(y * d.width + x) * c + 3] : 255;
  }
  d.dispose();
  return out;
}
function compare(exp, act) {
  let big = 0;
  for (let i = 0; i < exp.length; i++) if (Math.abs(exp[i] - act[i]) > 100) big++;
  return Math.round(big / exp.length * 1000) / 10;
}

async function verifyDocument(ctx, doc, p) {
  const r = {};
  const groups = findGroups(doc);
  r.gruppen = groups.length;
  const { out, w, h } = await computeForDocument(ctx, doc, p);
  const want = {};
  if (p.paperTone > 0) want[L.tone] = { mode: "multiply", opacity: p.paperTone };
  if (out.paper) want[L.paper] = { mode: "softLight", opacity: 100 };
  if (p.tonerEnabled && anyNonZero(out.toner)) want[L.toner] = { mode: p.tonerBlend, opacity: p.tonerOpacity, alpha: out.toner };
  if (p.dropoutEnabled && anyNonZero(out.light)) want[L.dropout] = { mode: p.dropoutBlend, opacity: p.dropoutOpacity, alpha: out.light };
  const names = Object.keys(want);
  const fail = (m) => { r.fehler = (r.fehler ? r.fehler + ", " : "") + m; };
  const loose = strayLayers(doc).length;
  if (loose) fail(`${loose} lose MS-Printer-Ebene(n) außerhalb der Gruppe`);
  if (!names.length) { if (groups.length) fail("Gruppe sollte fehlen"); r.ok = !r.fehler; return r; }
  if (groups.length !== 1) { fail(groups.length ? "mehrere Gruppen" : "Gruppe fehlt"); r.ok = false; return r; }
  const g = groups[0];
  if (doc.layers[0].id !== g.id) fail("Gruppe nicht ganz oben");
  if (Math.abs(Number(g.opacity) - p.strength) > 1) fail(`Gruppen-Deckkraft ${g.opacity} statt ${p.strength}`);
  const kids = g.layers.map((l) => l.name);
  r.ebenen = kids;
  const order = [L.dropout, L.toner, L.paper, L.tone].filter((n) => want[n]);
  if (JSON.stringify(kids) !== JSON.stringify(order)) fail("Ebenen/Reihenfolge falsch");
  for (const l of g.layers) {
    const wnt = want[l.name];
    if (!wnt) continue;
    const mode = String(l.blendMode || "").replace(/^BlendMode\./, "");
    if (mode.toLowerCase() !== wnt.mode.toLowerCase()) fail(`${l.name}: Mischmodus ${mode} statt ${wnt.mode}`);
    if (Math.abs(Number(l.opacity) - wnt.opacity) > 1) fail(`${l.name}: Deckkraft ${l.opacity} statt ${wnt.opacity}`);
    if (wnt.alpha) {
      const dev = compare(wnt.alpha, await readLayerAlpha(doc, l.id, w, h));
      r[l.name + "Abweichung"] = dev;
      if (dev > 1) fail(`${l.name}: ${dev}% Pixel anders`);
    }
  }
  r.ok = !r.fehler;
  return r;
}

async function verifyNow(doc) {
  let r;
  await core.executeAsModal(async (ctx) => { r = await verifyDocument(ctx, doc, Object.assign({}, params)); }, { commandName: HIST + " prüfen" });
  return r;
}

async function verifyCanvas() {
  if (busy) return;
  const doc = app.activeDocument;
  if (!doc) return setStatus("Kein Dokument geöffnet.", true);
  busy = true;
  let r;
  try { r = await verifyNow(doc); } catch (e) { r = { ok: false, fehler: e.message || String(e) }; }
  busy = false;
  ignoreEventsUntil = Date.now() + 600;
  log("PRÜFEN", r);
  if (r.ok) setStatus("✓ Dokument entspricht den aktuellen Einstellungen.");
  else setStatus("✗ " + r.fehler + " (Details im Log)", true);
}

// ---------------------------------------------------------------- Selbsttest

function testArtwork(w, h) {
  const buf = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    let c = null;
    if (x >= 40 && x < 520 && y >= 40 && y < 200) c = [24, 24, 28];
    const dx = x - 700, dy = y - 140, d = Math.sqrt(dx * dx + dy * dy);
    if (d < 110) c = [214, 40, 56];
    if (x >= 40 && x < 860 && y >= 260 && y < 300) c = [40, 90, 200];
    if (c) { buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = 255; }
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
  setStatus("Selbsttest läuft… (ca. 1–2 Minuten, bitte nichts anklicken)");
  try {
    await core.executeAsModal(async () => {
      doc = await app.documents.add({ width: 900, height: 520, resolution: 72, mode: "RGBColorMode", fill: "white", name: "MS Printer Selbsttest" });
      await batchPlay([{ _obj: "make", _target: [{ _ref: "layer" }], using: { _obj: "layer", name: "Artwork" } }], {});
      const al = doc.activeLayers[0];
      const id = await imaging.createImageDataFromBuffer(testArtwork(900, 520), { width: 900, height: 520, components: 4, chunky: true, colorSpace: "RGB", colorProfile: "sRGB IEC61966-2.1" });
      await imaging.putPixels({ documentID: doc.id, layerID: al.id, imageData: id, targetBounds: { left: 0, top: 0 } });
      id.dispose();
      try {
        await batchPlay([{
          _obj: "make", _target: [{ _ref: "textLayer" }],
          using: { _obj: "textLayer", textKey: "PRINTED",
            textClickPoint: { _obj: "paint", horizontal: { _unit: "percentUnit", _value: 5 }, vertical: { _unit: "percentUnit", _value: 92 } },
            textStyleRange: [{ _obj: "textStyleRange", from: 0, to: 7, textStyle: { _obj: "textStyle", size: { _unit: "pointsUnit", _value: 120 }, color: { _obj: "RGBColor", red: 20, grain: 20, blue: 20 } } }] },
        }], {});
      } catch (e) { log("  Textebene nicht erstellbar", String(e.message || e)); }
    }, { commandName: HIST + " Selbsttest vorbereiten" });

    const D = Object.assign({}, Core.DEFAULTS, { seed: 4242 });
    const cases = [];
    for (const n of Core.NOISES) cases.push([`Druckfehler ${n.id}`, { texture: n.id }]);
    for (const m of Core.MIX_MODES) cases.push([`2. Druckfehler ${m.id}`, { texture2: "drumstreaks", texture2Mix: 70, texture2Mode: m.id }]);
    for (const f of Core.FADE_STYLES) cases.push([`Verlauf ${f.id}`, { fadeAmount: 80, fadeStyle: f.id }]);
    for (const b of Core.BLEND_MODES) cases.push([`Toner-Modus ${b.id}`, { tonerBlend: b.id, tonerOpacity: 70 }]);
    for (const b of Core.LIGHT_MODES) cases.push([`Aussetzer-Modus ${b.id}`, { dropoutBlend: b.id, dropoutOpacity: 60 }]);
    cases.push(["Schmutz 0", { paperDirt: 0 }]);
    cases.push(["Schmutz 100", { paperDirt: 100, toner: 50 }]);
    cases.push(["Papierton + Struktur", { paperTone: 50, paperGrain: 80, paperToneColor: "#e8d9b5" }]);
    cases.push(["Nur Toner", { dropoutEnabled: false, paperGrain: 0 }]);
    cases.push(["Nur Aussetzer", { tonerEnabled: false, paperGrain: 0 }]);
    cases.push(["Alles aus", { tonerEnabled: false, dropoutEnabled: false, paperGrain: 0, paperTone: 0 }]);
    cases.push(["Wieder alles an", {}]);
    cases.push(["Tauschen + Winkel", { invert: true, rotation: 30 }]);
    cases.push(["Gesamt-Deckkraft 10", { strength: 10 }]);
    cases.push(["Gesamt-Deckkraft 100", { strength: 100 }]);
    cases.push(["Auto-Anpassung aus", { autoAdapt: false }]);
    cases.push(["Korngröße 4", { grainSize: 4, grain: 70 }]);

    for (const [name, over] of cases) {
      params = Object.assign({}, D, over);
      await applyPrint(false);
      const r = await verifyNow(doc);
      results.push({ test: name, ok: r.ok, details: r });
      setStatus(`Selbsttest: ${results.length}/${cases.length + 5} – ${name}`);
    }

    // Live: mehrere Updates = ein Protokollschritt
    params = Object.assign({}, D, { texture: "riso" });
    liveLast = null;
    const s0 = historyStateId(doc);
    await applyPrint(true);
    params = Object.assign({}, D, { texture: "fax", paperTone: 30 });
    await applyPrint(true);
    params = Object.assign({}, D, { texture: "halftone" });
    await applyPrint(true);
    const states = doc.historyStates;
    const ai = states.findIndex((st) => st.id === historyStateId(doc));
    const before = ai > 0 ? states[ai - 1].id : null;
    results.push({ test: "Live: Protokoll zusammengefasst", ok: before === s0 && states[ai].name === HIST + " Live", details: { s0, before } });
    const rl = await verifyNow(doc);
    results.push({ test: "Live: Dokument = letzte Einstellung", ok: rl.ok, details: rl });

    // Rückgängig -> Stand des letzten Testfalls
    await core.executeAsModal(async () => {
      await batchPlay([{ _obj: "select", _target: [{ _ref: "historyState", _enum: "ordinal", _value: "previous" }] }], {});
    }, { commandName: HIST + " Test" });
    liveLast = null;
    params = Object.assign({}, D, cases[cases.length - 1][1]);
    const ru = await verifyNow(doc);
    results.push({ test: "Rückgängig stellt vorherigen Stand her", ok: ru.ok, details: ru });

    // Doppelt anwenden darf keine zweite Gruppe erzeugen
    await applyPrint(false);
    await applyPrint(false);
    results.push({ test: "Erneut anwenden ersetzt Gruppe", ok: findGroups(doc).length === 1 && strayLayers(doc).length === 0 });

    await removePrint();
    const rest = doc.layers.map((l) => l.name);
    results.push({ test: "Entfernen hinterlässt nichts", ok: findGroups(doc).length === 0 && strayLayers(doc).length === 0 && rest.length === 3, details: rest });
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

// ---------------------------------------------------------------- Start

let ignoreEventsUntil = 0;
const onPsEvent = debounce(() => {
  if (busy || Date.now() < ignoreEventsUntil) return;
  refreshPreviewSource();
}, 400);

async function init() {
  log("START", { ps: app.version });
  await loadImageTextures();
  if (String(params.texture).startsWith("img:") && !texData(params.texture)) params.texture = "copygrain";
  if (String(params.texture2).startsWith("img:") && !texData(params.texture2)) params.texture2 = "";
  buildSliders();
  buildSelects();
  buildTextureGrid();
  bindControls();
  syncUI();
  try {
    action.addNotificationListener(["select", "make", "delete", "open", "close", "set", "move", "transform", "placedLayerEditContents"], onPsEvent);
  } catch (e) { console.log("Event-Listener nicht verfügbar", e); }
  // Entwickler-Hook: eine Datei „run-selftest“ im Datenordner startet den Selbsttest (und wird gelöscht)
  let hookRunning = false;
  setInterval(async () => {
    if (busy || hookRunning) return;
    try { const f = await (await lfs.getDataFolder()).getEntry("run-selftest"); await f.delete(); hookRunning = true; try { await runSelfTest(); } finally { hookRunning = false; } } catch (e) { /* kein Auftrag */ }
  }, 3000);
  refreshPreviewSource();
}

init();
