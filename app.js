import {
  toTimeZone, formatLocalInput, isBusinessHours,
  normalize, tokensOrderedMatch, isValidDateTimeLocal, zoneOffsetLabel
} from "./utils.js";

/* Defaults shown on first load:
   - Gold Coast (Australia/Brisbane)
   - Pacific Time, PT (America/Los_Angeles)
   - San Francisco (America/Los_Angeles)  // same zone, different label
*/
const DEFAULTS = [
  { zone:"Australia/Brisbane", label:"Gold Coast" },
  { zone:"America/Los_Angeles", label:"Pacific Time, PT" },
  { zone:"America/Los_Angeles", label:"San Francisco" },
];

// DOM
const zoneContainer = document.getElementById("zones");
const inputEl = document.getElementById("zone-input");
const datalistEl = document.getElementById("tzlist");
const addBtn = document.getElementById("add-zone");
const removeAllBtn = document.getElementById("remove-all");
const sortSelect = document.getElementById("sort-select");
const linkMode = document.getElementById("permalink-mode");
const linkBox = document.getElementById("permalink-url");
const copyBtn = document.getElementById("copy-link");
const dlg = document.getElementById("edit-dialog");
const dlgCity = document.getElementById("edit-city");
const dlgFace = document.getElementById("edit-face");
const dlgDate = document.getElementById("edit-date");
const dlgTime = document.getElementById("edit-time");
const dlgClose = document.getElementById("edit-close");
const dlgApply = document.getElementById("edit-apply");

// BG canvases (Trianglify) as before
const triA = document.getElementById("tri-a"), triB = document.getElementById("tri-b");
let activeCanvas = triA, nextCanvas = triB;

// State
let zones = [];           // [{ row, cityBlock, cityA, meta, timeBtn, face, removeBtn, zoneName, display, flag, country }]
let tzData = [];          // from json
let tzIndex = null;
let sharedInstant = null;
let sortMode = "custom";

// ---- Trianglify (same as previous message) ----
const palettes = [
  ["#0f172a","#1e293b","#334155","#0ea5e9","#22d3ee"],
  ["#0b1324","#1b3a4b","#2e5c6e","#34d399","#22d3ee"],
  ["#10002b","#240046","#3c096c","#5a189a","#00d4ff"],
  ["#0a0f1f","#14213d","#1f2937","#3b82f6","#a78bfa"]
];
let paletteIndex = 0;
function sizeCanvas(c){const dpr=Math.max(1,Math.min(2,devicePixelRatio||1));c.width=Math.floor(innerWidth*dpr);c.height=Math.floor(innerHeight*dpr);c.style.width="100vw";c.style.height="100vh";}
function renderTri(c,colors){ if(!window.trianglify) return; sizeCanvas(c);
  const pattern = window.trianglify({ width:c.width, height:c.height, cellSize:90+Math.random()*40, variance:.75, seed:Math.floor(Math.random()*1e9), xColors:colors, colorFunction:window.trianglify.colorFunctions.interpolateLinear(colors) });
  const ctx=c.getContext("2d"); ctx.clearRect(0,0,c.width,c.height); pattern.toCanvas(c);
}
function swapLayers(){ paletteIndex=(paletteIndex+1)%palettes.length; renderTri(nextCanvas,palettes[paletteIndex]);
  nextCanvas.classList.toggle("drift-a", Math.random()>0.5); nextCanvas.classList.toggle("drift-b", !nextCanvas.classList.contains("drift-a"));
  nextCanvas.classList.add("active"); activeCanvas.classList.remove("active"); [activeCanvas,nextCanvas]=[nextCanvas,activeCanvas]; }
function startBg(){ renderTri(activeCanvas,palettes[paletteIndex]); activeCanvas.classList.add("active","drift-a");
  paletteIndex=(paletteIndex+1)%palettes.length; renderTri(nextCanvas,palettes[paletteIndex]); nextCanvas.classList.add("drift-b"); setInterval(swapLayers,10000); }
addEventListener("resize",()=>{sizeCanvas(activeCanvas);sizeCanvas(nextCanvas);renderTri(activeCanvas,palettes[paletteIndex]);});

// ---- Boot ----
(async function init(){
  startBg();
  await loadTZ();

  // Params
  const params = new URLSearchParams(location.search);
  const zonesParam = params.get("zones");
  const timeParam  = params.get("time");

  const startup = [];
  if (zonesParam){
    zonesParam.split(",").filter(Boolean).forEach(z => startup.push({zone:z, label: (tzIndex.byZone.get(z)?.label || z)}));
  }else{
    startup.push(...DEFAULTS);
  }

  // shared instant
  const firstZone = startup[0]?.zone || DEFAULTS[0].zone;
  sharedInstant = timeParam ? (timeParam.endsWith("Z")? new Date(timeParam) : parseWallAsInstant(timeParam, firstZone)) : new Date();

  // build rows
  startup.forEach(o => addZone(o.zone, sharedInstant, o.label));
  paintAll();
  refreshPermalink();

  // suggestions
  inputEl.addEventListener("focus", ()=> renderSuggestions(suggest("", 25)));
  inputEl.addEventListener("input", ()=> renderSuggestions(suggest(inputEl.value.trim(), 50)));

  // add
  addBtn.addEventListener("click", ()=>{
    const raw = inputEl.value.trim();
    if (!raw) return;
    const byLabel = tzIndex.byLabel.get(normalize(raw)) || tzIndex.byAlias.get(normalize(raw));
    const zone = resolveToZone(raw) || raw;
    const preferred = byLabel?.label || raw;  // preserve user intent
    if (zones.some(z => z.zoneName === zone && z.display === preferred)) { inputEl.value=""; return; }
    addZone(zone, sharedInstant, preferred);
    inputEl.value = ""; updateURL(); refreshPermalink();
  });

  // remove all
  removeAllBtn.addEventListener("click", ()=>{
    zoneContainer.innerHTML = ""; zones = []; updateURL(); refreshPermalink();
  });

  // sort
  sortSelect.addEventListener("change", ()=>{ sortMode = sortSelect.value; reorderZones(); });

  // permalink
  linkMode.addEventListener("change", refreshPermalink);
  copyBtn.addEventListener("click", ()=>{
    linkBox.select(); document.execCommand?.("copy"); navigator.clipboard?.writeText(linkBox.value);
  });

  // modal
  dlgClose.addEventListener("click", ()=> dlg.close());
  dlg.addEventListener("cancel", e=> e.preventDefault());
  dlgApply.addEventListener("click", e=>{
    e.preventDefault();
    if (!dlgDate.value || !dlgTime.value) return;
    const target = dlg._targetRow;
    const wall = `${dlgDate.value}T${dlgTime.value}`;
    sharedInstant = parseWallAsInstant(wall, target.zoneName);
    paintAll(); updateURL(); refreshPermalink(); dlg.close();
  });
})();

// ----- suggestions -----
function renderSuggestions(list){
  datalistEl.innerHTML = "";
  list.forEach(opt => {
    const o = document.createElement("option");
    o.value = opt.label; o.label = `${opt.label} — ${opt.zone}`;
    datalistEl.appendChild(o);
  });
}

// ----- data -----
async function loadTZ(){
  try{
    const res = await fetch("timezones.json", {cache:"no-store"});
    if (!res.ok) throw new Error();
    tzData = await res.json();
  }catch{
    tzData = [
      { label:"Gold Coast", zone:"Australia/Brisbane", country:"Australia", flag:"🇦🇺" },
      { label:"Pacific Time, PT", zone:"America/Los_Angeles", country:"USA", flag:"🌐" },
      { label:"San Francisco", zone:"America/Los_Angeles", country:"USA", flag:"🇺🇸" }
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

// ----- resolve/suggest -----
function resolveToZone(input){
  if (!input) return null;
  const q = normalize(input);
  if (tzIndex.byLabel.has(q)) return tzIndex.byLabel.get(q).zone;
  if (tzIndex.byAlias.has(q)) return tzIndex.byAlias.get(q).zone;
  if (tzIndex.byZone.has(input)) return input;
  const tokens = q.split(" ");
  const best = tzData
    .map(rec => {
      const hay = normalize([rec.label, rec.zone, rec.country||"", ...(rec.aliases||[])].join(" "));
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
      const hay = normalize([rec.label, rec.zone, rec.country||"", ...(rec.aliases||[])].join(" "));
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
function addZone(zoneName, instant, preferredLabel){
  const base = tzIndex.byZone.get(zoneName) || { label: zoneName, country: zoneName.split("/")[0], flag:"🌐" };
  const display = preferredLabel || base.label;

  const row = document.createElement("div");
  row.className = "zone-row";

  const dragdot = document.createElement("span"); dragdot.textContent="⋮⋮"; dragdot.className="dragdot";
  const flag = document.createElement("span"); flag.textContent = base.flag || "🌐"; flag.className="flag";

  const cityBlock = document.createElement("div"); cityBlock.className="city-block";
  const cityA = document.createElement("a"); cityA.className="city"; cityA.href="#"; cityA.textContent = display;
  const meta = document.createElement("span"); meta.className="meta";
  cityBlock.append(cityA, meta);

  const timeBtn = document.createElement("button"); timeBtn.className="time-box"; timeBtn.title="";
  const face = document.createElement("span"); face.className="face"; face.textContent="🙂";
  const removeBtn = document.createElement("button"); removeBtn.className="remove"; removeBtn.textContent="×";

  row.append(dragdot, flag, cityBlock, timeBtn, face, removeBtn);
  zoneContainer.appendChild(row);

  const record = {
    row, cityBlock, cityA, meta, timeBtn, face, removeBtn,
    zoneName, display, flag: base.flag || "🌐", country: base.country || zoneName.split("/")[0]
  };
  zones.push(record);

  cityA.addEventListener("click", (e)=>{ e.preventDefault(); openEdit(record); });
  timeBtn.addEventListener("click", ()=> openEdit(record));
  removeBtn.addEventListener("click", ()=>{ row.remove(); zones = zones.filter(z => z !== record); updateURL(); refreshPermalink(); });

  paintRow(record, instant);
}

function paintRow(rec, instant){
  const off = zoneOffsetLabel(instant, rec.zoneName);
  rec.meta.textContent = `${rec.country} • ${off}`;

  const local = toTimeZone(instant, rec.zoneName);
  const timeOnly = new Intl.DateTimeFormat(undefined, { hour:"numeric", minute:"2-digit", hour12:true, timeZone: rec.zoneName}).format(local);
  rec.timeBtn.textContent = timeOnly;

  const bh = isBusinessHours(instant, rec.zoneName); // "good" | "neutral" | "bad"
  rec.row.classList.remove("good","neutral","bad"); rec.row.classList.add(bh);
  rec.timeBtn.title = (bh==="good") ? "General working hours" : (bh==="neutral" ? "Should be OK for some" : "General non-working hours");
  rec.face.textContent = (bh==="good") ? "🙂" : (bh==="neutral" ? "😐" : "☹");

  // update URL from first row's wall time (readable)
  if (zones[0] === rec){
    const parts = new Intl.DateTimeFormat("en-CA", {timeZone:rec.zoneName, hour12:false, year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit"}).formatToParts(local).reduce((a,p)=>{if(p.type!=="literal")a[p.type]=p.value; return a;}, {});
    const wall = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
    const p = new URLSearchParams(); p.set("time", wall); p.set("zones", zones.map(z=>z.zoneName).join(","));
    history.replaceState(null,"",`?${p.toString()}`);
  }
}

function paintAll(){ zones.forEach(z => paintRow(z, sharedInstant)); reorderZones(false); refreshPermalink(); }

// ----- modal -----
function openEdit(rec){
  const local = toTimeZone(sharedInstant, rec.zoneName);
  const y = local.getFullYear(), mm=String(local.getMonth()+1).padStart(2,"0"), dd=String(local.getDate()).padStart(2,"0");
  const HH = String(local.getHours()).padStart(2,"0"), MM = String(local.getMinutes()).padStart(2,"0");
  dlgCity.textContent = rec.display;
  const mood = isBusinessHours(sharedInstant, rec.zoneName); dlgFace.textContent = (mood==="good")?"🙂":(mood==="neutral"?"😐":"☹");
  dlgDate.value = `${y}-${mm}-${dd}`; dlgTime.value = `${HH}:${MM}`;
  dlg._targetRow = rec; dlg.showModal();
}

// ----- sort / reorder -----
function reorderZones(applyMode=true){
  if (applyMode) sortMode = sortSelect.value;
  const arr = zones.slice();
  let compare = null;

  const byCityAsc = (a,b)=> a.display.localeCompare(b.display);
  const byCityDesc = (a,b)=> b.display.localeCompare(a.display);
  const byCountryAsc = (a,b)=> (a.country||"").localeCompare(b.country||"") || a.display.localeCompare(b.display);
  const byCountryDesc = (a,b)=> (b.country||"").localeCompare(a.country||"") || a.display.localeCompare(b.display);
  const byTimeAsc = (a,b)=> toTimeZone(sharedInstant, a.zoneName) - toTimeZone(sharedInstant, b.zoneName);
  const byTimeDesc = (a,b)=> -byTimeAsc(a,b);

  if (sortMode==="city-asc") compare = byCityAsc;
  else if (sortMode==="city-desc") compare = byCityDesc;
  else if (sortMode==="country-asc") compare = byCountryAsc;
  else if (sortMode==="country-desc") compare = byCountryDesc;
  else if (sortMode==="time-asc") compare = byTimeAsc;
  else if (sortMode==="time-desc") compare = byTimeDesc;

  if (compare){
    arr.sort(compare);
    arr.forEach(r => zoneContainer.appendChild(r.row));
    zones = arr;
  }
}

// ----- permalink -----
function refreshPermalink(){
  const mode = linkMode.value;
  const baseInstant = (mode==="now") ? new Date() : sharedInstant;
  const first = zones[0];
  if (first){
    const inFirst = toTimeZone(baseInstant, first.zoneName);
    const y=inFirst.getFullYear(), mm=String(inFirst.getMonth()+1).padStart(2,"0"), dd=String(inFirst.getDate()).padStart(2,"0");
    const HH=String(inFirst.getHours()).padStart(2,"0"), MM=String(inFirst.getMinutes()).padStart(2,"0");
    const wall = `${y}-${mm}-${dd}T${HH}:${MM}`;
    const p = new URLSearchParams(); p.set("time", wall); p.set("zones", zones.map(z=>z.zoneName).join(","));
    linkBox.value = `${location.origin}${location.pathname}?${p.toString()}`;
  }else{
    linkBox.value = `${location.origin}${location.pathname}`;
  }
}

// ----- helpers -----
function parseWallAsInstant(inputValue, zone){
  const [d,t]=inputValue.split("T"); const [y,m,dd]=d.split("-").map(Number); const [H,Min]=t.split(":").map(Number);
  const approxUTC = new Date(Date.UTC(y, m-1, dd, H, Min));
  const off = getOffsetMinutes(approxUTC, zone);
  return new Date(approxUTC.getTime() - off*60000);
}
function getOffsetMinutes(dateUTC, zone){
  const parts = new Intl.DateTimeFormat("en", { timeZone: zone, timeZoneName: "shortOffset" }).formatToParts(dateUTC);
  const v = parts.find(p => p.type==="timeZoneName")?.value || "UTC+00:00";
  const m = v.match(/([+-])(\d{2}):?(\d{2})/); if(!m) return 0; const s = (m[1]==="+")?1:-1;
  return s*(parseInt(m[2],10)*60 + parseInt(m[3],10));
}
