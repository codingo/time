/* script.js — self-hosted time converter
   - Defaults: Gold Coast, San Francisco, New Hampshire
   - ?time=YYYY-MM-DDTHH:mm&zones=Zone/A,Zone/B,...
   - Sort: city asc/desc, offset asc/desc
   - Row click on time/city → edit inline via native prompt
*/

/* ---------- DOM ---------- */
const list      = document.getElementById('timezones');
const input     = document.getElementById('timezone-input');
const addBtn    = document.getElementById('add-timezone');
const rmAllBtn  = document.getElementById('remove-all');
const sortSel   = document.getElementById('sort-select');
const useSelBtn = document.getElementById('use-selected-time');
const linkBox   = document.getElementById('share-link');
const copyBtn   = document.getElementById('copy-link');

/* ---------- Aliases / Search ---------- */
/* Lightweight alias map so users can type “San Fr”, “PT”, etc. */
const ALIASES = [
  { label:"Gold Coast",      zone:"Australia/Brisbane", country:"Australia" },
  { label:"Sydney",          zone:"Australia/Sydney",   country:"Australia" },
  { label:"San Francisco",   zone:"America/Los_Angeles", country:"USA", aliases:["SF","San Fran","San Fr","Bay Area","PT","PST","PDT","Pacific Time"] },
  { label:"Pacific Time, PT",zone:"America/Los_Angeles", country:"USA", aliases:["PT","PDT","PST","Pacific Time"] },
  { label:"New Hampshire",   zone:"America/New_York",    country:"USA", aliases:["NH","Eastern","ET","EST","EDT","Boston","NYC"] },
  { label:"London",          zone:"Europe/London",      country:"UK",  aliases:["GMT","BST"] },
  { label:"Tokyo",           zone:"Asia/Tokyo",         country:"Japan", aliases:["JST"] },
  { label:"Singapore",       zone:"Asia/Singapore",     country:"Singapore", aliases:["SGT","SG"] },
  { label:"UTC",             zone:"UTC",                country:"—", aliases:["Zulu","GMT","Z"] },
];
const norm = s => s.toLowerCase().replace(/[_/,-]/g,' ').replace(/\s+/g,' ').trim();
function resolveZone(text){
  if (!text) return null;
  // exact by label or alias
  const q = norm(text);
  for (const r of ALIASES){
    if (norm(r.label) === q) return {zone:r.zone, label:r.label, country:r.country};
    if ((r.aliases||[]).some(a => norm(a) === q)) return {zone:r.zone, label:r.label, country:r.country};
  }
  // direct IANA
  if (/^[A-Za-z_]+\/[A-Za-z_]+/.test(text)) return {zone:text, label:text.split('/')[1].replace(/_/g,' '), country:text.split('/')[0]};
  // fuzzy (ordered token containment)
  const toks = q.split(' ');
  const cand = ALIASES
    .map(r=>{
      const hay = norm([r.label,r.zone,(r.aliases||[]).join(' ')].join(' '));
      let score = Infinity;
      if (hay.startsWith(q)) score = 0;
      else if (toks.every(t=> hay.includes(t))) score = 1;
      return {r,score};
    })
    .filter(x=>x.score!==Infinity)
    .sort((a,b)=> a.score-b.score || a.r.label.localeCompare(b.r.label))[0];
  if (cand) return {zone:cand.r.zone, label:cand.r.label, country:cand.r.country};
  return null;
}

/* ---------- Time helpers ---------- */
function toTimeZone(date, zone){
  const p = new Intl.DateTimeFormat("en-CA",{
    timeZone:zone,hour12:false,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"
  })
