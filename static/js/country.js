/* Country page (country.html), 18 Nov 2026; layout A chosen by Isma and made live the same day (Isma: "the complicated
   information is also very much needed; the problem was the readability"). Same depth as Event replay,
   easier to read and to find. Third round, 18 Nov 2026: blocks grouped under four headings with a plain verdict
   first, the reader's order (who and where; typical year; this season; forecast; past El Niño seasons;
   downloads and method), shareable links (static/js/link_state.js) and the Typical year shared with Event
   replay (static/js/typical_year.js). Reads served data; the calendar's zones and areas need the rebuilt
   calendar files (build_replay_calendars.py, this branch).

   Sources, all served:
   - data/enso_now.json                        the El Niño status line (observed and ENSO forecast)
   - data/replay/index.json                    the country list
   - data/replay/regions/index.json            each country's region names
   - data/replay/regions/<c>/_bounds.json      region outlines (the map)
   - data/replay/regions/<c>/pr_total.json     rain_hidden, where CHIRPS does not cover a region's rain
   - data/replay/forecast/index.json           the forecast months and the served indices
   - data/replay/forecast/<c>/comparison.json  the outlook's sentences and per-region tables (worded)
   - data/replay/forecast/<c>/<index>.json     every region's numbers per model (the detail)
   - data/replay/calendars/<c>.json            the typical year
   Wording is the served wording; a value that is not served is left out, never filled in. */
(function () {
  const HEAVY = /^data\/(replay\/(globalmonths|months|maps|regions|forecast|calendars)|maps|packs)\/(?!.*\.geojson$)/;
  const BASE = (window.ENSOSCOPE_DATA_BASE || "").replace(/\/+$/, "");
  const VER = window.ENSOSCOPE_DATA_VERSION || "";
  const url = p => HEAVY.test(p) ? `${BASE ? BASE + "/" : ""}${p}${VER ? "?v=" + VER : ""}` : p;
  async function getJSON(p) {
    const r = await fetch(url(p), HEAVY.test(p) ? {} : { cache: "no-store" });
    if (!r.ok) throw new Error(`${p} -> ${r.status}`);
    return r.json();
  }
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MON_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
                    "October", "November", "December"];
  // the order the blocks are listed in: rain and drought first, then heat
  const ORDER = ["pr_total", "dry_days", "rx10day", "cdd", "tmax", "heat_days", "utci_strong_days",
                 "utci_vstrong_days", "utci_extreme_days", "night_tropical", "night_equatorial", "night_torrid"];
  const RAIN = new Set(["pr_total", "rx10day", "cdd", "dry_days"]);

  const S = { countries: null, regIdx: null, country: null, cmp: null, docs: {}, bounds: null, hidden: {},
              cal: null, calMissing: false, region: null, n6: null, init: null, indices: [], open: new Set() };

  window.ENSO_COUNTRY = window.ENSO_COUNTRY || {};
  Object.assign(window.ENSO_COUNTRY, { regionCard, outlookLines, modelDetail, leanOf, noLeanOf, verdict, mountChooser,
                                       seasonValue, seasonOf, downloadsOf, matchCountry });
  document.addEventListener("DOMContentLoaded", () => {
    if (document.getElementById("cp-page")) init().catch(err => {
      document.getElementById("cp-body").innerHTML = `<p class="cp-empty">Country data not available: ${esc(err.message)}</p>`;
      throw err;
    });
  });

  // ── chooser ─────────────────────────────────────────────────────────────────
  // the chooser's look, shared by the country page and the home page's compact block
  const CHOOSER_CSS = `
    .cp-chooser { display: grid; gap: var(--s2); }
    .cp-chooser-h { font-weight: 600; font-size: var(--fs-ui); color: var(--ink); }
    .cp-chooser input { font: inherit; font-size: var(--fs-ui); padding: 9px 12px; min-height: 42px; max-width: 420px; width: 100%;
      border: 1px solid var(--rule); border-radius: var(--r-ctl); background: var(--page); color: var(--ink); }
    .cp-chooser input:focus { outline: 2px solid var(--link); outline-offset: 1px; }
    .cp-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 2px var(--s3); max-height: 168px; overflow-y: auto; font-size: var(--fs-ui); }
    .cp-list a { display: block; padding: 4px 0; text-decoration: none; }
    .cp-list a:hover { text-decoration: underline; }
    .cp-list .cp-none { color: var(--muted); }
    .cp-chooser.compact .cp-list { max-height: 106px; }
    .cp-count { font-size: var(--fs-sm); color: var(--muted); margin: 0; }
  .home-chooser-intro { margin: 0 0 var(--s2); font-size: var(--fs-ui); color: var(--ink); }`;

  // other names a reader may type for a country listed under a short label (QA, 18 Nov 2026)
  const ALIASES = {
    usa: ["United States of America", "United States", "America", "US"], uk: ["United Kingdom", "Great Britain", "Britain", "England"],
    car: ["Central African Republic"], dr_congo: ["Democratic Republic of the Congo", "Congo", "DRC", "Zaire"],
    dominican_republic: ["Dominican Republic"], papua_new_guinea: ["Papua New Guinea", "PNG"],
    trinidad: ["Trinidad and Tobago", "Tobago"], south_korea: ["Republic of Korea", "Korea"],
    laos: ["Lao People's Democratic Republic", "Lao PDR"], iran: ["Islamic Republic of Iran"], syria: ["Syrian Arab Republic"],
    eswatini: ["Swaziland"], myanmar: ["Burma"], turkey: ["Türkiye", "Turkiye"], cote_divoire: ["Ivory Coast"],
  };
  const fold = t => String(t).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  /** Does a typed query match a country (its label, its id, or another common name)? Accents and case ignored. */
  function matchCountry(c, q) {
    const f = fold(q).trim();
    if (!f) return true;
    return [c.label, c.id.replace(/_/g, " "), ...(ALIASES[c.id] || [])].some(n => fold(n).includes(f));
  }

  async function mountChooser(el, opts) {
    if (!document.getElementById("cp-chooser-style")) {
      const st = document.createElement("style"); st.id = "cp-chooser-style"; st.textContent = CHOOSER_CSS;
      document.head.appendChild(st);
    }
    // replay/index.json lists the countries as [{id, label, ...}]
    if (!S.countries) {
      const idx = await getJSON("data/replay/index.json");
      S.countries = Object.fromEntries(idx.countries.map(c => [c.id, c]));
    }
    const list = Object.values(S.countries).map(c => ({ id: c.id, label: c.label }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const sfx = opts && opts.compact ? "c" : "p";
    el.innerHTML = `<div class="cp-chooser${opts && opts.compact ? " compact" : ""}">
        <label for="cp-search-${sfx}" class="cp-chooser-h">Choose your country</label>
        <input type="search" id="cp-search-${sfx}" placeholder="Type a country name" autocomplete="off">
        <p class="cp-count" aria-live="polite"></p>
        <ul class="cp-list"></ul>
      </div>`;
    const input = el.querySelector("input"), ul = el.querySelector("ul"), count = el.querySelector(".cp-count");
    const draw = () => {
      const q = input.value;
      const hits = list.filter(c => matchCountry(c, q));
      count.textContent = q.trim() ? `${hits.length} of ${list.length} countries` : `${list.length} countries: type a name or scroll the list`;
      ul.innerHTML = hits.map(c => `<li><a href="country.html?country=${c.id}" data-id="${c.id}">${esc(c.label)}</a></li>`).join("")
        || `<li class="cp-none">No country matches</li>`;
    };
    input.addEventListener("input", draw);
    input.addEventListener("keydown", e => {
      const first = ul.querySelector("a");
      if (e.key === "Enter" && first) { e.preventDefault(); first.click(); }
    });
    if (opts && opts.onPick) ul.addEventListener("click", e => {
      const a = e.target.closest("a[data-id]");
      if (a) { e.preventDefault(); opts.onPick(a.dataset.id); }
    });
    draw();
  }


  // ── page ────────────────────────────────────────────────────────────────────
  // The reader's order (Isma, 18 Nov 2026): who and where (country, region, copy link); what a normal year
  // looks like (Typical year, left under the map); what is happening now (this season so far); what is
  // forecast (the blocks, by group); what past El Niño seasons did; then downloads and method notes.
  const GROUPS = [["Rain and drought", ["pr_total", "dry_days", "rx10day", "cdd"]],
                  ["Heat by day", ["tmax"]],
                  ["Heat stress", ["heat_days", "utci_strong_days", "utci_vstrong_days", "utci_extreme_days"]],
                  ["Nights", ["night_tropical", "night_equatorial", "night_torrid"]]];
  // the link holds the whole view: country, region and the opened blocks
  const LINK_KEYS = ["country", "region", "open"];
  const LINK_SPEC = { country: "str", region: "str", open: "list" };

  async function init() {
    const [now, fcIdx] = await Promise.all([getJSON("data/enso_now.json"), getJSON("data/replay/forecast/index.json")]);
    S.init = fcIdx.init;
    S.n6 = fcIdx.periods.find(p => p.id === "N6");
    S.indices = ORDER.filter(k => fcIdx.indices.includes(k));
    document.getElementById("cp-status").innerHTML =
      `<b>${esc(now.observed.line)}.</b> ${esc(now.forecast.run_label)}: ${esc(now.forecast.sentence)}`;
    await mountChooser(document.getElementById("cp-chooser"), { onPick: id => pick(id, null, true) });
    window.ENSO_LINK.copyButton(document.getElementById("cp-title-row"));
    // which downloads exist, as Event replay reads it; no index: say nothing rather than link to a missing file
    S.packs = await getJSON("data/packs_index.json").catch(() => null);
    // Back steps through the countries chosen here (a history entry per country)
    window.addEventListener("popstate", () => openFromLink());
    window.addEventListener("beforeprint", () => document.querySelectorAll("details.cp-block").forEach(d => {
      d.dataset.wasOpen = d.open ? "1" : ""; d.open = true; }));
    window.addEventListener("afterprint", () => document.querySelectorAll("details.cp-block").forEach(d => {
      if (d.dataset.wasOpen !== "1") d.open = false; }));
    await openFromLink();
  }

  async function openFromLink() {
    const st = window.ENSO_LINK.fromQuery(location.search, LINK_SPEC);
    S.open = new Set(st.open || []);
    const nf = document.getElementById("cp-notfound");
    nf.hidden = true;
    if (st.country && S.countries[st.country]) await pick(st.country, st.region || null);
    else if (st.country) {
      nf.textContent = `Country not found: "${st.country}". Choose it from the list.`;
      nf.hidden = false;
    }
  }

  function writeLink() {
    window.ENSO_LINK.write({ country: S.country, region: S.region, open: [...S.open] }, LINK_KEYS);
  }

  async function pick(id, region, push) {
    if (id !== S.country) S.open = S.country ? new Set() : S.open;
    if (push && id !== S.country) history.pushState(null, "", `?country=${encodeURIComponent(id)}`);
    const nf = document.getElementById("cp-notfound");
    if (nf) nf.hidden = true;
    S.country = id;
    S.region = null;
    const c = S.countries[id];
    document.getElementById("cp-body").hidden = false;
    document.getElementById("cp-title").textContent = c.label;
    const series = v => getJSON(`data/replay/regions/${id}/${v}.json`).catch(() => null);
    const [regIdx, cmp, bounds, rain, tmax, dry, u1, u2, u3, ...docs] = await Promise.all([
      getJSON("data/replay/regions/index.json"),
      getJSON(`data/replay/forecast/${id}/comparison.json`),
      getJSON(`data/replay/regions/${id}/_bounds.json`),
      getJSON(`data/replay/regions/${id}/pr_total.json`),
      series("tmax"), series("dry_days"), series("utci_strong_days"), series("utci_vstrong_days"), series("utci_extreme_days"),
      ...S.indices.map(k => getJSON(`data/replay/forecast/${id}/${k}.json`)),
    ]);
    S.regIdx = regIdx; S.cmp = cmp; S.bounds = bounds;
    S.docs = Object.fromEntries(S.indices.map((k, i) => [k, docs[i]]));
    S.series = { pr_total: rain, tmax, dry_days: dry, utci: [u1, u2, u3] };
    S.hidden = {};
    S.rainCov = {};
    for (const r of rain.regions) {
      if (r.rain_hidden) { S.hidden[r.name] = { n: r.n_cells, t: r.n_cells_all }; S.rainCov[r.name] = { hidden: true, n: r.n_cells, t: r.n_cells_all }; }
      else if (r.method === "no_cells") S.rainCov[r.name] = { none: true };
    }
    // a country without a calendar file is stated, not an error (only a missing file, 404, means that)
    S.cal = null; S.calMissing = false;
    try { S.cal = await getJSON(`data/replay/calendars/${id}.json`); }
    catch (e) { if (!/-> 404$/.test(e.message)) throw e; S.calMissing = true; }
    drawMap();
    const names = (regIdx.countries[id] || {}).regions || [];
    select(region && names.includes(region) ? region : null);
  }

  function select(region) {
    S.region = region;
    d3.select("#cp-map").selectAll("path.cp-reg").classed("on", d => d.properties.name === region)
      .attr("aria-pressed", d => String(d.properties.name === region));
    document.getElementById("cp-where").textContent = region ? `Region: ${region}` : "Whole country";
    drawUnit();
    drawCalendar();
    writeLink();
  }

  // ── leans and verdicts (tested: test_country_page.py, against every served table cell) ──

  /** The lean of one model's row, by region_outlook.lean: 'hi' or 'lo' when at least half the runs fall in
   *  that third and the ROC test passed (roc_*_ok; without the flag, an area above 0.5); otherwise null. */
  function leanOf(row, F) {
    const ok = side => {
      const f = row[F[`roc_${side}_ok`]];
      if (F[`roc_${side}_ok`] !== undefined && f !== null && f !== undefined) return f === 1;
      const v = row[F[`roc_${side}`]];
      return v === null || v === undefined || v > 0.5;
    };
    const hi = row[F.p_hi], lo = row[F.p_lo];
    if (hi === null || hi === undefined || lo === null || lo === undefined) return null;
    if (hi >= 0.5 && ok("hi")) return "hi";
    if (lo >= 0.5 && ok("lo")) return "lo";
    return null;
  }

  /** Why a model does not lean, by region_outlook.no_lean: ["split"] when no third holds half the runs;
   *  ["untested", side, share] when one does but the ROC test failed; ["nothirds"] when the record holds no chances
   *  (a count almost always zero); null when it leans. Tested against the Python rule on every served cell. */
  function noLeanOf(row, F) {
    if (leanOf(row, F)) return null;
    const hi = row[F.p_hi], lo = row[F.p_lo];
    if (hi === null || hi === undefined || lo === null || lo === undefined) return ["nothirds"];
    if (hi >= 0.5) return ["untested", "hi", hi];
    if (lo >= 0.5) return ["untested", "lo", lo];
    return ["split"];
  }
  // the seasons a model did not tell apart, as region_outlook.NO_LEAN_SEASONS["en"]
  const NL_SEASONS = { pr_total: ["wet seasons", "dry seasons"], rx10day: ["seasons of heavy downpours", "seasons of light downpours"],
                       cdd: ["seasons with long dry spells", "seasons with short dry spells"],
                       dry_days: ["seasons with many dry days", "seasons with few dry days"] };
  const ADJ = new Set(["wetter", "drier", "warmer", "cooler"]);
  // a share as a whole percent, rounded as Python's "{:.0%}" rounds (an exact tie to even)
  const pct0 = v => {
    const a = Math.abs(v * 100), exact = a.toFixed(30), tail = exact.slice(exact.length - 30);
    const n = /^50*$/.test(tail) ? (Number(exact.slice(0, exact.length - 31).slice(-1)) % 2 ? Math.ceil(a) : Math.floor(a)) : Math.round(a);
    return `${n}%`;
  };
  /** One model's reason in the headline's small line: "SEAS5: 73% of runs wetter, but no lean: it has not told wet
   *  seasons apart here in the past", "SEAS5: no lean, the runs are split", "...: no lean, this count is almost
   *  always zero here". */
  function reasonText(model, key, why) {
    if (why[0] === "split") return `${model}: no lean, the runs are split`;
    if (why[0] === "nothirds") return `${model}: no lean, this count is almost always zero here`;
    const w = LEAN_WORDS[key][why[1] === "hi" ? 0 : 1];
    const season = (NL_SEASONS[key] || ["hot seasons", "cool seasons"])[why[1] === "hi" ? 0 : 1];
    return `${model}: ${pct0(why[2])} of runs ${ADJ.has(w) ? w : "with " + w}, but no lean: it has not told ${season} apart here in the past`;
  }

  // (upper third, lower third) words, as region_outlook.WORDS
  const LEAN_WORDS = {
    pr_total: ["wetter", "drier"], rx10day: ["heavier downpours", "lighter downpours"],
    cdd: ["longer dry spells", "shorter dry spells"], dry_days: ["more dry days", "fewer dry days"],
    tmax: ["warmer", "cooler"], heat_days: ["more heat-stress days", "fewer heat-stress days"],
    utci_strong_days: ["more such days", "fewer such days"], utci_vstrong_days: ["more such days", "fewer such days"],
    utci_extreme_days: ["more such days", "fewer such days"], night_tropical: ["more such nights", "fewer such nights"],
    night_equatorial: ["more such nights", "fewer such nights"], night_torrid: ["more such nights", "fewer such nights"],
  };
  // the data palette's direction for each (index, third): wet, dry, warm or cool
  const DIR = { pr_total: ["wet", "dry"], rx10day: ["wet", "dry"], cdd: ["dry", "wet"], dry_days: ["dry", "wet"] };
  const dirOf = (k, side) => (DIR[k] || ["warm", "cool"])[side === "hi" ? 0 : 1];

  /** The block's plain verdict from the two models, in the One-page summary's words: "Both models: wetter",
   *  "Wetter (Météo-France only)", "The two models disagree", "No lean", "No skill shown". */
  function verdict(doc, key, unitName, pid) {
    const unit = unitName === "Whole country" ? doc.units_list.find(u => u.kind === "country")
                                              : doc.units_list.find(u => u.kind !== "country" && u.name === unitName);
    if (!unit) return { kind: "missing", text: "Not in this month's regional outlook" };
    if (unit.no_obs) return { kind: "state", text: "No forecast shown: no observation to check it against" };
    if ((unit.dry || []).includes(pid)) return { kind: "state", text: "Dry months: little rain falls then" };
    const lk = (unit.like || {})[pid];
    if (lk && lk[2] === false) return { kind: "state", text: NOT_LIKE };
    const F = {};
    doc.fields.forEach((f, i) => { F[f] = i; });
    const names = { seas5: "SEAS5", mf9: "Météo-France" };
    const leans = {}, skilful = [], reasons = [];
    for (const s of ["seas5", "mf9"]) {
      const row = unit.v[s] && unit.v[s][pid];
      if (!row || row[F.skill] !== 1) continue;
      skilful.push(s);
      const l = leanOf(row, F);
      if (l) leans[s] = l;
      else reasons.push(reasonText(names[s], key, noLeanOf(row, F)));
    }
    const w = side => LEAN_WORDS[key][side === "hi" ? 0 : 1];
    const cap = t => t[0].toUpperCase() + t.slice(1);
    if (!skilful.length) return { kind: "noskill", text: "No skill shown" };
    const ls = Object.entries(leans);
    if (ls.length === 2 && ls[0][1] === ls[1][1])
      return { kind: "both", side: ls[0][1], dir: dirOf(key, ls[0][1]), text: `Both models: ${w(ls[0][1])}`, reasons };
    if (ls.length === 2) return { kind: "opposite", text: "The two models disagree", reasons };
    // a model with no skill shown here is named too, so "X only" never hides the other model
    for (const s of ["seas5", "mf9"]) if (!skilful.includes(s)) reasons.push(`${names[s]}: no skill shown here`);
    if (ls.length === 1)
      return { kind: "one", side: ls[0][1], dir: dirOf(key, ls[0][1]), text: `${cap(w(ls[0][1]))} (${names[ls[0][0]]} only)`, reasons };
    return { kind: "none", text: "No lean", reasons };
  }

  const NOT_LIKE = "No forecast shown: the model grid does not match this area well enough";
  const NOT_LIKE_SERVED = "not comparable with this season's column";

  // ── the latest completed season, for every region (tested against the served tables) ──────────
  const MONTHS_LONG = MON_LONG.map(m => m.toLowerCase());
  /** The season the tables use ("March to May 2026", comparison.json "season"): its months (1..12) and the year it
   *  ends in, as build_country_check.season_months reads them. */
  function seasonOf(text) {
    const m = /^([A-Za-z]+) to ([A-Za-z]+) (\d{4})$/.exec(String(text || "").trim());
    if (!m) return null;
    const a = MONTHS_LONG.indexOf(m[1].toLowerCase()) + 1, b = MONTHS_LONG.indexOf(m[2].toLowerCase()) + 1;
    if (!a || !b) return null;
    const months = [];
    for (let k = a; ; k = k % 12 + 1) { months.push(k); if (k === b) break; }
    return { months, year: +m[3] };
  }
  // numpy's sum, so a value rounds as the downloads' does: pairwise over the whole array (sequential under eight,
  // eight-way blocks up to 128, halves above); checked against numpy on 3,000 random arrays, 0 differences
  function pairwise(a) {
    const n = a.length;
    if (n < 8) { let r = 0; for (const x of a) r += x; return r; }
    if (n <= 128) {
      const r = a.slice(0, 8);
      let i = 8;
      for (; i < n - (n % 8); i += 8) for (let j = 0; j < 8; j++) r[j] += a[i + j];
      let res = ((r[0] + r[1]) + (r[2] + r[3])) + ((r[4] + r[5]) + (r[6] + r[7]));
      for (; i < n; i++) res += a[i];
      return res;
    }
    let n2 = Math.floor(n / 2); n2 -= n2 % 8;
    return pairwise(a.slice(0, n2)) + pairwise(a.slice(n2));
  }
  const npSum = a => pairwise(a);
  const fmtSigned = (v, nd, unit) => {
    let t = v.toFixed(nd);
    const r = Number(t);
    // Python's "{:+.nf}" rounds the exact binary value, an exact tie to even (toFixed rounds a tie up)
    const exact = Math.abs(v).toFixed(nd + 30), tail = exact.slice(exact.length - 30);
    if (/^50*$/.test(tail)) {
      const lo = exact.slice(0, exact.length - 30).replace(/\.$/, "");
      if (Number(lo.slice(-1)) % 2 === 0) t = (v < 0 ? "-" : "") + lo;
    }
    const z = Number(t) === 0;
    const u = unit === "days" && Math.abs(Number(t)) === 1 ? "day" : unit;
    return `${z ? Math.abs(Number(t)).toFixed(nd) : (Number(t) > 0 ? "+" : "") + t}\u00a0${u}`;
  };
  /** One index's value for the season, for a region or the whole country ("Whole country"), as the tables print it:
   *  rain as % of normal (the season's total against its normal), maximum temperature the mean difference,
   *  dry days and heat-stress days (the three UTCI bands summed) the summed difference; the whole country is the
   *  cell-weighted mean of every region with cells, rain-hidden ones included (build_country_check.whole).
   *  A region's rain in dry months (under DRY_SHARE of its own year, mean_all, a single month DRY_SHARE / 3; or
   *  under ROW_FLOOR_MM in all) is DRY_TEXT, not a % (glossary G7; build_country_check.window_dry, 20 Nov 2026);
   *  the whole country by the same rule on the cell-weighted mean of its regions' mean_all, when all have one.
   *  Returns {value} (with dry: true for DRY_TEXT) or {state: "hidden" | "noseries"}. */
  function seasonValue(files, key, unit, season) {
    const docs = key === "heat_days" ? files.utci : [files[key]];
    if (!season || !docs || !docs.length || docs.some(d => !d)) return { state: "noseries" };
    const times = docs[0].times;
    const idx = new Map(times.map((t, i) => [t, i]));
    const rain = key === "pr_total" || key === "dry_days";
    // per region: the summed bands' anomalies and normals, its weight, and whether its rain is hidden
    const regs = docs[0].regions.map((r0, ri) => {
      if (r0.method === "no_cells") return null;
      const rs = docs.map(d => d.regions[ri]);
      if (rs.some(r => !r || r.name !== r0.name)) return null;
      const n = times.length;
      const anom = Array.from({ length: n }, (_, t) => rs.reduce((acc, r, j) => (j ? acc + val(r.values[t]) : val(r.values[t])), 0));
      const clim = Array.from({ length: 12 }, (_, m) => rs.reduce((acc, r, j) => (j ? acc + r.clim[m] : r.clim[m]), 0));
      return { name: r0.name, anom, clim, w: r0.cells_equiv !== undefined ? r0.cells_equiv : r0.n_cells,
               hidden: rain && !!r0.rain_hidden, meanAll: key === "pr_total" ? r0.mean_all : undefined };
    }).filter(Boolean);
    let u;
    if (unit === "Whole country") {
      const all = [...regs.filter(r => !r.hidden), ...regs.filter(r => r.hidden)];      // as {**regions, **hidden}
      if (!all.length) return { state: "noseries" };
      const ws = npSum(all.map(r => r.w));
      const wmean = get => get(all[0]).map((_, i) => all.reduce((acc, r) => acc + get(r)[i] * r.w, 0) / ws);
      // its all-years mean the same cell-weighted mean, when every region has one (build_country_check.whole)
      // (a region's missing month leaves that month unknown there too: null is NaN, never 0)
      const meanAll = key === "pr_total" && all.every(r => Array.isArray(r.meanAll) && r.meanAll.length === 12)
        ? wmean(r => r.meanAll.map(val)) : undefined;
      u = { anom: wmean(r => r.anom), clim: wmean(r => r.clim), meanAll };
    } else {
      u = regs.find(r => r.name === unit);
      if (!u) return { state: "noseries" };
      if (u.hidden) return { state: "hidden" };
    }
    if (key === "pr_total" && isDry(u.meanAll, season.months)) return { value: DRY_TEXT, dry: true };
    // the season's months, ending in its year; a month after a wrap belongs to the next calendar year
    let y = season.year - season.months.slice(1).filter((m, i) => m < season.months[i]).length;
    const ms = season.months.map((m, i) => { if (i && m < season.months[i - 1]) y += 1; return `${y}-${String(m).padStart(2, "0")}`; });
    if (ms.some(m => !idx.has(m))) return { state: "noseries" };
    const absolute = key === "pr_total";
    const x = ms.map(m => u.anom[idx.get(m)] + (absolute ? u.clim[+m.slice(5) - 1] : 0));
    if (x.some(v => !Number.isFinite(v))) return { state: "noseries" };
    const nm = season.months.map(m => u.clim[m - 1]);
    const sum = arr => npSum(arr);
    const how = key === "tmax" ? "mean" : "sum";
    const sv = how === "sum" ? sum(x) : sum(x) / x.length;
    const normal = how === "sum" ? sum(nm) : sum(nm) / nm.length;
    if (absolute) return { value: `${fmtSigned(100 * sv / normal, 0, "").replace(/^\+/, "").replace(/\u00a0$/, "")}%` };
    return { value: fmtSigned(sv, key === "tmax" ? 1 : 0, key === "tmax" ? "°C" : "days") };
  }
  const val = v => (v === null || v === undefined ? NaN : v);
  // Dry months (glossary G7; Isma, 20 Nov 2026; build_country_check.window_dry, the same constants and comparisons):
  // a window that normally brings under DRY_SHARE of the region's year (its twelve all-years monthly means,
  // January first), DRY_SHARE / 3 for one month, or under ROW_FLOOR_MM in all; unknown, so never dry, when a
  // mean is missing or the year holds no rain. The words are region_outlook.DRY_TEXT, as the tables print them.
  const DRY_SHARE = 0.08, ROW_FLOOR_MM = 15, DRY_TEXT = "dry months: little rain falls then";
  function isDry(meanAll, months) {
    if (!Array.isArray(meanAll) || meanAll.length !== 12 || !meanAll.every(Number.isFinite)) return false;
    const year = npSum(meanAll);
    if (!(year > 0)) return false;
    const win = npSum(months.map(m => meanAll[m - 1]));
    return win / year < (months.length > 1 ? DRY_SHARE : DRY_SHARE / 3) || win < ROW_FLOOR_MM;
  }

  /** The downloads that exist for a country, from data/packs_index.json as Event replay reads it; [] when none. */
  function downloadsOf(id, idx) {
    if (!idx) return [];
    if (idx.countries && !idx.countries.includes(id)) return [];
    const files = idx.files ? (idx.files[id] || []) : ["pdf", "xlsx"];
    const L = [["pdf", "Full analysis", "PDF", ".pdf"], ["xlsx", "Full analysis", "Excel", ".xlsx"],
               ["simple_pdf", "One-page summary", "PDF", "_simple.pdf"], ["simple", "One-page summary", "Excel", "_simple.xlsx"]];
    for (const [lg, name] of [["fr", "French"], ["es", "Spanish"], ["pt", "Portuguese"]])
      L.push([`simple_${lg}_pdf`, `One-page summary, ${name}`, "PDF", `_simple_${lg}.pdf`],
             [`simple_${lg}`, `One-page summary, ${name}`, "Excel", `_simple_${lg}.xlsx`]);
    return L.filter(([k]) => files.includes(k)).map(([k, what, fmt, suffix]) => ({ key: k, what, fmt,
      path: `data/packs/ensoscope_${id}${suffix}` }));
  }

  // ── drawing ─────────────────────────────────────────────────────────────────
  function drawUnit() {
    const box = document.getElementById("cp-unit");
    const name = S.region || "Whole country";
    const label = S.region || S.countries[S.country].label;
    const card = regionCard(S.cmp, name, S.region ? S.hidden[S.region] : null);
    const tab = card.sections.filter(s => s.observed);
    // the latest completed season, for every region, from the served series with the tables' own rule
    const season = seasonOf(S.cmp.season);
    const ROWS = [["pr_total", "Rainfall", "of normal"], ["dry_days", "Dry days (under 1 mm)", ""],
                  ["tmax", "Maximum temperature", ""], ["heat_days", "Heat-stress days (UTCI 32 °C or more)", ""]];
    const obsRows = ROWS.map(([k, lab, suf]) => {
      const r = seasonValue(S.series, k, name, season);
      const v = r.value ? (suf && r.value.endsWith("%") ? `${r.value} ${suf}` : r.value)
        : r.state === "hidden" ? "not covered by CHIRPS" : "no observed series";
      return `<tr><th scope="row">${esc(lab)}</th><td${r.dry ? ' class="na"' : ""}>${esc(v)}</td></tr>`;
    }).join("");
    // the whole country's rain rests on the part CHIRPS covers: say so where regions fall outside it
    const nReg = (S.series.pr_total.regions || []).length;
    const none = Object.values(S.rainCov).filter(c => c.none).length;
    const thin = Object.values(S.rainCov).filter(c => c.hidden).length;
    const partial = !S.region && (none || thin)
      ? `<p class="cp-note">Rain for ${esc(label)} rests on the part of the country CHIRPS covers (land from 50°S to 50°N):`
        + (none ? ` ${none} of ${nReg} regions have no CHIRPS cells` : "")
        + (none && thin ? ";" : "") + (thin ? ` ${thin} ${thin > 1 ? "have too few to show on their own" : "has too few to show on its own"}` : "")
        + `.</p>` : "";
    const now = season
      ? `<p class="cp-sub cp-season">${esc(S.cmp.season)}. Rain observed (CHIRPS); heat from the ERA5 reanalysis.</p>
         <table class="cp-facts-t"><tbody>${obsRows}</tbody></table>${partial}`
      : `<p class="cp-empty">No completed season is named in this month's outlook for ${esc(label)}.</p>`;
    const past = tab.length
      ? `<table class="cp-facts-t"><tbody>${tab.map(s => `<tr><th scope="row">${esc(s.label)}</th>`
          + `<td>${esc(s.past.value)}</td></tr>`).join("")}</tbody></table>
         <p class="cp-sub">${esc(tab[0].past.label)}.</p>`
      : `<p class="cp-empty">Past El Niño seasons for ${esc(label)} are not in this month's outlook tables`
        + (downloadsOf(S.country, S.packs).length ? `: see the One-page summary and the Full analysis (sheet "Past events").` : ".")
        + `</p>`;
    const groups = GROUPS.map(([g, keys]) => {
      const ks = keys.filter(k => S.indices.includes(k));
      if (!ks.length) return "";
      return `<div class="cp-group"><h4 class="cp-gh">${esc(g)}</h4>`
        + ks.map(k => block(k, card)).join("") + `</div>`;
    }).join("");
    const replay = `event_replay.html?event=current_conditions&country=${encodeURIComponent(S.country)}`
      + (S.region ? `&region=${encodeURIComponent(S.region)}` : "");
    const fcmap = `forecast_maps.html?var=fc_pr_total&lead=N6&country=${encodeURIComponent(S.country)}`;
    const dls = downloadsOf(S.country, S.packs);
    const byWhat = {};
    for (const d of dls) (byWhat[d.what] = byWhat[d.what] || []).push(d);
    const dlHtml = dls.length
      ? Object.entries(byWhat).map(([w, ds]) => `<li>${esc(w)}: ${ds.map(d => `<a href="${url(d.path)}">${d.fmt}</a>`).join(" · ")}</li>`).join("")
      : `<li>No downloads for this country.</li>`;
    box.innerHTML = `
      <section class="cp-sec"><h3>Latest completed season (observed)</h3>${now}</section>
      <section class="cp-sec"><h3>Forecast, ${esc(S.n6.label)}</h3>
        <p class="cp-sub">Issued ${esc(monthLong(S.init))}, for ${esc(label)}${S.region ? " (region)" : " as a whole"}.
          A verdict needs a model to lean: at least half its runs in one third and a past record of telling that
          third apart. Each block opens to its detail.</p>${groups}</section>
      <section class="cp-sec"><h3>Past El Niño seasons</h3>${past}
        <p class="cp-sub">${downloadsOf(S.country, S.packs).length ? `Season by season, for every region: Full analysis (Excel),
          sheet "Past events"; every` : "Every"} past event charted month by month: Event replay.</p></section>
      <section class="cp-sec"><h3>Downloads and method</h3>
        <ul class="cp-links">
          <li><a href="${replay}">Open ${esc(label)} in Event replay</a></li>
          <li><a href="${fcmap}">The current forecast map for ${esc(S.countries[S.country].label)}</a></li>
          ${dlHtml}
          <li><a href="methodology.html">How these numbers are made (Methodology)</a></li>
        </ul></section>`;
    box.querySelectorAll("details.cp-block").forEach(d => d.addEventListener("toggle", () => {
      if (d.open) S.open.add(d.dataset.key); else S.open.delete(d.dataset.key);
      writeLink();
    }));
  }

  function block(k, card) {
    const hidden = S.region && RAIN.has(k) && S.hidden[S.region];
    const sec = card.sections.find(s => s.key === k);
    const det = hidden ? null : modelDetail(S.docs[k], k, S.region || "Whole country", "N6", S.n6);
    const v = hidden ? { kind: "state", text: `Not covered by CHIRPS (rain on ${hidden.n} of ${hidden.t} cells)` }
                     : verdict(S.docs[k], k, S.region || "Whole country", "N6");
    const chip = v.dir ? `<span class="cp-chip ${v.dir}" title="${esc(v.dir)}">${v.side === "hi" ? "▲" : "▼"}</span>`
      : `<span class="cp-chip none" title="no lean">${v.kind === "none" ? "○" : "·"}</span>`;
    const val = m => m.missing ? "not served" : m.average || m.skill.label;
    const models = det && det.models ? det.models : null;
    const cells = models ? models.map(m => `<span class="cp-mv"><i>${esc(m.model)}</i> ${esc(val(m))}</span>`).join("")
                         : `<span class="cp-mv"></span><span class="cp-mv"></span>`;
    // the skill words once per block, not in every line
    let skn = (v.reasons || []).join("; ");
    if (models) {
      const w = models.filter(m => m.skill && m.skill.label !== "no skill shown");
      const lab = [...new Set(w.map(m => m.skill.label))];
      const tr = w.some(m => m.skill.trend);
      if (w.length) skn += (skn ? ". " : "") + (lab.length === 1 && w.length === 2 ? `Skill: both models, ${lab[0]}`
          : "Skill: " + w.map(m => `${m.model}, ${m.skill.label}`).join("; "))
        + (tr ? "; much of this skill comes from the warming trend" : "");
    }
    let body = "";
    if (sec && sec.forecasts && !sec.forecasts.every(f => f.text === NOT_LIKE_SERVED)) body += `<dl class="cp-facts">${sec.forecasts.map(f =>
      `<dt>${esc(f.model)}</dt><dd>${esc(f.text)}</dd>`).join("")}<dt>The two models</dt><dd>${esc(sec.agree)}</dd></dl>`;
    const sentence = !S.region && (S.cmp.sentences || []).find(s => s.startsWith(`Forecast for ${SENT_WORD[k] || "\u0000"}, ${S.n6.label}:`));
    if (sentence) body += `<p class="cp-words">${esc(sentence)}</p>`;
    if (models) {
      const [lo, hi] = third(k);
      const cell = (m, f) => m.missing ? "not served" : f(m) || "";
      const row = (lab, f) => {
        const x = models.map(m => cell(m, f));
        return `<tr><th scope="row">${lab}</th>${x[0] && x.every(y => y === x[0])
          ? `<td colspan="${x.length}" class="both">${esc(x[0])}</td>` : x.map(y => `<td>${esc(y)}</td>`).join("")}</tr>`;
      };
      body += `<table class="cp-models"><thead><tr><th></th>${models.map(m => `<th scope="col">${esc(m.model)}</th>`).join("")}</tr></thead><tbody>
        ${row("Average of the runs <span>(ensemble mean)</span>", m => m.average || "no forecast described")}
        ${row(`Chance of ${hi[0]} <span>(${hi[1]})</span>`, m => m.chances && m.chances.hi)}
        ${row(`Chance of neither <span>(middle third)</span>`, m => m.chances && m.chances.mid)}
        ${row(`Chance of ${lo[0]} <span>(${lo[1]})</span>`, m => m.chances && m.chances.lo)}
        ${row(`Spread of the runs <span>(10th to 90th percentile)</span>`, m => m.range)}
        ${row("Skill <span>(correlation of past forecasts, 1993-2025)</span>", m => m.skill && `${m.skill.label}${m.skill.r !== null ? ` (r = ${m.skill.r})` : ""}`)}
        ${row("Record since 1982", m => m.record && `${m.record.lo} (${m.record.loSeason}) to ${m.record.hi} (${m.record.hiSeason})`)}
        ${row("How the model did in past El Niño seasons <span>(1993-2025)</span>", m => m.elNino && `${m.elNino.n} seasons: leaned to the observed third in ${m.elNino.right}, to another third in ${m.elNino.wrong}, no lean in ${m.elNino.n - m.elNino.right - m.elNino.wrong}`)}
        </tbody></table>
        <p class="cp-note">Skill words: useful skill from r = 0.6; weak skill: better than chance, below 0.6; no skill
          shown: not better than chance, so no forecast is described.</p>`;
    }
    if (det && det.state && det.state !== v.text) body += `<p class="cp-note">${esc(det.state)}.</p>`;
    if (hidden) body += `<p class="cp-note">Rain on ${hidden.n} of ${hidden.t} cells: CHIRPS covers land from 50°S to 50°N,
      so no rain value is shown for this region. Heat values are unaffected.</p>`;
    return `<details class="cp-block" data-key="${k}"${S.open.has(k) ? " open" : ""}><summary>
        <span class="cp-bt">${chip}${esc(title(k))}</span>
        <span class="cp-verdict">${esc(v.text)}</span>${cells}
        ${skn ? `<span class="cp-skn">${esc(skn)}</span>` : ""}</summary><div class="cp-detail">${body}</div></details>`;
  }
  const SENT_WORD = { pr_total: "rainfall", tmax: "maximum temperature", heat_days: "heat-stress days",
                      dry_days: "dry days (under 1 mm)" };

  function monthLong(ym) { const [y, m] = ym.split("-").map(Number); return `${MON_LONG[m - 1]} ${y}`; }

  // ── data to card (tested: scripts/analysis/tests/test_country_page.py) ─────

  /** The whole-country lines: the served next-6-months sentences for rainfall, maximum temperature and
   *  heat-stress days, each without its "Forecast for ..., <months>:" lead. A sentence not served is left out. */
  function outlookLines(cmp, n6Label) {
    const want = [["rainfall", "Rainfall"], ["maximum temperature", "Maximum temperature"],
                  ["heat-stress days", "Heat-stress days"]];
    const out = [];
    for (const [word, label] of want) {
      const lead = `Forecast for ${word}, ${n6Label}: `;
      const s = (cmp.sentences || []).find(x => x.startsWith(lead));
      if (s) out.push({ label, text: s.slice(lead.length) });
    }
    return out;
  }

  /** One unit's row from the served outlook tables, word for word: per index the latest observed season,
   *  past El Niño seasons and each model's forecast (lean and skill label as printed), and whether the two
   *  models agree. A table without the unit's row is marked missing; rain CHIRPS does not cover (hidden:
   *  {n, t}) shows "not covered by CHIRPS" in place of every rain value. */
  function regionCard(cmp, name, hidden) {
    const want = [["pr_total", "Rainfall"], ["dry_days", "Dry days"], ["tmax", "Maximum temperature"],
                  ["heat_days", "Heat-stress days"]];
    const sections = [];
    for (const [key, label] of want) {
      if ((key === "pr_total" || key === "dry_days") && hidden) {
        sections.push({ key, label, note: `not covered by CHIRPS (rain on ${hidden.n} of ${hidden.t} cells)` });
        continue;
      }
      const t = cmp.tables && cmp.tables[key];
      const row = t && t.rows.find(r => r[0] === name);
      if (!row) { sections.push({ key, label, missing: true }); continue; }
      const c = t.columns;
      sections.push({ key, label,
        observed: { label: c[1], value: row[1] },
        past: { label: c[2], value: row[2] },
        forecasts: [{ model: c[3], text: row[3] }, { model: c[4], text: row[4] }],
        agree: row[5] });
    }
    return { name, sections };
  }

  /** The detail behind one index for one unit ("Whole country" or a region name) and one period, from the
   *  served per-region forecast file: per model the average of the runs, the chance of each third, the
   *  spread of the runs, skill with its label, the record since 1982 and the past El Niño seasons it got
   *  right. The unit's own states come first: no observations, dry months, not comparable. Numbers are
   *  formatted as the site prints them (rain as % of normal; otherwise a signed difference in units). */
  function modelDetail(doc, key, unitName, pid, period) {
    const unit = unitName === "Whole country" ? doc.units_list.find(u => u.kind === "country")
                                              : doc.units_list.find(u => u.kind !== "country" && u.name === unitName);
    if (!unit) return { missing: true };
    const F = {};
    doc.fields.forEach((f, i) => { F[f] = i; });
    // as the outlook tables print them: rainfall as % of normal; otherwise a signed difference, "+11\u00a0days"
    // rounded as the tables' Python formatting rounds: the exact binary value, an exact tie to even
    // (1.25 -> 1.2, where toFixed gives 1.3; 1.05 is just above the tie, so 1.1 in both)
    const rnd = (v, d) => {
      const a = Math.abs(v), exact = a.toFixed(d + 30), tail = exact.slice(exact.length - 30);
      if (!/^50*$/.test(tail)) return a.toFixed(d);
      const lo = exact.slice(0, exact.length - 30).replace(/\.$/, "");
      const last = Number(lo.slice(-1));
      return last % 2 ? a.toFixed(d) : lo;
    };
    const u = doc.units || "";
    const fmt = v => {
      if (v === null || v === undefined) return null;
      if (key === "pr_total") return `${rnd(v, 0)}% of normal`;
      const s = rnd(v, u === "\u00b0C" ? 1 : 0);
      const sign = Number(s) === 0 ? "" : v > 0 ? "+" : "-";
      const word = key.startsWith("night_") && u === "days" ? "nights" : u;      // nights are counted as nights
      return `${sign}${s}\u00a0${word === "days" && s === "1" ? "day" : word === "nights" && s === "1" ? "night" : word}`;
    };
    const pct = v => v === null || v === undefined ? null : `${rnd(v * 100, 0)}%`;
    const cross = period && period.months[0].slice(0, 4) !== period.months[period.months.length - 1].slice(0, 4);
    const season = y => y === null || y === undefined ? "" : cross ? `${y}-${String(y + 1).slice(2)}` : `${y}`;
    if (unit.no_obs) return { unit: unit.name, state: "no observation covers this unit, so no forecast is shown" };
    if ((unit.dry || []).includes(pid)) return { unit: unit.name, state: "dry months: little rain falls then" };
    // as the outlook table: where the forecast's 1 degree cells do not match the unit's own observed series
    // (like ok false), no forecast is set beside the observed season
    const lk = (unit.like || {})[pid];
    if (lk && lk[2] === false) return { unit: unit.name, state: NOT_LIKE };
    const models = [["seas5", "SEAS5"], ["mf9", "Météo-France"]].map(([sys, name]) => {
      const row = unit.v[sys] && unit.v[sys][pid];
      if (!row) return { model: name, missing: true };
      const skill = row[F.skill] === 1;
      const r = row[F.r];
      const label = !skill ? "no skill shown" : r >= 0.6 ? "useful skill" : "weak skill";
      const out = { model: name, skill: { label, r: r === null || r === undefined ? null : r.toFixed(2),
        trend: skill && F.skill_dt !== undefined && row[F.skill_dt] !== 1 } };
      if (!skill) return out;                // no forecast is described without skill
      out.average = fmt(row[F.anom]);
      out.chances = { lo: pct(row[F.p_lo]), mid: pct(row[F.p_mid]), hi: pct(row[F.p_hi]) };
      out.range = row[F.q10] === null || row[F.q10] === undefined ? null : `${fmt(row[F.q10])} to ${fmt(row[F.q90])}`;
      if (F.obs_lo !== undefined && row[F.obs_lo] !== null && row[F.obs_lo] !== undefined)
        out.record = { lo: fmt(row[F.obs_lo]), loSeason: season(row[F.obs_lo_year]),
                       hi: fmt(row[F.obs_hi]), hiSeason: season(row[F.obs_hi_year]) };
      if (F.en_n !== undefined && row[F.en_n])
        out.elNino = { n: row[F.en_n], right: row[F.en_right], wrong: row[F.en_wrong] };
      return out;
    });
    return { unit: unit.name, agree: (unit.agree || {})[pid] || null, models };
  }


  const THIRD = {
    pr_total: [["a drier season", "driest third"], ["a wetter season", "wettest third"]],
    rx10day: [["a lighter heaviest 10 days", "lowest third"], ["a heavier heaviest 10 days", "highest third"]],
    dry_days: [["fewer dry days", "lowest third"], ["more dry days", "highest third"]],
    cdd: [["a shorter dry spell", "lowest third"], ["a longer dry spell", "highest third"]],
    tmax: [["a cooler season", "coolest third"], ["a warmer season", "warmest third"]],
  };
  const third = k => THIRD[k] || [["fewer such days", "lowest third"], ["more such days", "highest third"]];
  // the served label without " vs normal"; "Max" spelled out as in the whole-country lines
  const title = k => (S.docs[k].label || k).replace(/ vs normal$/, "").replace(/^Max temperature$/, "Maximum temperature");

  // ── map ─────────────────────────────────────────────────────────────────────
  function drawMap() {
    const svg = d3.select("#cp-map");
    const box = document.getElementById("cp-mapwrap");
    const w = box.clientWidth || 320, h = Math.round(Math.min(w, 520) * 0.82);
    svg.attr("viewBox", `0 0 ${w} ${h}`).attr("width", w).attr("height", h);
    svg.selectAll("*").remove();
    const fc = rewind(S.bounds);
    const proj = d3.geoMercator().fitExtent([[8, 8], [w - 8, h - 8]], fc);
    const path = d3.geoPath(proj);
    svg.append("g").selectAll("path").data(fc.features).enter().append("path")
      .attr("class", "cp-reg").attr("d", path)
      .attr("tabindex", 0).attr("role", "button")
      .attr("aria-label", d => `Select ${d.properties.name}`)
      .on("click", (ev, d) => select(d.properties.name === S.region ? null : d.properties.name))
      .attr("aria-pressed", "false")
      .on("keydown", (ev, d) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault();
        select(d.properties.name === S.region ? null : d.properties.name); } })
      .append("title").text(d => d.properties.name);
  }

  // d3-geo needs clockwise outer rings; a counter-clockwise one covers the globe and takes every click
  function rewind(fc) {
    for (const f of fc.features) {
      if (d3.geoArea(f) > 2 * Math.PI) {
        const g = f.geometry;
        const rings = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
        for (const poly of rings) for (const r of poly) r.reverse();
      }
    }
    return fc;
  }


  // ── typical year (one component with Event replay: static/js/typical_year.js) ─────
  function drawCalendar() {
    const box = document.getElementById("cp-cal");
    if (S.calMissing) { box.innerHTML = `<p class="cp-empty">No calendar for ${esc(S.countries[S.country].label)} yet.</p>`; return; }
    const d = new Date();
    window.ENSO_TYPICAL_YEAR.render(box, S.cal, S.region, { init: S.init, fcMonths: S.n6.months, fcLabel: S.n6.label,
      nowYm: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, rain: S.rainCov });
  }
})();
