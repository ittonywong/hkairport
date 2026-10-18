(function () {
  "use strict";
  var CFG = window.HKA_CONFIG || {}, I = window.I18N, JK = window.PLACE_JA_KO || {};
  var REFRESH = CFG.refreshSec || 60, FS = [14, 16, 19];
  var $ = function (id) { return document.getElementById(id); };
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem("hka." + k); return v === null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem("hka." + k, v); } catch (e) {} }
  };
  function pickLang() {
    var s = store.get("lang", null); if (s && I[s]) return s;
    var n = (navigator.language || "").toLowerCase();
    if (/^zh-(cn|sg|hans)/.test(n)) return "zh-Hans";
    if (/^zh/.test(n)) return "zh-Hant";
    if (/^ja/.test(n)) return "ja"; if (/^ko/.test(n)) return "ko"; if (/^mi/.test(n)) return "mi";
    return "zh-Hant"; // default for HK users (English phones too); can switch any time
  }
  var S = { lang: pickLang(), fs: +store.get("fs", 1), tab: store.get("tab", "dep"), q: "", gate: "", showEarlier: false,
            limit: 100, data: null, loadedAt: null, loads: 0, error: null, left: REFRESH };
  if (!(S.fs >= 0 && S.fs <= 2)) S.fs = 1;
  if (S.tab !== "arr") S.tab = "dep";
  var T = function () { return I[S.lang]; };
  var fmt = function (s, o) { return s.replace(/\{(\w+)\}/g, function (_, k) { return o[k]; }); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }); };
  var hkParts = function (ms) {
    var d = new Date(ms + 8 * 3600e3);
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return { ymd: d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()), hm: p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()),
             hms: p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds()), dm: p(d.getUTCDate()) + "/" + p(d.getUTCMonth() + 1) };
  };
  var at = function (ymd, hm) { return Date.parse(ymd + "T" + hm + ":00+08:00"); };

  // ---- status parsing (API status is requested in English) ----
  var TIMED = /^(Dep|Est at|At gate|Landed)\s+(\d{1,2}:\d{2})(?:\s*\((\d{2})\/(\d{2})\/(\d{4})\))?/i;
  var WORDS = [["boarding soon", "boardingSoon"], ["boarding", "boarding"], ["final call", "finalCall"], ["gate closed", "gateClosed"],
               ["cancel", "cancelled"], ["delay", "delayed"], ["divert", "diverted"], ["landed", "landed"], ["dep", "departed"]];
  function parseStatus(s, ymd, sched) {
    s = (s || "").trim();
    if (!s) return { kind: "scheduled" };
    var m = s.match(TIMED);
    if (m) {
      var k = { "dep": "departed", "est at": "est", "at gate": "atGate", "landed": "landed" }[m[1].toLowerCase()];
      var hm = m[2].length === 4 ? "0" + m[2] : m[2];
      var ms = m[3] ? at(m[5] + "-" + m[4] + "-" + m[3], hm) : at(ymd, hm);
      if (!m[3] && ms < sched - 6 * 3600e3) ms += 864e5;
      return { kind: k, ms: ms };
    }
    var low = s.toLowerCase();
    for (var i = 0; i < WORDS.length; i++) if (low.indexOf(WORDS[i][0]) === 0) return { kind: WORDS[i][1] };
    return { kind: "other", raw: s };
  }
  var DONE = { departed: 1, atGate: 1, landed: 1, cancelled: 1, diverted: 1 };

  function build(list, arr) {
    return list.map(function (f) {
      var sched = at(f.d, f.t), st = parseStatus(f.s, f.d, sched);
      var delay = st.ms ? Math.round((st.ms - sched) / 60000) : 0;
      return { raw: f, arr: arr, sched: sched, st: st, delay: delay, best: st.ms || sched,
               nos: f.f.map(function (x) { return x[0]; }), als: f.f.map(function (x) { return x[1]; }) };
    }).sort(function (a, b) { return a.sched - b.sched || (a.nos[0] < b.nos[0] ? -1 : 1); });
  }

  function placeName(code) {
    var n = (S.data && S.data.names && S.data.names.airports[code]) || [];
    var en = n[0] || code;
    switch (S.lang) {
      case "zh-Hant": return n[1] || en;
      case "zh-Hans": return n[2] || n[1] || en;
      case "ja": return (JK[code] && JK[code][0]) || en;
      case "ko": return (JK[code] && JK[code][1]) || en;
      default: return en;
    }
  }
  function airlineName(code) {
    var n = (S.data && S.data.names && S.data.names.airlines[code]) || [];
    if (S.lang === "zh-Hant") return n[1] || n[0] || code;
    if (S.lang === "zh-Hans") return n[2] || n[1] || n[0] || code;
    return n[0] || code;
  }
  function allNames(kind, code) {
    var n = (S.data && S.data.names && S.data.names[kind][code]) || [];
    var extra = kind === "airports" && JK[code] ? JK[code] : [];
    return n.concat(extra).join(" ").toLowerCase();
  }

  var GATE_RE = /^(?:gate|g|閘口|闸口|登機口|登机口|搭乗口|탑승구|kuaha)\s*(\d+[a-z]?)$/i;
  function matches(x, q, placeOnly) {
    if (!q) return true;
    var r = x.raw, qq = q.replace(/\s+/g, "").toUpperCase(), ql = q.trim().toLowerCase();
    var gm = q.trim().match(GATE_RE);
    if (gm) return !x.arr && r.g.toUpperCase() === gm[1].toUpperCase();
    if (/^\d{1,4}$/.test(qq)) {
      if (!x.arr && r.g === qq) return true;
      if (x.arr && r.bg === qq) return true;
      var n = +qq;
      return x.nos.some(function (no) { var d = no.replace(/\D/g, ""); return d && +d === n; });
    }
    var fm = qq.match(/^([A-Z0-9]{2})(\d{1,4})([A-Z]?)$/);
    if (fm && /[A-Z]/.test(fm[1])) { // full flight number, e.g. CX880 / cx 0880 -> exact match (incl. codeshares)
      if (x.nos.some(function (no) { var m = no.replace(/\s+/g, "").toUpperCase().match(/^([A-Z0-9]{2})(\d+)([A-Z]?)$/);
        return m && m[1] === fm[1] && +m[2] === +fm[2] && (!fm[3] || m[3] === fm[3]); })) return true;
    } else if (x.nos.some(function (no) { return no.replace(/\s+/g, "").toUpperCase().indexOf(qq) === 0; })) return true;
    if (r.p.some(function (c) { return c.toUpperCase() === qq || allNames("airports", c).indexOf(ql) >= 0; })) return true;
    if (!placeOnly && x.als.some(function (c) { return c === qq || allNames("airlines", c).indexOf(ql) >= 0; })) return true;
    return false;
  }

  function isPast(x, now) {
    var lim = now - (CFG.earlierMin || 60) * 60000;
    if (DONE[x.st.kind]) return x.best < lim;
    return x.best < now - 6 * 3600e3;
  }

  function card(x, now, today) {
    var t = T(), r = x.raw, k = x.st.kind;
    var big = x.st.ms ? hkParts(x.st.ms) : hkParts(x.sched), sch = hkParts(x.sched);
    var timeHtml = '<div class="big">' + big.hm + "</div>";
    if (x.st.ms && (big.hm !== sch.hm || big.ymd !== sch.ymd)) timeHtml += '<div class="orig">' + esc(t.sched) + " <s>" + (sch.ymd !== big.ymd ? sch.dm + " " : "") + sch.hm + "</s></div>";
    if (big.ymd !== today) timeHtml += '<div class="day">' + big.dm + "</div>";
    var places = r.p.map(function (c) { return esc(placeName(c)) + ' <span class="code">' + esc(c) + "</span>"; }).join(" · ");
    var cs = x.nos.slice(1);
    var pills = [];
    if (k === "other") pills.push('<span class="k-other">' + esc(x.st.raw) + "</span>");
    else pills.push('<span class="k-' + k + '">' + esc(t.st[k]) + (k === "est" ? " " + big.hm : "") + "</span>");
    if (x.delay >= 15 && k !== "cancelled") pills.push('<span class="dly">' + esc(x.delay >= 120 ? fmt(t.delayH, { h: Math.floor(x.delay / 60), m: x.delay % 60 }) : fmt(t.delayMin, { m: x.delay })) + "</span>");
    var meta = [], right;
    if (!x.arr) {
      if (r.tm) meta.push(esc(r.tm)); if (r.ai) meta.push(esc(t.aisle) + " " + esc(r.ai));
      right = '<div class="gatebox"><div class="lbl">' + esc(t.gate) + '</div><div class="g' + (r.g ? "" : " na") + '">' + esc(r.g || "–") + "</div></div>";
    } else {
      if (r.tm) meta.push(esc(r.tm)); if (r.hl) meta.push(esc(t.hall) + " " + esc(r.hl)); if (r.st) meta.push(esc(t.stand) + " " + esc(r.st));
      right = '<div class="gatebox"><div class="lbl">' + esc(t.belt) + '</div><div class="g' + (r.bg ? "" : " na") + '">' + esc(r.bg || "–") + "</div></div>";
    }
    return '<div class="card' + (isPast(x, now) ? " past" : "") + (k === "cancelled" ? " cx" : "") + '" data-fno="' + esc(x.nos[0] || "") + '" data-gate="' + esc(r.g || "") + '" data-kind="' + k + '">' +
      '<div class="time">' + timeHtml + "</div>" +
      '<div class="main"><div class="fno">' + esc(x.nos[0] || "") + ' <span class="al">' + esc(airlineName(x.als[0])) + "</span></div>" +
      (cs.length ? '<div class="cs">' + esc(t.codeshare) + ": " + esc(cs.join(", ")) + "</div>" : "") +
      '<div class="place">' + esc(x.arr ? t.from : t.to) + " " + places + "</div>" +
      (meta.length ? '<div class="meta">' + meta.join(" · ") + "</div>" : "") + "</div>" + right +
      '<div class="pill">' + pills.join("") + "</div></div>";
  }

  function render() {
    var t = T(), now = Date.now(), today = hkParts(now).ymd;
    document.documentElement.lang = S.lang;
    document.documentElement.style.setProperty("--fs", FS[S.fs] + "px");
    document.title = t.title + " | HKIA";
    $("title").textContent = t.title;
    $("tab-dep").textContent = t.dep; $("tab-arr").textContent = t.arr;
    $("tab-dep").classList.toggle("on", S.tab === "dep"); $("tab-arr").classList.toggle("on", S.tab === "arr");
    $("tab-dep").setAttribute("aria-selected", S.tab === "dep"); $("tab-arr").setAttribute("aria-selected", S.tab === "arr");
    [0, 1, 2].forEach(function (i) { $("fs-" + i).classList.toggle("on", S.fs === i); $("fs-" + i).title = t.font; });
    $("q").placeholder = S.tab === "dep" ? t.qDep : t.qArr;
    $("refresh").title = t.refresh; $("refresh").setAttribute("aria-label", t.refresh);
    $("foot").textContent = t.source;
    $("gate").hidden = S.tab !== "dep";
    if (!S.data) { $("upd").textContent = S.error ? t.error : t.loading; $("cd").textContent = ""; $("list").innerHTML = ""; return; }
    var D = S.data, all = S.tab === "dep" ? D._dep : D._arr;
    // gate dropdown: gates used by current/upcoming departures
    var gates = {};
    D._dep.forEach(function (x) { if (x.raw.g && !isPast(x, now)) gates[x.raw.g] = (gates[x.raw.g] || 0) + 1; });
    if (S.gate) gates[S.gate] = gates[S.gate] || 0;
    var gl = Object.keys(gates).sort(function (a, b) { return parseInt(a, 10) - parseInt(b, 10) || (a < b ? -1 : 1); });
    $("gate").innerHTML = '<option value="">' + esc(t.allGates) + "</option>" + gl.map(function (g) {
      return '<option value="' + esc(g) + '"' + (g === S.gate ? " selected" : "") + ">" + esc(t.gate) + " " + esc(g) + " (" + gates[g] + ")</option>"; }).join("");
    // if the text is a place name (e.g. "上海"), match places only, not airline names like "上海航空"
    var ql = S.q.toLowerCase(), qu = S.q.replace(/\s+/g, "").toUpperCase();
    var placeOnly = !!S.q && Object.keys((D.names && D.names.airports) || {}).some(function (c) { return c === qu || allNames("airports", c).indexOf(ql) >= 0; });
    var filtered = all.filter(function (x) { return matches(x, S.q, placeOnly) && (S.tab !== "dep" || !S.gate || x.raw.g === S.gate); });
    var earlier = filtered.filter(function (x) { return isPast(x, now); }).length;
    var shown = S.showEarlier ? filtered : filtered.filter(function (x) { return !isPast(x, now); });
    $("count").textContent = fmt(t.count, { n: shown.length });
    $("earlier").hidden = !earlier;
    $("earlier").textContent = S.showEarlier ? t.hideEarlier : fmt(t.showEarlier, { n: earlier });
    $("list").innerHTML = shown.length ? shown.slice(0, S.limit).map(function (x) { return card(x, now, today); }).join("") : '<div class="empty">' + esc(t.none) + "</div>";
    var remaining = Math.max(0, shown.length - S.limit);
    $("more").hidden = remaining === 0; $("more").textContent = remaining ? t.more + " (" + remaining + ")" : "";
    var su = D.sourceUpdated && D.sourceUpdated[S.tab];
    $("upd").textContent = t.pageUpd + " " + hkParts(S.loadedAt).hms + " (" + t.hkt + ")";
    $("src").textContent = t.srcTime + " " + (su ? hkParts(Date.parse(su)).hm : "–") + " · " + t.fetched + " " + hkParts(Date.parse(D.generatedAt)).hm;
    var age = (now - Date.parse(D.generatedAt)) / 60000, stale = CFG.staleMin || 25;
    $("warn").hidden = !(age > stale || S.error);
    $("warn").textContent = S.error ? t.error : fmt(t.stale, { m: Math.floor(age) });
    tick();
  }
  function tick() { if (S.data) $("cd").textContent = S.left + " " + T().next; }

  function load() {
    S.left = REFRESH;
    var url = (CFG.dataUrl || "data/flights.json"); url += (url.indexOf("?") >= 0 ? "&" : "?") + "t=" + Date.now();
    return fetch(url, { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (d) {
        if (!d || !d.dep || !d.arr) throw new Error("bad data");
        d._dep = build(d.dep, false); d._arr = build(d.arr, true);
        S.data = d; S.loadedAt = Date.now(); S.loads++; S.error = null; render();
      })
      .catch(function (e) { S.error = String(e); render(); });
  }

  // ---- events ----
  var sel = $("lang");
  sel.innerHTML = Object.keys(I).map(function (k) { return '<option value="' + k + '">' + I[k].name + "</option>"; }).join("");
  sel.value = S.lang;
  sel.addEventListener("change", function () { S.lang = sel.value; store.set("lang", S.lang); render(); });
  [0, 1, 2].forEach(function (i) { $("fs-" + i).addEventListener("click", function () { S.fs = i; store.set("fs", i); render(); }); });
  ["dep", "arr"].forEach(function (k) { $("tab-" + k).addEventListener("click", function () { S.tab = k; S.limit = 100; store.set("tab", k); render(); window.scrollTo(0, 0); }); });
  var qt; $("q").addEventListener("input", function () { clearTimeout(qt); qt = setTimeout(function () { S.q = $("q").value.trim(); S.limit = 100; render(); }, 150); });
  $("gate").addEventListener("change", function () { S.gate = $("gate").value; S.limit = 100; render(); });
  $("earlier").addEventListener("click", function () { S.showEarlier = !S.showEarlier; render(); });
  $("more").addEventListener("click", function () { S.limit += 100; render(); });
  $("refresh").addEventListener("click", load);
  setInterval(function () { if (document.hidden) return; S.left--; if (S.left <= 0) load(); else tick(); }, 1000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden && S.loadedAt && Date.now() - S.loadedAt > REFRESH * 1000) load(); });
  window.__hka = S; // for automated tests
  render(); load();
})();
