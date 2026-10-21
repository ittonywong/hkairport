#!/usr/bin/env python3
"""Fetch live Hong Kong International Airport flight info (free, no key) and
write data/flights.json for the static website.

Source: Airport Authority Hong Kong flight information API (DATA.GOV.HK dataset
"aahk-team1-flight-info"):
  https://www.hongkongairport.com/flightinfo-rest/rest/flights/past?date=YYYY-MM-DD&lang=en&cargo=false&arrival=true|false
The API does not send CORS headers for other websites, so the browser cannot read
it directly; this script runs on GitHub Actions (or your own PC) instead.
Python standard library only - nothing to install.
"""
import json, os, sys, time, urllib.request, urllib.error
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from datetime import datetime, timedelta, timezone

HKT = timezone(timedelta(hours=8))
BASE = "https://www.hongkongairport.com/flightinfo-rest/rest"
UA = "Mozilla/5.0 (compatible; hkairport-static-site/1.0; +https://github.com/)"
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
LANGS = ["en", "zh_HK", "zh_CN"]


def get_json(path):
    # The plain URL is cached at HKIA's CDN for up to ~1 hour; a unique query
    # parameter forces a fresh copy (tested 2026-10-18).
    sep = "&" if "?" in path else "?"
    url = f"{BASE}{path}{sep}_={int(time.time() * 1000)}"
    last = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.loads(r.read().decode("utf-8"))
        except (urllib.error.URLError, ValueError, TimeoutError) as e:
            last = e
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"failed {path}: {last}")


def slim(item, arrival):
    f = {
        "t": item.get("time", ""),
        "f": [[x.get("no", ""), x.get("airline", "")] for x in item.get("flight", [])],
        "s": item.get("status", "") or "",
        "p": item.get("origin" if arrival else "destination", []) or [],
        "tm": item.get("terminal", "") or "",
    }
    if arrival:
        f.update(bg=item.get("baggage", "") or "", hl=item.get("hall", "") or "", st=item.get("stand", "") or "")
    else:
        f.update(ai=item.get("aisle", "") or "", g=item.get("gate", "") or "")
    return f


def main():
    now = datetime.now(HKT)
    dates = [(now + timedelta(days=d)).strftime("%Y-%m-%d") for d in (-1, 0, 1)]
    out = {"generatedAt": now.isoformat(timespec="seconds"), "sourceUpdated": {}, "warnings": [],
           "source": "Airport Authority Hong Kong / DATA.GOV.HK", "dep": [], "arr": []}
    seen = {}
    used_air, used_al = set(), set()
    for arrival, key in ((False, "dep"), (True, "arr")):
        for d in dates:
            try:
                days = get_json(f"/flights/past?date={d}&lang=en&cargo=false&arrival={'true' if arrival else 'false'}")
            except Exception as e:  # yesterday/tomorrow are optional, today is required
                if d == dates[1]:
                    print("ERROR today's data unavailable:", e, file=sys.stderr)
                    sys.exit(1)
                out["warnings"].append(f"{key} {d}: {e}")
                continue
            for day in days:
                dd = day.get("date")
                lu = day.get("lastUpdatedTime")
                if lu and (key not in out["sourceUpdated"] or lu > out["sourceUpdated"][key]):
                    out["sourceUpdated"][key] = lu
                for item in day.get("list", []):
                    s = slim(item, arrival)
                    s["d"] = dd
                    ident = (key, dd, s["t"], s["f"][0][0] if s["f"] else "")
                    if ident in seen:  # same flight appears in two queries -> keep the newer copy
                        if (lu or "") >= seen[ident][1]:
                            out[key][seen[ident][0]] = s
                        continue
                    seen[ident] = (len(out[key]), lu or "")
                    out[key].append(s)
                    used_air.update(s["p"])
                    used_al.update(x[1] for x in s["f"])
    for key in ("dep", "arr"):
        out[key].sort(key=lambda x: (x["d"], x["t"]))
    if len([x for x in out["dep"] if x["d"] == dates[1]]) < 50:
        print("ERROR suspiciously few departures today", file=sys.stderr)
        sys.exit(1)

    # Place / airline names in 3 languages (only codes in use, to keep the file small).
    lookups = {"airports": {}, "airlines": {}}
    try:
        for i, lang in enumerate(LANGS):
            for kind, used in (("airports", used_air), ("airlines", used_al)):
                for a in get_json(f"/{kind}?lang={lang}"):
                    c = a.get("code")
                    if c in used:
                        lookups[kind].setdefault(c, ["", "", ""])[i] = (a.get("description") or [""])[0]
        out["names"] = lookups
    except Exception as e:  # names are nice-to-have; keep the previous file's names
        out["warnings"].append(f"names: {e}")
        try:
            with open(os.path.join(OUT_DIR, "flights.json"), encoding="utf-8") as fh:
                out["names"] = json.load(fh).get("names", lookups)
        except Exception:
            out["names"] = lookups

    # v9: aircraft type + registration (adsb.lol, ODbL) - optional, never blocks the flight data
    try:
        import aircraft_match
        prev = aircraft_match.load_prev(os.path.join(OUT_DIR, "flights.json"), os.environ.get("GITHUB_REPOSITORY"))
        aircraft_match.apply(out, prev, now)
    except Exception as e:
        out["warnings"].append(f"aircraft: {e}")

    os.makedirs(OUT_DIR, exist_ok=True)
    tmp = os.path.join(OUT_DIR, "flights.json.tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, os.path.join(OUT_DIR, "flights.json"))
    print(f"OK {out['generatedAt']} dep={len(out['dep'])} arr={len(out['arr'])} "
          f"source={out['sourceUpdated']} warnings={out['warnings']}")


if __name__ == "__main__":
    main()
