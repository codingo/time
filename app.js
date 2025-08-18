import { toTimeZone, formatLocalInput, isBusinessHours, normalize, tokensOrderedMatch } from "./utils.js";

// Defaults: Gold Coast (Brisbane), San Francisco (LA), New Hampshire (NY)
const DEFAULT_ZONES = ["Australia/Brisbane", "America/Los_Angeles", "America/New_York"];

const zoneContainer = document.getElementById("zones");
const inputEl = document.getElementById("zone-input");
const datalistEl = document.getElementById("tzlist");
const addBtn = document.getElementById("add-zone");

let zones = [];           // [{ row, label, datetime, zoneName }]
let tzData = [];          // loaded from timezones.json
let tzIndex = null;       // lookup maps
let sharedInstant = null; // the one true UTC instant

// --- boot
const params = new URLSearchParams(location.search);
const startupZones = (params.get("zones")?.split(",").filter(Boolean)) || DEFAULT_ZONES;
sharedInstant = params.get("time") ? parseWallAsInstant(params.get("time"), startupZones[0]) : new Date();

await loadTimezoneData();
startupZones.forEach(z => addZone(z, sharedInstant));
paintAll();

addBtn.addEventListener("click", () => {
  const zone = resolveToZone(inputEl.value) || inputEl.value.trim();
  if (!zone) return;
  if (zones.some(z => z.zoneName === zone)) { inputEl.value = ""; return; }
  addZone(zone, sharedInstant);
  inputEl.value = "";
  updateURL();
});

// live suggestions via datalist
inputEl.addEventListener("input", () => {
  const q = inputEl.value.trim();
  datalistEl.innerHTML = "";
  for (const opt of suggest(q, 50)) {
    const o = document.createElement("option");
    o.value = opt.label;
    o.label = `${opt.label} — ${opt.zone}`;
    datalistEl.appendChild(o);
  }
});

// --- data loading & indexing
async function loadTimezoneData(){
  try{
    const res = await fetch("timezones.json", {cache: "no-store"});
    if (!res.ok) throw new Error("fetch failed");
    tzData = await res.json();
  }catch{
    // Minimal fallback if file missing
    tzData = [
      { label:"Gold Coast", zone:"Australia/Brisbane", aliases:["Brisbane","QLD","Sunshine Coast","AEST (no DST)"] },
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
  if (!q) return [];
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

// --- add / events
function addZone(zoneName, instant) {
  if (zones.some(z => z.zoneName === zoneName)) return;

  const row = document.createElement("div");
  row.className = "zone-row";

  const label = document.createElement("input");
  label.className = "zone-label";
  label.placeholder = "Add a timezone (e.g., Gold Coast, San Fr, America/Los_Angeles)";
  const rec = tzIndex.byZone.get(zoneName);
  label.value = rec ? rec.label : zoneName;

  const datetime = document.createElement("input");
  datetime.type = "datetime-local";
  datetime.className = "datetime";

  row.appendChild(label);
  row.appendChild(datetime);
  zoneContainer.appendChild(row);

  const record = { row, label, datetime, zoneName };
  zones.push(record);

  // Zone name changed (user typed a label/alias/IANA)
  label.addEventListener("change", () => {
    const resolved = resolveToZone(label.value) || label.value.trim();
    record.zoneName = resolved;
    // Repaint this row from sharedInstant in the new zone
    paintRow(record, sharedInstant);
    updateURL();
  });

  // Datetime edited -> recompute sharedInstant and repaint all
  datetime.addEventListener("input", () => {
    sharedInstant = parseWallAsInstant(datetime.value, record.zoneName);
    paintAll();
    updateURL();
  });
}

function paintRow(rec, instant){
  // Update the input display for this zone from sharedInstant, and colour
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
  // Persist as the first row's wall time for readability
  if (zones[0]) p.set("time", zones[0].datetime.value);
  p.set("zones", zones.map(z => z.zoneName).join(","));
  history.replaceState(null, "", `?${p.toString()}`);
}

// --- parsing helpers
function parseWallAsInstant(inputValue, zone){
  // input "yyyy-MM-ddTHH:mm" interpreted as wall time in 'zone' -> UTC instant
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
