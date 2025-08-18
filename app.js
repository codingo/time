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

let zones = [];           // [{ row, label, datetime, removeBtn, zoneName, displayLabel }]
let tzData = [];          // loaded from timezones.json
let tzIndex = null;       // lookup maps
let sharedInstant = null; // single UTC instant for the whole view

// Boot inside an async IIFE (avoids top-level await issues on older browsers)
(async function init(){
  await loadTimezoneData();

  // Read query params robustly
  const params = new URLSearchParams(location.search);
  const zonesParam = params.get("zones");
  const timeParam  = params.get("time");

  const startupZones = (zonesParam && zonesParam.split(",").filter(Boolean)) || DEFAULT_ZONES.slice();
  // If time is an ISO with Z, use it; otherwise treat as wall time in the first zone
  sharedInstant = timeParam
    ? (timeParam.endsWith("Z") ? new Date(timeParam) : parseWallAsInstant(timeParam, startupZones[0]))
    : new Date();

  // Build UI
  startupZones.forEach(z => addZone(z, sharedInstant));
  paintAll();

  // Pre-populate suggestions on focus
  inputEl.addEventListener("focus", () => {
    renderSuggestions(suggest("", 25)); // top items when empty
  });

  // Live suggestions
  inputEl.addEventListener("input", () => {
    renderSuggestions(suggest(inputEl.value.trim(), 50));
  });

  // Add btn
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
    // Minimal fallback keeps app usable if file is missing
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
  // Fuzzy
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
  // Empty query: return a curated top list
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

  // Zone change
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

  // Time change → recompute shared instant, repaint all
  const onTimeEdit = () => {
    const v = datetime.value;
    if (!isValidDateTimeLocal(v)) return;
    sharedInstant = parseWallAsInstant(v, record.zoneName);
    paintAll();
    updateURL();
  };
  datetime.addEventListener("input", onTimeEdit);
  datetime.addEventListener("change", onTimeEdit);

  // Remove
  removeBtn.addEventListener("click", () => {
    row.remove();
    zones = zones.filter(z => z !== record);
    paintAll();
    updateURL();
  });

  // Initial paint
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
  if (zones[0]) {
    // store both: human-readable wall time + canonical UTC to be robust
    p.set("time", zones[0].datetime.value);
  }
  p.set("zones", zones.map(z => z.zoneName).join(","));
  history.replaceState(null, "", `?${p.toString()}`);
}

// ----- parsing helpers -----
function parseWallAsInstant(inputValue, zone){
  // input "yyyy-MM-ddTHH:mm" as wall time in 'zone' -> UTC instant
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
