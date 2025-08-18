import { toTimeZone, formatLocalInput, isBusinessHours, normalize, tokensOrderedMatch } from "./utils.js";

// Defaults: Gold Coast (Brisbane), San Francisco (LA), New Hampshire (NY)
const DEFAULT_ZONES = ["Australia/Brisbane", "America/Los_Angeles", "America/New_York"];

const zoneContainer = document.getElementById("zones");
const inputEl = document.getElementById("zone-input");
const datalistEl = document.getElementById("tzlist");
const addBtn = document.getElementById("add-zone");

let zones = []; // [{ row, label, datetime, zoneName }]
let tzData = []; // loaded from timezones.json
let tzIndex = null; // maps for lookup

// --- boot
const params = new URLSearchParams(location.search);
const startupZones = (params.get("zones")?.split(",").filter(Boolean)) || DEFAULT_ZONES;
const initialTime = params.get("time") ? new Date(params.get("time")) : new Date();

await loadTimezoneData();
startupZones.forEach(z => addZone(z, new Date(initialTime)));

addBtn.addEventListener("click", () => {
  const zone = resolveToZone(inputEl.value);
  if (zone) {
    addZone(zone, getSharedInstant());
    inputEl.value = "";
    updateURL();
  }
});

// live suggestions via datalist
inputEl.addEventListener("input", () => {
  const q = inputEl.value.trim();
  const options = suggest(q, 50);
  datalistEl.innerHTML = "";
  options.forEach(opt => {
    const o = document.createElement("option");
    o.value = opt.label; // show label (e.g., San Francisco)
    o.label = `${opt.label} — ${opt.zone}`;
    datalistEl.appendChild(o);
  });
});

// --- data loading & indexing
async function loadTimezoneData(){
  try{
    const res = await fetch("timezones.json", {cache: "no-store"});
    if (!res.ok) throw new Error("fetch failed");
    tzData = await res.json();
  }catch(e){
    // Fallback minimal dataset if file missing
    tzData = [
      { label:"Gold Coast", zone:"Australia/Brisbane", aliases:["Brisbane","QLD","Sunshine Coast","AEST (no DST)"] },
      { label:"San Francisco", zone:"America/Los_Angeles", aliases:["SF","Bay Area","Silicon Valley","PT","PST","PDT"] },
      { label:"New Hampshire", zone:"America/New_York", aliases:["NH","Eastern Time","ET","EST","EDT"] },
      { label:"London", zone:"Europe/London", aliases:["UK","GB","GMT","BST"] },
      { label:"Tokyo", zone:"Asia/Tokyo", aliases:["JP","JST"] }
    ];
  }
  buildIndex();
}

function buildIndex(){
  // Build maps for fast lookups
  tzIndex = {
    byLabel: new Map(),  // normalized label -> record
    byAlias: new Map(),  // normalized alias -> record
    byZone:  new Map()   // iana -> record
  };
  for (const rec of tzData){
    tzIndex.byLabel.set(normalize(rec.label), rec);
    tzIndex.byZone.set(rec.zone, rec);
    if (rec.aliases){
      for (const a of rec.aliases){
        tzIndex.byAlias.set(normalize(a), rec);
      }
    }
  }
}

function resolveToZone(input){
  if (!input) return null;
  const q = normalize(input);

  // 1) Exact label/alias match
  if (tzIndex.byLabel.has(q)) return tzIndex.byLabel.get(q).zone;
  if (tzIndex.byAlias.has(q)) return tzIndex.byAlias.get(q).zone;

  // 2) Exact IANA zone typed by user
  if (tzIndex.byZone.has(input)) return input;

  // 3) Fuzzy: token-ordered match against (label + aliases + zone)
  const tokens = q.split(" ");
  const best = tzData
    .map(rec => {
      const hay = normalize([rec.label, rec.zone, ...(rec.aliases||[])].join(" "));
      const starts = hay.startsWith(q) ? 0 : Infinity;
      const ordered = tokensOrderedMatch(tokens, hay) ? 1 : Infinity;
      const includesAll = tokens.every(t => hay.includes(t)) ? 2 : Infinity;
      const score = Math.min(starts, ordered, includesAll);
      return { rec, score };
    })
    .filter(x => x.score !== Infinity)
    .sort((a,b) => a.score - b.score || a.rec.label.localeCompare(b.rec.label))[0];

  return best ? best.rec.zone : null;
}

function suggest(q, limit=50){
  if (!q) return [];
  const n = normalize(q);
  const tokens = n.split(" ");

  // score: 0 (startsWith) < 1 (ordered tokens) < 2 (all tokens contained)
  const scored = tzData.map(rec => {
    const hay = normalize([rec.label, rec.zone, ...(rec.aliases||[])].join(" "));
    let score = Infinity;
    if (hay.startsWith(n)) score = 0;
    else if (tokensOrderedMatch(tokens, hay)) score = 1;
    else if (tokens.every(t => hay.includes(t))) score = 2;
    return {rec, score};
  }).filter(x => x.score !== Infinity)
    .sort((a,b)=> a.score - b.score || a.rec.label.localeCompare(b.rec.label))
    .slice(0, limit)
    .map(x => x.rec);

  return scored;
}

// --- add / sync rows
function addZone(zoneName, dateObj) {
  if (zones.some(z => z.zoneName === zoneName)) return; // de-dupe

  const row = document.createElement("div");
  row.className = "zone-row";

  const label = document.createElement("input");
  label.className = "zone-label";
  label.placeholder = "Enter a city/timezone (e.g., Brisbane, San Fr, America/Los_Angeles)";
  // Show the best display label if we know it
  const rec = tzIndex.byZone.get(zoneName);
  label.value = rec ? rec.label : zoneName;

  const datetime = document.createElement("input");
  datetime.type = "datetime-local";
  datetime.className = "datetime";
  datetime.value = formatLocalInput(dateObj, zoneName);

  row.appendChild(label);
  row.appendChild(datetime);
  zoneContainer.appendChild(row);

  const record = { row, label, datetime, zoneName };
  zones.push(record);

  label.addEventListener("change", () => {
    const resolved = resolveToZone(label.value) || label.value;
    record.zoneName = resolved;
    // keep same instant; just repaint to new zone
    syncRow(row, getSharedInstant());
    updateURL();
  });

  datetime.addEventListener("input", () => {
    const newInstant = fromInputAsInstant(datetime.value, record.zoneName);
    setSharedInstant(newInstant);
    updateURL();
  });

  // Initial paint
  syncRow(row, getSharedInstant());
  updateURL();
}

function setSharedInstant(instant) {
  zones.forEach(z => {
    const zDate = toTimeZone(instant, z.zoneName);
    z.datetime.value = formatLocalInput(zDate, z.zoneName);
    paintRow(z.row, instant);
  });
}

function getSharedInstant() {
  // Use the first row as the canonical instant
  const first = zones[0];
  if (!first) return new Date();
  return fromInputAsInstant(first.datetime.value, first.zoneName);
}

function fromInputAsInstant(inputValue, zone) {
  // input is yyyy-MM-ddTHH:mm; treat as wall time in zone, convert to UTC instant
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
  return sign * (parseInt(m[2]) * 60 + parseInt(m[3]));
}

function paintRow(row, instant) {
  const rec = zones.find(z => z.row === row);
  if (!rec) return;
  const ok = isBusinessHours(instant, rec.zoneName);
  row.classList.toggle("good", ok);
  row.classList.toggle("bad", !ok);
}

function syncRow(row, instant) {
  const rec = zones.find(z => z.row === row);
  if (!rec) return;
  const local = toTimeZone(instant, rec.zoneName);
  rec.datetime.value = formatLocalInput(local, rec.zoneName);
  paintRow(row, instant);
}

function updateURL() {
  const p = new URLSearchParams();
  const first = zones[0];
  if (first) p.set("time", first.datetime.value); // wall time of first zone; fine for sharable permalinks
  p.set("zones", zones.map(z => z.zoneName).join(","));
  history.replaceState(null, "", `?${p.toString()}`);
}
