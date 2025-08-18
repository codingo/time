import {
  toTimeZone, formatLocalInput, isBusinessHours,
  normalize, tokensOrderedMatch, isValidDateTimeLocal
} from "./utils.js";

// Defaults: Gold Coast (Brisbane), San Francisco (LA), New Hampshire (NY)
const DEFAULT_ZONES = ["Australia/Brisbane", "America/Los_Angeles", "America/New_York"];

const zoneContainer = document.getElementById("zones");
const inputEl = document.getElementById("zone-input");
const datalistEl = document.getElementById("tzlist");
const addBtn = document.getElementById("add-zone");

// Trianglify canvases
const triA = document.getElementById("tri-a");
const triB = document.getElementById("tri-b");

let zones = [];           // [{ row, label, datetime, removeBtn, zoneName, displayLabel }]
let tzData = [];          // loaded from timezones.json
let tzIndex = null;       // lookup maps
let sharedInstant = null; // single UTC instant
let activeCanvas = triA;  // for cross-fade
let nextCanvas   = triB;

// ---- Trianglify background ----
const palettes = [
  ["#0f172a","#1e293b","#334155","#0ea5e9","#22d3ee"], // slate → cyan
  ["#0b1324","#1b3a4b","#2e5c6e","#34d399","#22d3ee"], // teal mix
  ["#10002b","#240046","#3c096c","#5a189a","#00d4ff"], // violet → aqua
  ["#0a0f1f","#14213d","#1f2937","#3b82f6","#a78bfa"]  // indigo/blue
];
let paletteIndex = 0;

function sizeCanvas(c){
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  c.width  = Math.floor(window.innerWidth  * dpr);
  c.height = Math.floor(window.innerHeight * dpr);
  c.style.width  = "100vw";
  c.style.height = "100vh";
}

function renderTrianglify(target, colors){
  if (!window.trianglify) return; // safety if CDN blocked
  sizeCanvas(target);
  // Randomize a bit each draw to create motion
  const cell = 90 + Math.random() * 40;
  const varFactor = 0.75;
  const seed = Math.floor(Math.random() * 1e9);

  const pattern = window.trianglify({
    width: target.width,
    height: target.height,
    cellSize: cell,
    variance: varFactor,
    seed,
    xColors: colors,
    colorFunction: window.trianglify.colorFunctions.interpolateLinear(colors)
  });

  const ctx = target.getContext("2d");
  ctx.clearRect(0,0,target.width,target.height);
  pattern.toCanvas(target);
}

function swapLayers(){
  // draw on the "next" canvas, then cross-fade it in
  paletteIndex = (paletteIndex + 1) % palettes.length;
  renderTrianglify(nextCanvas, palettes[paletteIndex]);

  // choose drift variant
  nextCanvas.classList.toggle("drift-a", Math.random() > 0.5);
  nextCanvas.classList.toggle("drift-b", !nextCanvas.classList.contains("drift-a"));

  // cross-fade
  nextCanvas.classList.add("active");
  activeCanvas.classList.remove("active");

  // swap references
  const tmp = activeCanvas;
  activeCanvas = nextCanvas;
  nextCanvas = tmp;
}

function startTrianglify(){
  // initial two frames so the first fade looks continuous
  renderTrianglify(activeCanvas, palettes[paletteIndex]);
  activeCanvas.classList.add("active","drift-a");
  paletteIndex = (paletteIndex + 1) % palettes.length;
  renderTrianglify(nextCanvas, palettes[paletteIndex]);
  nextCanvas.classList.remove("active");
  nextCanvas.classList.add("drift-b");

  // cycle every 10s with gentle fade (CSS handles the 2.2s transition)
  setInterval(swapLayers, 10000);
}

window.addEventListener("resize", () => {
  sizeCanvas(activeCanvas);
  sizeCanvas(nextCanvas);
  // redraw current to maintain crispness after resize
  renderTrianglify(activeCanvas, palettes[paletteIndex]);
});

// ---- App boot ----
(async function init(){
  // start background first for immediate visual parity with codingo.com
  startTrianglify();

  await loadTimezoneData();

  const params = new URLSearchParams(location.search);
  const zonesParam = params.get("zones");
  const timeParam  = params.get("time");

  const startupZones = (zonesParam && zonesParam.split(",").filter(Boolean)) || DEFAULT_ZONES.slice();

  sharedInstant = timeParam
    ? (timeParam.endsWith("Z") ? new Date(timeParam) : parseWallAsInstant(timeParam, startupZones[0]))
    : new Date();

  startupZones.forEach(z => addZone(z, sharedInstant));
  paintAll();

  inputEl.addEventListener("focus", () => {
    renderSuggestions(suggest("", 25));
  });
  inputEl.addEventListener("input", () => {
    renderSuggestions(suggest(inputEl.value.trim(), 50));
  });
  addBtn.addEventListener("click", () => {
    const zone = resolveToZone(inputEl.value) || inputEl.value.trim();
    if (!zone) return;
    if (zones.some(z => z.zoneName === zone)) { inputEl.value = ""; return; }
    addZone(zone, sharedInstant);
    inputEl.value = "";
    updateURL();
  });
})();

// ----- suggestions (datalist) -----
function renderSuggestions(list){
  datalistEl.innerHTML = "";
  list.forEach(opt => {
    const o = document.createElement("option");
    o.value = opt.label;
    o.label = `${opt.label} — ${opt.zone}`;
    datalistEl.appendChild(o);
  });
}

// ----- data loading & index -----
async function loadTimezoneData(){
  try{
    const res = await fetch("timezones.json", {cache: "no-store"});
    if (!res.ok) throw new Error("fetch failed");
    tzData = await res.json();
  }catch{
    tzData = [
      { label:"Gold Coast", zone:"Australia/Brisbane", aliases:["Brisbane","QLD","Sunshine Coast","AEST (no DST)"] },
      { label:"Sydney", zone:"Australia/Sydney", aliases:["NSW","AEDT","AEST","Canberra","New South Wales"] },
      { label:"San Francisco", zone:"America/Los_Angeles", aliases:["SF","Bay Area","Silicon Valley","PT","PST","PDT","San Fran","San Fr"] },
      { label:"New Hampshire", zone:"America/New_York", aliases:["NH","Eastern Time","ET","EST","EDT"] },
      { label:"London", zone:"Europe/London", aliases:["UK","GB","GMT","BST"] },
      { label:"Tokyo", zone:"Asia/Tokyo", aliases:["JP","JST"] }
    ];
  }
  buildIndex();
}

function buildIndex(){
  tzIndex = { byLabel:new Map(), byAlias:new Map(), byZone:new Map() };
  for (const rec of tzData){
    tzIndex.byLabel.set(normalize(rec.label), rec);
    tzIndex.byZone.set(rec.zone, rec);
    (rec.aliases||[]).forEach(a => tzIndex.byAlias.set(normalize(a), rec));
  }
}

function resolveToZone(input){
  if (!input) return null;
  const q = normalize(input);
  if (tzIndex.byLabel.has(q)) return tzIndex.byLabel.get(q).zone;
  if (tzIndex.byAlias.has(q)) return tzIndex.byAlias.get(q).zone;
  if (tzIndex.byZone.has(input)) return input; // exact IANA typed
  const tokens = q.split(" ");
  const best = tzData
    .map(rec => {
      const hay = normalize([rec.label, rec.zone, ...(rec.aliases||[])].join(" "));
      const starts = hay.startsWith(q) ? 0 : Infinity;
      const ordered = tokensOrderedMatch(tokens, hay) ? 1 : Infinity;
      const includes = tokens.every(t => hay.includes(t)) ? 2 : Infinity;
      return { rec, score: Math.min(starts, ordered, includes) };
    })
    .filter(x => x.score !== Infinity)
    .sort((a,b)=> a.score - b.score || a.rec.label.localeCompare(b.rec.label))[0];
  return best ? best.rec.zone : null;
}

function suggest(q, limit=50){
  if (!q) return tzData.slice(0, limit);
  const n = normalize(q), tokens = n.split(" ");
  return tzData
    .map(rec => {
      const hay = normalize([rec.label, rec.zone, ...(rec.aliases||[])].join(" "));
      let score = Infinity;
      if (hay.startsWith(n)) score = 0;
      else if (tokensOrderedMatch(tokens, hay)) score = 1;
      else if (tokens.every(t => hay.includes(t))) score = 2;
      return {rec, score};
    })
    .filter(x => x.score !== Infinity)
    .sort((a,b)=> a.score - b.score || a.rec.label.localeCompare(b.rec.label))
    .slice(0, limit)
    .map(x => x.rec);
}

// ----- rows -----
function addZone(zoneName, instant) {
  if (zones.some(z => z.zoneName === zoneName)) return;

  const row = document.createElement("div");
  row.className = "zone-row";

  const label = document.createElement("input");
  label.className = "zone-label";
  label.placeholder = "Add a timezone (e.g., Gold Coast, San Fr, America/Los_Angeles)";

  const recForZone = tzIndex.byZone.get(zoneName);
  const displayLabel = recForZone ? recForZone.label : zoneName;
  label.value = displayLabel;

  const datetime = document.createElement("input");
  datetime.type = "datetime-local";
  datetime.className = "datetime";

  const removeBtn = document.createElement("button");
  removeBtn.className = "remove";
  removeBtn.setAttribute("aria-label", "Remove timezone");
  removeBtn.textContent = "×";

  row.appendChild(label);
  row.appendChild(datetime);
  row.appendChild(removeBtn);
  zoneContainer.appendChild(row);

  const record = { row, label, datetime, removeBtn, zoneName, displayLabel };
  zones.push(record);

  label.addEventListener("change", () => {
    const typed = label.value.trim();
    const resolvedZone = resolveToZone(typed) || typed;
    record.zoneName = resolvedZone;
    const dbRec = tzIndex.byLabel.get(normalize(typed)) || tzIndex.byAlias.get(normalize(typed));
    record.displayLabel = dbRec ? dbRec.label : typed;
    label.value = record.displayLabel;
    paintRow(record, sharedInstant);
    updateURL();
  });

  const onTimeEdit = () => {
    const v = datetime.value;
    if (!isValidDateTimeLocal(v)) return;
    sharedInstant = parseWallAsInstant(v, record.zoneName);
    paintAll();
    updateURL();
  };
  datetime.addEventListener("input", onTimeEdit);
  datetime.addEventListener("change", onTimeEdit);

  removeBtn.addEventListener("click", () => {
    row.remove();
    zones = zones.filter(z => z !== record);
    paintAll();
    updateURL();
  });

  paintRow(record, instant);
}

function paintRow(rec, instant){
  const local = toTimeZone(instant, rec.zoneName);
  rec.datetime.value = formatLocalInput(local, rec.zoneName);
  const ok = isBusinessHours(instant, rec.zoneName);
  rec.row.classList.toggle("good", ok);
  rec.row.classList.toggle("bad", !ok);
}

function paintAll(){
  zones.forEach(rec => paintRow(rec, sharedInstant));
}

function updateURL() {
  const p = new URLSearchParams();
  if (zones[0]) p.set("time", zones[0].datetime.value);
  p.set("zones", zones.map(z => z.zoneName).join(","));
  history.replaceState(null, "", `?${p.toString()}`);
}

// ----- parsing helpers -----
function parseWallAsInstant(inputValue, zone){
  const [datePart, timePart] = inputValue.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const [H, Min] = timePart.split(":").map(Number);
  const approxUTC = new Date(Date.UTC(y, m - 1, d, H, Min));
  const offsetMins = getOffsetMinutes(approxUTC, zone);
  return new Date(approxUTC.getTime() - offsetMins * 60 * 1000);
}

function getOffsetMinutes(dateUTC, zone) {
  const parts = new Intl.DateTimeFormat("en", { timeZone: zone, timeZoneName: "shortOffset" }).formatToParts(dateUTC);
  const off = parts.find(p => p.type === "timeZoneName")?.value || "UTC+00:00";
  const m = off.match(/([+-])(\d{2}):?(\d{2})/);
  if (!m) return 0;
  const sign = m[1] === "+" ? 1 : -1;
  return sign * (parseInt(m[2],10) * 60 + parseInt(m[3],10));
}
