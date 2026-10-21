#!/usr/bin/env python3
"""Aircraft type + registration for HKIA flights (v9). Python standard library only.

Source: adsb.lol public API (free, no key; licence ODbL 1.0 - attribution + share-alike).
  https://api.adsb.lol/v2/point/22.308/113.918/12   -> aircraft currently seen within 12 nm of HKIA
  Terms: https://api.adsb.lol/docs ("You can use the API for free"), licence https://www.adsb.lol/docs/privacy-license/
One request per run (the workflow runs every ~5 min = ~288 requests/day). If the API fails, nothing changes.

A value is only kept when the match is confident:
  * the aircraft's broadcast callsign equals the flight's ICAO callsign exactly
    (operating flight: HKIA airline ICAO code + flight number, e.g. CX 542 / CPA -> CPA542 or CPA0542),
  * the aircraft is a real ADS-B transponder (not TIS-B/MLAT-only "~" addresses) with a registration and type in the database,
  * the timing is plausible for that flight (departure around boarding/taxi/just after take-off,
    arrival on approach or just landed), and only ONE flight in the 3-day list fits.
Anything else -> no value (the website shows "no data").
Matches are carried over from the previously published flights.json (cache), so a flight keeps its
aircraft after the plane leaves radar range. hex -> registration/type is cached the same way.
"""
import json, re, time, urllib.request
from datetime import datetime, timedelta, timezone

HKT = timezone(timedelta(hours=8))
POINT = "https://api.adsb.lol/v2/point/22.308/113.918/12"
UA = "hkairport-static-site/1.0 (non-commercial public flight board; GitHub Actions every 5 min)"
CS_RE = re.compile(r"^[A-Z]{3}[0-9]{1,4}[A-Z]?$")


def fetch_aircraft(timeout=25):
    req = urllib.request.Request(POINT, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def callsigns(flight):
    """ICAO callsigns for the operating flight (first entry): ('CX 542','CPA') -> {'CPA542'}; ('CX 019','CPA') -> {'CPA19','CPA019'}"""
    if not flight.get("f"):
        return set()
    no, icao = flight["f"][0][0], flight["f"][0][1]
    m = re.match(r"^[A-Z0-9]{2}\s*0*([0-9]{1,4})([A-Z]?)$", no.strip().upper())
    if not m or not re.match(r"^[A-Z]{3}$", icao or ""):
        return set()
    digits, suf = m.group(1), m.group(2)
    raw = re.sub(r"^[A-Z0-9]{2}\s*", "", no.strip().upper())
    return {icao + digits + suf, icao + raw}


def _t(d, hm):
    try:
        return datetime.strptime(d + " " + hm, "%Y-%m-%d %H:%M").replace(tzinfo=HKT)
    except Exception:
        return None


STATUS_TIME = re.compile(r"^(Dep|Est at|At gate|Landed)\s+(\d{1,2}:\d{2})(?:\s*\((\d{2})/(\d{2})/(\d{4})\))?", re.I)


def status_time(f):
    m = STATUS_TIME.match(f.get("s") or "")
    if not m:
        return None, None
    kind = m.group(1).lower()
    if m.group(3):
        t = _t(f"{m.group(5)}-{m.group(4)}-{m.group(3)}", m.group(2))
    else:
        t = _t(f["d"], m.group(2))
        sched = _t(f["d"], f["t"])
        if t and sched and t < sched - timedelta(hours=6):
            t += timedelta(days=1)
    return kind, t


def plausible(f, arrival, now, ac):
    """Is it believable that this aircraft (seen now near HKIA) operates this flight right now?"""
    sched = _t(f["d"], f["t"])
    if not sched:
        return False
    s = (f.get("s") or "").lower()
    kind, st = status_time(f)
    on_ground = ac.get("alt_baro") == "ground"
    alt = 0 if on_ground else (ac.get("alt_baro") if isinstance(ac.get("alt_baro"), (int, float)) else 99999)
    if s.startswith("cancel") or s.startswith("divert"):
        return False
    if not arrival:
        if kind == "dep":  # just departed: still climbing out near the airport
            return st is not None and now - timedelta(minutes=25) <= st <= now + timedelta(minutes=5) and alt < 15000
        best = st if (kind == "est" and st) else sched
        # at the gate / taxiing out: from 2 h before to 1.5 h after the (expected) departure time, on the ground
        return on_ground and best - timedelta(hours=2) <= now <= best + timedelta(minutes=90)
    if kind in ("landed", "at gate"):  # just landed / taxiing in / parked
        return st is not None and st - timedelta(minutes=10) <= now <= st + timedelta(minutes=45) and alt < 3000
    best = st if (kind == "est" and st) else sched
    # on approach: up to 45 min before and 30 min after the expected arrival time, airborne low
    return (not on_ground) and alt < 20000 and best - timedelta(minutes=45) <= now <= best + timedelta(minutes=30)


def fkey(kind, f):
    return f"{kind}|{f['d']}|{f['t']}|{f['f'][0][0] if f.get('f') else ''}"


def apply(out, prev, now=None, data=None, log=print):
    """Add f['ac'] = [registration, icao_type, hex] to confident matches in out['dep'] / out['arr']."""
    now = now or datetime.now(HKT)
    stats = {"seen": 0, "withCallsign": 0, "matchedNow": 0, "ambiguous": 0, "carried": 0, "conflicts": 0}
    # --- cache from the previously published file
    cache, hexdb = {}, {}
    for kind in ("dep", "arr"):
        for f in (prev or {}).get(kind, []):
            if f.get("ac") and f.get("f"):
                a = list(f["ac"])
                if re.match(r"^B[0-9]{5}$", a[0] or ""):
                    a[0] = "B-" + a[0][1:]
                cache[fkey(kind, f)] = a
    for h, v in ((prev or {}).get("aircraftDb") or {}).items():
        hexdb[h] = v
    # --- live snapshot
    found = {}
    try:
        data = data if data is not None else fetch_aircraft()
        acs = data.get("ac") or []
    except Exception as e:
        out.setdefault("warnings", []).append(f"aircraft: {e}")
        acs = []
    index = {}
    for kind, arrival in (("dep", False), ("arr", True)):
        for f in out[kind]:
            for c in callsigns(f):
                index.setdefault(c, []).append((kind, arrival, f))
    for ac in acs:
        stats["seen"] += 1
        h = (ac.get("hex") or "").lower()
        cs = (ac.get("flight") or "").strip().upper()
        if not cs:
            continue
        stats["withCallsign"] += 1
        if not CS_RE.match(cs) or not re.match(r"^[0-9a-f]{6}$", h) or ac.get("type") not in ("adsb_icao", "adsr_icao", "mode_s"):
            continue
        reg, typ = (ac.get("r") or "").strip().upper(), (ac.get("t") or "").strip().upper()
        if re.match(r"^B[0-9]{5}$", reg):  # Taiwan registrations are written B-12345 (format only, no guessing)
            reg = "B-" + reg[1:]
        if not reg or not typ:
            if h in hexdb:
                reg, typ = hexdb[h][0], hexdb[h][1]
            else:
                continue
        if (ac.get("seen") or 0) > 120:
            continue
        hexdb[h] = [reg, typ, now.strftime("%Y-%m-%d")]
        cands = [(k, f) for k, arr, f in index.get(cs, []) if plausible(f, arr, now, ac)]
        if len(cands) != 1:
            if cands:
                stats["ambiguous"] += 1
            continue
        k, f = cands[0]
        key = fkey(k, f)
        if key in found and found[key][2] != h:  # two transponders claim one flight -> trust neither
            found[key] = None
            continue
        found[key] = [reg, typ, h]
    # --- write results: live match first, then cache; disagreeing live vs cache -> drop (never guess)
    for kind in ("dep", "arr"):
        for f in out[kind]:
            if not f.get("f"):
                continue
            key = fkey(kind, f)
            live, old = found.get(key), cache.get(key)
            if live and old and old[2] != live[2]:
                stats["conflicts"] += 1
                continue
            if live:
                f["ac"] = live
                stats["matchedNow"] += 1
            elif old and key not in found:
                f["ac"] = old
                stats["carried"] += 1
    # keep the hex cache small: only aircraft seen in the last 3 days
    cutoff = (now - timedelta(days=3)).strftime("%Y-%m-%d")
    out["aircraftDb"] = {h: v for h, v in hexdb.items() if len(v) > 2 and v[2] >= cutoff}
    out["aircraftSource"] = {"name": "adsb.lol", "url": "https://adsb.lol", "licence": "ODbL 1.0",
                             "licenceUrl": "https://opendatacommons.org/licenses/odbl/1-0/", "checkedAt": now.isoformat(timespec="seconds"), "stats": stats}
    log(f"aircraft: {stats}")
    return stats


def load_prev(local_path, repo=None, timeout=20):
    """Previous published flights.json: GitHub Pages copy (in Actions) else the local file."""
    if repo and "/" in repo:
        owner, name = repo.split("/", 1)
        url = f"https://{owner.lower()}.github.io/{name}/data/flights.json?t={int(time.time())}"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception:
            pass
    try:
        with open(local_path, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return None
