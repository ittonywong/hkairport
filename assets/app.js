(function () {
  "use strict";
  var CFG = window.HKA_CONFIG || {}, I = window.I18N, JK = window.PLACE_JA_KO || {};
  var REFRESH = CFG.refreshSec || 60, FS = [14, 16, 19];
  var $ = function (id) { return document.getElementById(id); };
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem("hka." + k); return v === null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem("hka." + k, v); } catch (e) {} }
  };
  var LCODE = {"zh-Hant":"繁","zh-Hans":"简",en:"EN",ja:"日",mi:"Mā",ko:"한"};
  function pickLang() {
    var s = store.get("lang", null); if (s && I[s]) return s;
    return "en"; // first visit: English; saved choice always wins
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
  // ---- self-drawn SVG icons (no logos / trademarks) ----
  var PLANE = "M12 2c.8 0 1.3.9 1.3 2v5.2l7.7 4.3v2l-7.7-2.3v4.6l2.2 1.6v1.6L12 20l-3.5 1v-1.6l2.2-1.6v-4.6L3 15.5v-2l7.7-4.3V4c0-1.1.5-2 1.3-2z";
  function icon(kind, cls) {
    var rot = kind === "arr" ? 125 : 55, y = kind === "arr" ? 1.5 : -1.5;
    return '<svg class="ico ' + (cls || "") + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<g transform="translate(0 ' + y + ') rotate(' + rot + ' 12 12) translate(2.4 2.4) scale(.8)"><path fill="currentColor" d="' + PLANE + '"/></g>' +
      '<path d="M2 22.5h20" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity=".55"/></svg>';
  }
  var EMPTY_ART = '<svg class="empty-art" viewBox="0 0 160 60" aria-hidden="true"><path d="M8 52 C 50 50, 90 30, 132 14" fill="none" stroke="#9fb3c2" stroke-width="2" stroke-dasharray="5 6" stroke-linecap="round"/>' +
    '<g transform="translate(140 11) rotate(68) scale(1.1) translate(-12 -12)" fill="#0f766e"><path d="' + PLANE + '"/></g><path d="M4 57h152" stroke="#c9d6df" stroke-width="2"/></svg>';
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

  // ---- gate phrases in the search box ----
  // "24", "２４", "24號", "24號閘口", "24號閒口", "閘口24", "閒口 24", "gate 24", "Gate24", "登机口24", "24番搭乗口", "탑승구 24", "24번 탑승구", "kuaha 24"
  // ("閒口/闲口" is a common typing slip for 閘口, so it is accepted too)
  var GW = "(?:gate|閘口|闸口|閒口|闲口|閘|闸|登機口|登机口|搭乗口|搭乘口|탑승구|kuaha)";
  var GATE_PRE = new RegExp("^(?:" + GW + "|g)\\s*(?:no\\.?\\s*)?(\\d{1,3}[a-z]?)\\s*(?:號|号|番|번)?$", "i");
  var GATE_SUF = new RegExp("^(\\d{1,3}[a-z]?)\\s*(?:號|号|番|번)?\\s*" + GW + "?$", "i");
  function normQ(q) { return (q.normalize ? q.normalize("NFKC") : q).replace(/\s+/g, " ").trim(); }
  // returns {gate:"24", how:"phrase"|"number"} for gate searches; pure numbers count as gates only if that gate exists
  function gateQuery(q, gateSet) {
    q = normQ(q); if (!q) return null;
    var m = q.match(GATE_PRE) || q.match(GATE_SUF);
    if (!m) return null;
    var g = m[1].toUpperCase().replace(/^0+(?=\d)/, "");
    var pure = /^\d+$/.test(q);
    if (pure) return gateSet[g] ? { gate: g, how: "number" } : { gate: null, how: "noGate", n: g };
    return { gate: g, how: "phrase" };
  }
  function matches(x, q, placeOnly, gq) {
    if (!q) return true;
    if (gq && gq.gate) return !x.arr && x.raw.g.toUpperCase() === gq.gate;
    q = normQ(q);
    var r = x.raw, qq = q.replace(/\s+/g, "").toUpperCase(), ql = q.toLowerCase();
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
    var places = icon(x.arr ? "arr" : "dep", "pl") + r.p.map(function (c) { return esc(placeName(c)) + ' <span class="code">' + esc(c) + "</span>"; }).join(" · ");
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

  // ---- v5: departure "gate sign" card (navy gate block + white/red sign), tap opens the pillar ----
  function fkey(x) { return x.raw.d + "|" + x.raw.t + "|" + (x.nos[0] || ""); }
  function signCard(x, now, today) {
    var t = T(), r = x.raw, k = x.st.kind, sch = hkParts(x.sched), nt = x.st.ms ? hkParts(x.st.ms) : null;
    var late = x.delay >= 15 && k !== "cancelled";
    var newT = nt && (nt.hm !== sch.hm || nt.ymd !== sch.ymd) ? '<span class="nt">' + (k === "departed" ? "✈ " : "→ ") + nt.hm + "</span>" : "";
    var pills = [];
    if (k === "other") pills.push('<span class="k-other">' + esc(x.st.raw) + "</span>");
    else pills.push('<span class="k-' + (k === "est" && late ? "delayed" : k) + '">' + esc(k === "est" && late ? t.st.delayed : t.st[k]) + (nt && (k === "est" || k === "departed") ? " " + nt.hm : "") + "</span>");
    if (late) pills.push('<span class="dly">' + esc(x.delay >= 120 ? fmt(t.delayH, { h: Math.floor(x.delay / 60), m: x.delay % 60 }) : fmt(t.delayMin, { m: x.delay })) + "</span>");
    var meta = [esc(airlineName(x.als[0]))]; if (r.tm) meta.push(esc(r.tm)); if (r.ai) meta.push(esc(t.aisle) + " " + esc(r.ai));
    var cs = x.nos.length > 1 ? '<div class="sc-cs">' + esc(x.nos[1]) + (x.nos.length > 2 ? ' <span class="more">+' + (x.nos.length - 2) + "</span>" : "") + "</div>" : "";
    var dest = r.p.map(function (c) { return esc(placeName(c)) + '<span class="code">' + esc(c) + "</span>"; }).join(" / ");
    return '<div class="card sc' + (isPast(x, now) ? " past" : "") + (k === "cancelled" ? " cx" : "") + '" role="button" tabindex="0" data-key="' + esc(fkey(x)) +
      '" data-fno="' + esc(x.nos[0] || "") + '" data-gate="' + esc(r.g || "") + '" data-kind="' + k + '" aria-label="' + esc(t.openPillar + ": " + (x.nos[0] || "")) + '">' +
      '<div class="sc-row"><div class="sc-gate"><span class="l">' + esc(t.gate) + '</span><span class="n' + (r.g ? "" : " na") + '">' + esc(r.g || "–") + "</span></div>" +
      '<div class="sc-sign"><div class="sc-white"><div class="sc-fl"><div class="sc-fno">' + esc(x.nos[0] || "") + "</div>" + cs + "</div>" +
      '<div class="sc-time">' + sch.hm + (sch.ymd !== today ? '<span class="day">' + sch.dm + "</span>" : "") + newT + "</div></div>" +
      '<div class="sc-red"><div class="sc-hkto">' + esc(t.hkTo) + '</div><div class="sc-dest">' + dest + "</div></div></div></div>" +
      '<div class="pill sc-foot">' + pills.join("") + '</div><div class="sc-meta">' + meta.join(" · ") + "</div></div>";
  }
  // shrink long destinations / flight numbers in list signs (batched: one layout read, one write)
  function fitList() {
    var d = document.querySelectorAll("#list .sc-dest, #list .sc-fno"), i, m = [];
    for (i = 0; i < d.length; i++) { d[i].style.fontSize = ""; d[i].classList.remove("wrap"); }
    for (i = 0; i < d.length; i++) m.push([d[i].scrollWidth, d[i].clientWidth, parseFloat(getComputedStyle(d[i]).fontSize)]);
    for (i = 0; i < d.length; i++) {
      var sw = m[i][0], cw = m[i][1], fs = m[i][2]; if (!cw || sw <= cw + 1) continue;
      var ratio = cw / sw * 0.97, isDest = d[i].classList.contains("sc-dest");
      if (isDest && ratio < 0.66) { d[i].classList.add("wrap"); d[i].style.fontSize = (fs * 0.72).toFixed(1) + "px"; }
      else d[i].style.fontSize = (fs * Math.max(ratio, 0.6)).toFixed(1) + "px";
    }
  }

  // ---- v8: little people on the gate floor follow the real flight status (original CSS figures, decorative) ----
  // status -> scene (raw HKIA "status" text; statusCode is always null in the feed):
  //   ""(scheduled), "Boarding Soon", "Est at HH:MM" (incl. delayed), "Delayed", anything unknown -> wait
  //   "Boarding" -> board   |   "Final Call", "Gate Closed" -> closed (barrier tape)
  //   "Dep HH:MM", "Diverted", no flight at this gate -> empty (one person dozing, Zzz)   |   "Cancelled" -> cx (one traveller leaving)
  var SCENE = { boarding: "board", finalCall: "closed", gateClosed: "closed", departed: "empty", diverted: "empty", atGate: "empty", landed: "empty", cancelled: "cx" };
  function sceneFor(cur) { return cur ? (SCENE[cur.st.kind] || "wait") : "empty"; }
  // a new random cast on every page load (kept for the whole visit so a data refresh does not reshuffle people)
  var PAL = ["#0f766e", "#1e3a8a", "#64748b", "#a16207", "#0e7490", "#334e68", "#4d7c0f", "#6d28d9", "#b45309", "#475569", "#0369a1", "#9ca3af", "#78716c", "#155e75", "#7c3aed", "#ca8a04"];
  var PANTS = ["#1f2937", "#334155", "#3f3f46", "#1e3a5f", "#57534e", "#44403c", "#0f172a"];
  var SKIN = ["#f1d3b3", "#e8c39e", "#d9a77c", "#c68a5e", "#8d5a3b", "#6b4228"];
  var HAIR = ["#1f1b18", "#2b2b33", "#4a3426", "#6b4a2e", "#a67c52", "#d8c08a"], GREY = ["#d1d5db", "#e5e7eb", "#9ca3af"];
  var BAGC = ["#1f2a37", "#0f3d3a", "#374151", "#1e3a5f", "#52525b"];
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function who(sex) { return { sex: sex || (Math.random() < 0.5 ? "m" : "f"), cl: pick(PAL), lc: pick(PANTS), sk: pick(SKIN), hr: pick(HAIR), bc: pick(BAGC) }; }
  function castMember(type) {
    var p = who(type === "man" ? "m" : type === "woman" ? "f" : null); p.type = type;
    if (type === "elder") { p.hr = pick(GREY); p.stick = 1; }
    if (type === "suitcase") p.bag = 1;
    if (type === "backpack") p.bp = 1;
    if (type === "family") { p.a = who("m"); p.b = who("f"); p.kid = who(); p.stroller = Math.random() < 0.6; p.kid.small = 1; }
    return p;
  }
  function mkCast() {
    var t = ["man", "woman", "elder", "family", "suitcase", "backpack"], i, j, x;
    for (i = t.length - 1; i > 0; i--) { j = Math.floor(Math.random() * (i + 1)); x = t[i]; t[i] = t[j]; t[j] = x; }
    for (i = 0; i < 6; i++) t.push(pick(["man", "woman", "suitcase", "backpack", "elder", "man", "woman", "suitcase"]));
    return t.map(castMember);
  }
  function one(p, mode, cls, style) {
    var c = "pp " + mode + " " + (p.sex === "f" ? "fem" : "mal") + (p.stick ? " old" : "") + (p.small ? " kid" : "") + (cls ? " " + cls : "");
    return '<i class="' + c + '" data-f="' + (p.type || "kid") + '" style="--cl:' + p.cl + ";--lc:" + p.lc + ";--sk:" + p.sk + ";--hr:" + p.hr + ";--bc:" + p.bc + ";" + (style || "") + '">' +
      (p.sex === "f" ? '<b class="hr"></b>' : "") + '<b class="hd"></b>' + (p.bp ? '<b class="bp"></b>' : "") + '<b class="tb"></b>' + (p.sex === "f" ? '<b class="sk"></b>' : "") +
      '<b class="lg"></b><b class="lg lg2"></b>' + (mode === "sit" ? '<b class="sh"></b><b class="sh sh2"></b>' : "") +
      (p.bag ? '<b class="bag"></b>' : "") + (p.stick ? '<b class="stk"></b>' : "") + (cls && / hand/.test(" " + cls) ? '<b class="arm"></b>' : "") + "</i>";
  }
  function fig(p, mode, cls, style) {
    if (p.type !== "family") return one(p, mode, cls, style);
    if (mode === "sit") return one(p.b, "sit", cls, style);
    return '<i class="grp' + (p.stroller ? "" : " ns") + (cls ? " " + cls : "") + '" data-f="family"' + (style ? ' style="' + style + '"' : "") + ">" + one(p.a, mode, "g1") +
      (p.stroller ? '<b class="stroller" style="--cl:' + p.a.bc + '"><b class="sb"></b><b class="sw"></b><b class="sw sw2"></b></b>' : "") +
      one(p.b, mode, "g2 hand") + one(p.kid, mode, "g3") + "</i>";
  }
  function trk(cls, inner, style) { return '<div class="pp-trk ' + cls + '"' + (style ? ' style="' + style + '"' : "") + ">" + inner + "</div>"; }
  var BENCH = '<div class="gp-bench"><b class="bk"></b></div>';
  function crowd(key, g, fno) {
    var C = S.cast || (S.cast = mkCast()), ph = -((Date.now() / 1000) % 86400).toFixed(1), h = "", i;
    var solo = C.filter(function (p) { return p.type !== "family"; });
    if (key === "board") { // a queue walking into the gate
      h = BENCH + fig(solo[5], "sit", "nod", "left:4.2%");
      for (i = 0; i < 5; i++) h += trk("q", fig(C[i], "walk", "flip"), "--x:" + (56 + i * 9) + "%;--d:" + (-i * 3) + "s");
    } else if (key === "closed") { // retractable barrier tape across the gate, people held back, sparse
      h = BENCH + '<div class="gp-tape"><b class="post"></b><b class="belt"></b><b class="post p2"></b></div>' +
        fig(solo[0], "stand", "sway", "left:24%") + trk("late", fig(solo[1], "walk", "flip")) + fig(solo[1], "stand", "flip blocked", "left:69%");
    } else if (key === "cx") { // cancelled: the gate is quiet, one traveller walks away
      h = BENCH + trk("leave", fig(solo.filter(function (p) { return p.bag; })[0] || solo[0], "walk"));
    } else if (key === "empty") { // departed / no flight: one person dozing on the bench
      h = BENCH + one(solo[2], "sit", "doze", "left:4.2%").replace(/<\/i>$/, '<b class="zzz"><b>z</b><b>z</b><b>Z</b></b></i>');
    } else { // wait: wander around and sit waiting
      h = BENCH + fig(solo[3], "sit", "read", "left:4.2%") + fig(solo[4], "sit", "nod", "left:calc(4.2% + 2.6em)") +
        fig(C[0], "stand", "sway", "left:27%") + fig(C[1], "stand", "sway2 flip", "left:66%") +
        trk("w1", fig(C[2], "walk", "far")) + trk("w2", fig(C[3], "walk", "flip")) + trk("w3", fig(C[4], "walk", "far"));
    }
    return '<div class="gp-crowd sc-' + key + '" data-scene="' + key + '" data-gate="' + esc(g || "") + '" data-fno="' + esc(fno || "") + '" style="--ph:' + ph + 's">' + h + "</div>";
  }
  // smooth scene change on data refresh: old crowd fades out over the new one (skipped for reduced motion)
  var RM = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  function setBoard(el, html) {
    var old = el.querySelector(".gp-crowd");
    el.innerHTML = html;
    var nw = el.querySelector(".gp-crowd");
    if (old && nw && !RM.matches && old.dataset.gate === nw.dataset.gate && old.dataset.fno === nw.dataset.fno && old.dataset.scene !== nw.dataset.scene) {
      old.classList.remove("in"); old.classList.add("out"); nw.classList.add("in");
      nw.parentNode.insertBefore(old, nw);
      setTimeout(function () { if (old.parentNode) old.parentNode.removeChild(old); nw.classList.remove("in"); }, 1300);
    }
  }
  window.__hkaScene = { sceneFor: sceneFor, crowd: crowd, newCast: function () { S.cast = mkCast(); } };

  // ---- gate board v3: drawn like an HKIA gate pillar (CSS/SVG only, no logos) ----
  var ROOF = '<svg class="gp-roof" viewBox="0 0 400 90" preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
    '<defs><pattern id="gpLat" width="36" height="36" patternUnits="userSpaceOnUse"><path d="M0 0L36 36M36 0L0 36" stroke="#fff" stroke-width="1.8"/></pattern>' +
    '<linearGradient id="gpSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9c9d6"/><stop offset="1" stop-color="#dfe7ee"/></linearGradient></defs>' +
    '<path d="M0 0H400V48Q200 92 0 48Z" fill="url(#gpSky)"/><path d="M0 0H400V48Q200 92 0 48Z" fill="url(#gpLat)" opacity=".85"/>' +
    '<path d="M0 48Q200 92 400 48" fill="none" stroke="#9fb1c1" stroke-width="2"/>' +
    '<g stroke="#c4d1dc" stroke-width="2"><path d="M60 62V90"/><path d="M340 62V90"/></g></svg>';
  function gateBoard(g, deps, now, focus) {
    var t = T(), atG = g ? deps.filter(function (x) { return x.raw.g.toUpperCase() === g.toUpperCase(); }) : [];
    var up = atG.filter(function (x) { return !DONE[x.st.kind] && !isPast(x, now); });
    // the flight being boarded comes first (like a real gate screen), then the next one by latest expected time
    var ACT = { boarding: 1, finalCall: 1, boardingSoon: 2, gateClosed: 3 };
    up = up.slice().sort(function (a, b) { return (ACT[a.st.kind] || 9) - (ACT[b.st.kind] || 9) || a.best - b.best; });
    var cur = up[0], recent = null;
    if (focus) { up = up.filter(function (x) { return x !== focus; }); cur = focus; recent = focus; } // tapped flight + other upcoming flights at its gate
    else if (!cur) { // nothing upcoming: show the latest departure/cancellation from this gate (within the "earlier" window)
      recent = atG.filter(function (x) { return (x.st.kind === "departed" || x.st.kind === "cancelled") && !isPast(x, now); }).pop() || null;
      cur = recent;
    }
    var clock = '<div class="gp-clock" title="' + esc(t.now) + '">' + hkParts(now).hm + "</div>";
    var top = '<div class="gp-gatelbl">' + esc(t.gate) + '</div><div class="gp-num">' + esc(g || "–") + "</div>";
    var scene = function (inner, attrs, below, key, fno) {
      return '<div class="gp" ' + attrs + '><div class="gp-scene">' + ROOF + clock + '<div class="gp-stand"><div class="gp-pillar">' + inner + '</div>' +
        '<div class="gp-base" aria-hidden="true"></div></div><div class="gp-floor" aria-hidden="true"><div class="gp-shadow"></div><div class="gp-reflect"></div>' + crowd(key, g, fno) + '</div>' +
        '<span class="sr">' + esc(t.scene[key]) + "</span></div></div>" +
        (below ? '<div class="gp-later">' + below + "</div>" : ""); // later flights: separate card below the whole pillar scene
    };
    if (!cur) return scene(top + '<div class="gp-sign"><div class="gp-white gp-empty">' + esc(t.boardNone) + "</div></div>", 'data-board-gate="' + esc(g) + '" data-board-kind="none" data-scene="empty"', "", "empty", "");
    var k = cur.st.kind, r = cur.raw, sch = hkParts(cur.sched), nt = cur.st.ms ? hkParts(cur.st.ms) : null;
    var late = cur.delay >= 15 && k !== "cancelled" && k !== "departed";
    var stCls = k === "est" && late ? "delayed" : k;
    var stTxt = k === "other" ? cur.st.raw : stCls === "delayed" ? t.st.delayed + " " + nt.hm : (k === "departed" && nt ? t.st[k] + " " + nt.hm : t.st[k]);
    var dly = late ? '<span class="gp-dly">' + esc(cur.delay >= 120 ? fmt(t.delayH, { h: Math.floor(cur.delay / 60), m: cur.delay % 60 }) : fmt(t.delayMin, { m: cur.delay })) + "</span>" : "";
    var cs = cur.nos.length > 1 ? '<div class="gp-cs" data-fitw="1">' + esc(cur.nos[1]) + (cur.nos.length > 2 ? ' <span class="gp-more">+' + (cur.nos.length - 2) + "</span>" : "") + "</div>" : "";
    var dest = r.p.map(placeName).join(" / ");
    var sign = '<div class="gp-sign' + (k === "cancelled" ? " cx" : "") + '">' +
      '<div class="gp-white"><div class="gp-fl"><div class="gp-fno" data-fitw="1">' + esc(cur.nos[0]) + "</div>" + cs + '</div><div class="gp-time">' + sch.hm +
        (sch.ymd !== hkParts(now).ymd ? '<span class="gp-day">' + sch.dm + "</span>" : "") + "</div></div>" +
      '<div class="gp-red"><div class="gp-hkto">' + esc(t.hkTo) + '</div><div class="gp-dest" data-fit="1" title="' + esc(r.p.join(" / ")) + '">' + esc(dest) + "</div></div></div>";
    var status = '<div class="gp-status"><span class="gp-st st-' + stCls + '">' + esc(stTxt) + "</span>" + dly + "</div>" +
      '<div class="gp-meta">' + esc(r.tm) + (r.ai ? " · " + esc(t.aisle) + " " + esc(r.ai) : "") + "</div>";
    var nexts = (recent ? up : up.slice(1)).slice(0, 3);
    var later = nexts.length ? '<div class="gp-next"><div class="gp-nh">' + esc(t.bNext) + "</div>" + nexts.map(function (x) {
      return '<div class="gp-nr"><span class="gp-nt">' + hkParts(x.sched).hm + '</span><b>' + esc(x.nos[0]) + '</b><span class="gp-np">' + esc(x.raw.p.map(placeName).join(" / ")) +
        '</span><span class="gp-st sm st-' + x.st.kind + '">' + esc(x.st.kind === "other" ? x.st.raw : t.st[x.st.kind] + (x.st.kind === "est" && x.st.ms ? " " + hkParts(x.st.ms).hm : "")) + "</span></div>"; }).join("") + "</div>" : "";
    return scene(top + sign + status, 'data-board-gate="' + esc(g) + '" data-board-fno="' + esc(cur.nos[0]) + '" data-board-kind="' + stCls + '" data-scene="' + sceneFor(cur) + '"', later, sceneFor(cur), cur.nos[0]);
  }
  // shrink the destination text until it fits the red panel (long names like "Ho Chi Minh City" or Māori/Japanese strings)
  function fitBoard() {
    var els = document.querySelectorAll("#board [data-fit], #detailBody [data-fit]");
    for (var i = 0; i < els.length; i++) {
      var e = els[i], size = 2.1; e.style.fontSize = size + "em";
      while (size > 0.95 && (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1)) { size -= 0.1; e.style.fontSize = size.toFixed(2) + "em"; }
    }
    // flight numbers: shrink (width only) when the white panel is narrow, e.g. 360px phone at A+
    els = document.querySelectorAll("#board [data-fitw], #detailBody [data-fitw]");
    for (i = 0; i < els.length; i++) {
      var w = els[i], f = 1; w.style.fontSize = "";
      var base = parseFloat(getComputedStyle(w).fontSize);
      while (f > 0.6 && w.scrollWidth > w.clientWidth + 1) { f -= 0.05; w.style.fontSize = (base * f).toFixed(1) + "px"; }
    }
  }
  window.__hkaFit = fitBoard; // used by automated layout tests
  window.__hkaFitList = fitList;
  window.addEventListener("resize", function () { fitBoard(); fitList(); });

  function render() {
    var t = T(), now = Date.now(), today = hkParts(now).ymd;
    document.documentElement.lang = S.lang;
    document.documentElement.style.setProperty("--fs", FS[S.fs] + "px");
    document.title = t.title + " | HKIA";
    $("title").textContent = t.title;
    var lc = $("lcodeT"); if (lc) lc.textContent = LCODE[S.lang] || S.lang;
    var fg = $("fontgrp"); if (fg) fg.setAttribute("aria-label", t.font);
    $("tab-dep").innerHTML = icon("dep") + "<span>" + esc(t.dep) + "</span>"; $("tab-arr").innerHTML = icon("arr") + "<span>" + esc(t.arr) + "</span>";
    $("tab-dep").classList.toggle("on", S.tab === "dep"); $("tab-arr").classList.toggle("on", S.tab === "arr");
    $("tab-dep").setAttribute("aria-selected", S.tab === "dep"); $("tab-arr").setAttribute("aria-selected", S.tab === "arr");
    [0, 1, 2].forEach(function (i) { $("fs-" + i).classList.toggle("on", S.fs === i); $("fs-" + i).title = t.font; });
    $("q").placeholder = S.tab === "dep" ? t.qDep : t.qArr;
    $("refresh").title = t.refresh; $("refresh").setAttribute("aria-label", t.refresh);
    $("foot").textContent = t.source;
    $("gate").hidden = S.tab !== "dep";
    $("back").textContent = "← " + t.back;
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
    var gateSet = {}; D._dep.forEach(function (x) { if (x.raw.g) gateSet[x.raw.g.toUpperCase()] = 1; });
    var gq = gateQuery(S.q, gateSet);
    if (S.tab === "arr" && gq && gq.how !== "phrase") gq = null; // arrivals: plain numbers keep meaning baggage belt / flight number
    S.gq = gq;
    if (gq && gq.gate) placeOnly = false;
    var filtered = all.filter(function (x) { return matches(x, S.q, placeOnly, gq) && (S.tab !== "dep" || !S.gate || x.raw.g === S.gate); });
    if (S.tab === "dep" && gq && gq.gate) filtered.sort(function (a, b) { return a.sched - b.sched; }); // same gate: in time order
    var hint = "";
    if (gq && gq.gate) hint = S.tab === "dep" ? fmt(t.qGate, { g: gq.gate }) : t.gateArrNote;
    else if (gq && gq.how === "noGate") hint = fmt(t.qNoGate, { g: gq.n });
    else if (S.tab === "dep" && filtered.length) hint = t.tapHint;
    $("qhint").hidden = !hint; $("qhint").textContent = hint;
    var earlier = filtered.filter(function (x) { return isPast(x, now); }).length;
    var shown = S.showEarlier ? filtered : filtered.filter(function (x) { return !isPast(x, now); });
    $("count").textContent = fmt(t.count, { n: shown.length });
    $("earlier").hidden = !earlier;
    $("earlier").textContent = S.showEarlier ? t.hideEarlier : fmt(t.showEarlier, { n: earlier });
    $("list").innerHTML = shown.length ? shown.slice(0, S.limit).map(function (x) { return S.tab === "dep" ? signCard(x, now, today) : card(x, now, today); }).join("") : '<div class="empty">' + EMPTY_ART + "<div>" + esc(t.none) + "</div></div>";
    if (S.tab === "dep" && !S.focus) fitList();
    var remaining = Math.max(0, shown.length - S.limit);
    $("more").hidden = remaining === 0; $("more").textContent = remaining ? t.more + " (" + remaining + ")" : "";
    // gate display board: dropdown gate, or text like "閘口 30" / "gate 30"
    var bg = S.tab === "dep" ? (S.gate || (gq && gq.gate) || "") : "";
    if ($("board")) { $("board").hidden = !bg; setBoard($("board"), bg ? gateBoard(bg, D._dep, now) : ""); if (bg) fitBoard(); }
    renderDetail(now);
    var su = D.sourceUpdated && D.sourceUpdated[S.tab];
    $("upd").textContent = t.pageUpd + " " + hkParts(S.loadedAt).hms + " (" + t.hkt + ")";
    $("src").textContent = t.srcTime + " " + (su ? hkParts(Date.parse(su)).hm : "–") + " · " + t.fetched + " " + hkParts(Date.parse(D.generatedAt)).hm;
    var age = (now - Date.parse(D.generatedAt)) / 60000, stale = CFG.staleMin || 25;
    $("warn").hidden = !(age > stale || S.error);
    $("warn").textContent = S.error ? t.error : fmt(t.stale, { m: Math.floor(age) });
    tick();
  }
  // ---- v5: tapped flight -> full pillar view, with back button + browser back (history state) ----
  function renderDetail(now) {
    var on = !!(S.focus && S.data);
    $("detail").hidden = !on; $("listview").hidden = on;
    if (!on) { $("detailBody").innerHTML = ""; return; }
    var f = null; S.data._dep.forEach(function (x) { if (fkey(x) === S.focus) f = x; });
    if (!f) { $("detailBody").innerHTML = '<div class="empty">' + EMPTY_ART + "<div>" + esc(T().none) + "</div></div>"; return; }
    setBoard($("detailBody"), gateBoard(f.raw.g, S.data._dep, now, f)); fitBoard();
  }
  function openFlight(key, push) {
    if (!S.focus) S.listScroll = window.scrollY;
    S.focus = key;
    if (push) try { history.pushState({ hkaFocus: key }, "", "#flight"); S.pushed = true; } catch (e) {}
    render(); window.scrollTo(0, 0);
  }
  function closeFlight(fromPop) {
    if (!S.focus) return;
    if (!fromPop && S.pushed) { history.back(); return; } // popstate will finish closing
    S.focus = null; S.pushed = false;
    if (!fromPop) try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    render(); var y = S.listScroll || 0; window.scrollTo(0, y); setTimeout(function () { window.scrollTo(0, y); }, 0);
  }
  window.addEventListener("popstate", function (e) {
    var k = e.state && e.state.hkaFocus;
    if (k) { if (k !== S.focus) openFlight(k, false); } else closeFlight(true);
  });
  // leaving the detail view because the user changed search/tab/gate: drop it without restoring scroll
  function leaveDetail() { if (S.focus) { S.focus = null; if (S.pushed) { S.pushed = false; try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {} } } }

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
  ["dep", "arr"].forEach(function (k) { $("tab-" + k).addEventListener("click", function () { leaveDetail(); S.tab = k; S.limit = 100; store.set("tab", k); render(); window.scrollTo(0, 0); }); });
  var qt; $("q").addEventListener("input", function () { clearTimeout(qt); qt = setTimeout(function () { leaveDetail(); S.q = $("q").value.trim(); S.limit = 100; render(); }, 150); });
  $("gate").addEventListener("change", function () { leaveDetail(); S.gate = $("gate").value; S.limit = 100; render(); });
  $("earlier").addEventListener("click", function () { S.showEarlier = !S.showEarlier; render(); });
  $("more").addEventListener("click", function () { S.limit += 100; render(); });
  $("refresh").addEventListener("click", load);
  $("back").addEventListener("click", function () { closeFlight(false); });
  var onCard = function (e) { var c = e.target.closest && e.target.closest("#list .sc"); if (c) openFlight(c.getAttribute("data-key"), true); };
  $("list").addEventListener("click", onCard);
  $("list").addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { var c = e.target.closest && e.target.closest("#list .sc"); if (c) { e.preventDefault(); onCard(e); } } });
  setInterval(function () { if (document.hidden) return; S.left--; if (S.left <= 0) load(); else tick(); }, 1000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden && S.loadedAt && Date.now() - S.loadedAt > REFRESH * 1000) load(); });
  window.__hka = S; // for automated tests
  render(); load();
})();
