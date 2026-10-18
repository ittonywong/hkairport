// 後備方案 Alternative: Cloudflare Worker (free plan) that builds the same flights.json
// on demand and adds CORS headers. Deploy: Cloudflare dashboard > Workers & Pages >
// Create > Hello World > paste this file > Deploy. Then set dataUrl in assets/config.js to
// https://<worker-name>.<account>.workers.dev/flights.json
// No API key / secret is needed; HKIA open data is public.
const BASE = "https://www.hongkongairport.com/flightinfo-rest/rest";
const LANGS = ["en", "zh_HK", "zh_CN"];
const CACHE_SEC = 60;

async function getJson(path) {
  const url = `${BASE}${path}${path.includes("?") ? "&" : "?"}_=${Date.now()}`; // bypass stale CDN copy
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "hkairport-worker/1.0", Accept: "application/json" } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } catch (e) { last = e; }
  }
  throw new Error(`failed ${path}: ${last}`);
}

function hktIso(ms) {
  return new Date(ms + 8 * 3600e3).toISOString().slice(0, 19) + "+08:00";
}

function slim(it, arrival) {
  const f = { t: it.time || "", f: (it.flight || []).map(x => [x.no || "", x.airline || ""]), s: it.status || "",
    p: (arrival ? it.origin : it.destination) || [], tm: it.terminal || "" };
  if (arrival) Object.assign(f, { bg: it.baggage || "", hl: it.hall || "", st: it.stand || "" });
  else Object.assign(f, { ai: it.aisle || "", g: it.gate || "" });
  return f;
}

export async function buildFlights() {
  const now = Date.now();
  const dates = [-1, 0, 1].map(d => hktIso(now + d * 864e5).slice(0, 10));
  const out = { generatedAt: hktIso(now), sourceUpdated: {}, warnings: [], source: "Airport Authority Hong Kong / DATA.GOV.HK", dep: [], arr: [] };
  const usedAir = new Set(), usedAl = new Set(), seen = new Map();
  const jobs = [];
  for (const [arrival, key] of [[false, "dep"], [true, "arr"]])
    for (const d of dates) jobs.push(getJson(`/flights/past?date=${d}&lang=en&cargo=false&arrival=${arrival}`)
      .then(days => ({ key, arrival, d, days }), e => ({ key, arrival, d, err: e })));
  for (const { key, arrival, d, days, err } of await Promise.all(jobs)) {
    if (err) { if (d === dates[1]) throw err; out.warnings.push(`${key} ${d}: ${err}`); continue; }
    for (const day of days) {
      const lu = day.lastUpdatedTime || "";
      if (lu && (!out.sourceUpdated[key] || lu > out.sourceUpdated[key])) out.sourceUpdated[key] = lu;
      for (const it of day.list || []) {
        const s = slim(it, arrival); s.d = day.date;
        const id = [key, s.d, s.t, s.f[0] ? s.f[0][0] : ""].join("|");
        if (seen.has(id)) { const [i, l] = seen.get(id); if (lu >= l) out[key][i] = s; continue; }
        seen.set(id, [out[key].length, lu]); out[key].push(s);
        s.p.forEach(c => usedAir.add(c)); s.f.forEach(x => usedAl.add(x[1]));
      }
    }
  }
  for (const k of ["dep", "arr"]) out[k].sort((a, b) => (a.d + a.t).localeCompare(b.d + b.t));
  const names = { airports: {}, airlines: {} };
  try {
    const lists = await Promise.all(LANGS.flatMap(l => ["airports", "airlines"].map(k => getJson(`/${k}?lang=${l}`).then(v => [l, k, v]))));
    for (const [l, k, v] of lists) {
      const used = k === "airports" ? usedAir : usedAl, i = LANGS.indexOf(l);
      for (const a of v) if (used.has(a.code)) (names[k][a.code] ||= ["", "", ""])[i] = (a.description || [""])[0];
    }
  } catch (e) { out.warnings.push("names: " + e); }
  out.names = names;
  return out;
}

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" };

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    if (url.pathname !== "/flights.json") return new Response("Not found", { status: 404, headers: CORS });
    const cache = typeof caches !== "undefined" ? caches.default : null;
    const key = new Request(url.origin + "/flights.json");
    if (cache) { const hit = await cache.match(key); if (hit) return hit; }
    try {
      const body = JSON.stringify(await buildFlights());
      const res = new Response(body, { headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": `public, max-age=${CACHE_SEC}` } });
      if (cache && ctx) ctx.waitUntil(cache.put(key, res.clone()));
      return res;
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: { ...CORS, "Content-Type": "application/json" } });
    }
  }
};
