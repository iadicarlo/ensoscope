/* Typical year strip, one component for the country page and Event replay (Isma, 18 Nov 2026).

   Reads a served calendar, data/replay/calendars/<country>.json (build_replay_calendars.py):
   - whole country: the rain zones the downloads use (pack_calendar.rain_zones: Zone A to C or "All regions",
     the rest named as other patterns), then one group per agricultural calendar area (the regions that carry
     the same planting, harvest and lean rows), each naming the area and the source of each row;
   - a region: its own rainy months (CHIRPS), then the planting, harvest and lean rows of the area it belongs to.
   Any source key works: FEWS NET, FAO GIEWS (national, © FAO), the FAO Crop Calendar, the modelled GGCMI
   calendar, or a key the file names later; each gets its own source line. "Lean season not given by the source"
   and the country's no-calendar note are shown as the file words them. Twelve months from the forecast's issue
   month; the forecast months shaded, this month outlined.

   window.ENSO_TYPICAL_YEAR = { model(cal, region, opts), render(el, cal, region, opts), sourceLine(doc, unit, name) }
   opts: { init: "YYYY-MM", fcMonths: ["YYYY-MM", ...], fcLabel: "Dec 2026 to May 2027", nowYm: "YYYY-MM",
           rain: { <region>: { hidden: true, n, t } | { none: true } } (the served rain coverage, optional) }
   A file from before the zones and areas were served (no "areas") shows only what it holds: its rain rows and a
   region's own planting, harvest and lean rows, and never a sentence about what is missing (QA, 18 Nov 2026). */
(function () {
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const KIND_WORD = { rain: "rainy season", planting: "planting", harvest: "harvest", lean: "lean season" };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const and = xs => xs.length < 2 ? xs.join("") : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1];
  // an area name the source writes in capitals reads as a name ("SOUTHERN, CENTRAL..." becomes "Southern, central...")
  const tidy = a => a && a === a.toUpperCase() && /[A-Z]{3}/.test(a) ? a[0] + a.slice(1).toLowerCase() : a;
  // a long list of regions: the first names, the rest in "more" (the strip folds them)
  const LIST_MAX = 8;
  const listOf = (lead, names) => names.length > LIST_MAX
    ? { text: `${lead} (${names.length}): ${names.slice(0, LIST_MAX).join(", ")}`, more: names.slice(LIST_MAX) }
    : { text: `${lead}: ${names.join(", ")}`, more: null };
  const srcOf = (doc, k) => (doc.sources && doc.sources[k]) || { label: k };

  /** The source line for one unit's rows (the Event replay strip's line and its hover text): one label per source
   *  the rows use, as the served "sources" block words it (a key it does not describe is named by its key), then
   *  the unit's lean note and the country's no-calendar note. */
  function sourceLine(doc, unit, name) {
    const keys = [...new Set(((unit && unit.rows) || []).map(r => r.source))];
    const used = keys.map(k => srcOf(doc, k));
    const notes = [];
    if (unit && unit.lean_note && unit.lean_note.text) notes.push(unit.lean_note.text);
    if (doc.farming_note) notes.push(doc.farming_note);
    const parts = used.map(s => s.label).concat(notes);
    return {
      text: `Typical year, ${name}: ${parts.join("; ")}.`,
      title: used.map(s => [s.label, s.method, s.citation, s.url, s.accessed && `accessed ${s.accessed}`, s.licence]
        .filter(Boolean).join(". ")).join("\n"),
      label: k => srcOf(doc, k).label,
    };
  }

  // "Calendar area: Southeastern and coastal areas", or for rows from two places
  // "Calendar areas: Northern and eastern pastoral areas (lean season); National (planting and harvest)"
  function areaTitle(parts) {
    if (parts.length === 1) return `Calendar area: ${tidy(parts[0].area)}`;
    return "Calendar areas: " + parts.map(p => `${tidy(p.area)} (${and(p.kinds.map(k => KIND_WORD[k]))})`).join("; ");
  }
  // a national calendar shown for a region: it may not hold everywhere (pastoral or desert areas)
  const nationalNote = (parts, nRegions) => nRegions > 1 && parts.some(p => p.area === "National")
    ? ". A national calendar: it may not apply to every region" : "";
  function partsOf(rows) {
    const parts = [];
    for (const r of rows) {
      const p = parts.find(x => x.area === (r.area || "not named") && x.source === r.source);
      if (!p) parts.push({ area: r.area || "not named", source: r.source, kinds: [r.kind] });
      else if (!p.kinds.includes(r.kind)) p.kinds.push(r.kind);
    }
    return parts;
  }

  /** The strip as data (tested: scripts/analysis/tests/test_typical_year.py). */
  function model(cal, region, opts) {
    const [y0, m0] = opts.init.split("-").map(Number);
    const fc = new Set(opts.fcMonths || []);
    const months = Array.from({ length: 12 }, (_, i) => {
      const m = (m0 - 1 + i) % 12, y = y0 + Math.floor((m0 - 1 + i) / 12);
      const ym = `${y}-${String(m + 1).padStart(2, "0")}`;
      return { m, y, ym, fc: fc.has(ym), now: ym === opts.nowYm };
    });
    const on = (spans, h) => spans.some(([a, b]) => h >= a && h < b);
    const cells = spans => months.map(mo => [on(spans, 2 * mo.m), on(spans, 2 * mo.m + 1)]);
    const used = [];
    const use = k => { if (!used.includes(k)) used.push(k); };
    const row = (label, kind, spans, source) => { use(source); return { label, kind, cells: cells(spans) }; };
    const subOf = (parts, extra) => "Source: " + [...new Set(parts.map(p => p.source))].map(k => srcOf(cal, k).label)
      .join("; ") + (extra || "");
    const groups = [];
    const notes = [];
    let empty = null;
    const cov = opts.rain || {};
    const nRegions = Object.keys(cal.regions || {}).length;
    const oldFormat = !(cal.country_level && cal.country_level.areas !== undefined);
    // why a region has no rainy months on the strip, from the served rain coverage
    const rainWhy = name => {
      const c = cov[name];
      if (c && c.hidden) return `${name}: rainy months not shown, CHIRPS covers land from 50°S to 50°N (rain on ${c.n} of ${c.t} cells)`;
      if (c && c.none) return `${name}: no rainy months, CHIRPS has no cells here (it covers land from 50°S to 50°N)`;
      return null;
    };
    if (!region) {
      const cl = cal.country_level || { rows: [] };
      // regions whose rain the strip does not show, and the regions the zones leave out, said once
      const uncovered = Object.keys(cov).filter(n => cov[n].hidden || cov[n].none);
      const covNote = uncovered.length
        ? listOf("Rainy months not shown where CHIRPS has no or too few cells (it covers land from 50°S to 50°N)",
                 uncovered.sort((a, b) => a.localeCompare(b)))
        : null;
      if (cl.zones && cl.zones.length) {
        const zl = cl.zones.map(z => listOf(z.label, z.members.filter(m => !(cov[m] && cov[m].hidden))));
        const other = cl.other_patterns || [];
        const note = cl.zones.length > 1 || other.length || uncovered.length
          ? { text: zl.map(x => x.text).join("; ")
                + (other.length ? `. Other rain patterns: ${listOf(`${other.length} region${other.length > 1 ? "s" : ""}`, other).text}` : "")
                + (covNote ? `. ${covNote.text}` : ""),
              more: [...zl.flatMap(x => x.more || []), ...(covNote && covNote.more || [])] }
          : null;
        groups.push({ title: "Rainy season", sub: null, rows: cl.zones.map(z => row(z.label, "rain", z.spans, "chirps")),
          note: note && note.text, more: note && note.more && note.more.length ? note.more : null });
      } else if ((cl.rows || []).length) {
        groups.push({ title: "Rainy season", sub: null, note: null,
          rows: cl.rows.map(r => row(r.kind === "rain" ? cal.label : r.label, r.kind, r.spans, r.source)) });
      }
      if (oldFormat) {
        // a file from before the areas were served: nothing agricultural is said for the whole country
      } else if (!cl.areas.length) {
        empty = cal.farming_note || `No agricultural calendar for ${cal.label} yet (planting, harvest, lean season).`;
      } else {
        const inArea = new Set();
        for (const a of cl.areas) {
          a.members.forEach(m => inArea.add(m));
          const regs = listOf("Regions", a.members);
          groups.push({ title: areaTitle(a.parts), sub: subOf(a.parts) + nationalNote(a.parts, nRegions),
            note: regs.text + (a.lean_note ? `. ${a.lean_note[0].toUpperCase()}${a.lean_note.slice(1)}.` : ""),
            more: regs.more, rows: a.rows.map(r => row(r.label, r.kind, r.spans, r.source)) });
        }
        const without = Object.keys(cal.regions || {}).filter(n => !inArea.has(n)).sort((a, b) => a.localeCompare(b));
        if (without.length) {
          const w = listOf(`No agricultural calendar for ${without.length} region${without.length > 1 ? "s" : ""}`, without);
          notes.push(w.text + (w.more ? `, and ${w.more.length} more` : ""));
        }
      }
    } else {
      const u = (cal.regions || {})[region];
      const why = rainWhy(region);
      if (!u || !u.rows.length) {
        if (why) notes.push(why + ".");
        if (!oldFormat) empty = cal.farming_note || `No agricultural calendar for ${region} yet (planting, harvest, lean season).`;
      } else {
        // rain the forecast does not show (CHIRPS too thin here) is not drawn on the strip either: one coverage rule
        const rain = cov[region] && cov[region].hidden ? [] : u.rows.filter(r => r.kind === "rain");
        const crop = u.rows.filter(r => r.kind !== "rain");
        if (rain.length) groups.push({ title: "Rainy season", sub: null, note: null,
          rows: rain.map(r => row(region, r.kind, r.spans, r.source)) });          // the region's own months
        else if (why) notes.push(why + ".");
        if (crop.length && oldFormat && !crop.some(r => r.area)) {
          // an old file: the rows as served, no area named
          const ks = [...new Set(crop.map(r => KIND_WORD[r.kind]))];
          groups.push({ title: and(ks)[0].toUpperCase() + and(ks).slice(1), sub: subOf(partsOf(crop)), note: null,
            rows: crop.map(r => row(r.label, r.kind, r.spans, r.source)) });
        } else if (crop.length) {
          const parts = partsOf(crop);
          const placed = crop.find(r => r.placed);
          const fao = crop.find(r => r.crops);
          groups.push({ title: areaTitle(parts),
            sub: subOf(parts, (placed ? `, ${placed.placed}` : "") + (fao ? `, crops: ${fao.crops.join(", ")}` : ""))
              + nationalNote(parts, nRegions),
            note: u.lean_note && u.lean_note.text
              ? `${u.lean_note.text[0].toUpperCase()}${u.lean_note.text.slice(1)}.` : null,
            rows: crop.map(r => row(r.label, r.kind, r.spans, r.source)) });
        } else if (!oldFormat) {
          empty = cal.farming_note || `No agricultural calendar for ${region} yet (planting, harvest, lean season).`;
        }
      }
    }
    const kinds = [...new Set(groups.flatMap(g => g.rows.map(r => r.kind === "harvest" ? "planting" : r.kind)))];
    // one line per source key, as the served file describes it (method, credit or citation where it has one)
    const sources = used.map(k => {
      const s = srcOf(cal, k);
      return s.label + (s.method ? `: ${s.method}` : "") + (s.citation ? `. ${s.citation}` : "");
    });
    return { unit: region || cal.label, months, groups, empty, kinds, sources, notes,
             hasNow: months.some(m => m.now), fcLabel: opts.fcLabel || "" };
  }

  const CSS = `
  .ty-grid { display: grid; grid-template-columns: minmax(0, 7.5rem) repeat(12, minmax(0, 1fr)); gap: 3px 2px; align-items: center; }
  .ty-g { grid-column: 1 / -1; margin: 12px 0 2px; font-size: var(--fs-sm); color: var(--ink); font-weight: 600; }
  .ty-g small { display: block; font-weight: 400; color: var(--muted); }
  .ty-lab { font-size: var(--fs-sm); color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ty-cell { display: flex; height: 11px; background: var(--page); box-shadow: inset 0 0 0 1px var(--hairline); }
  .ty-cell.fc { background: color-mix(in srgb, var(--link) 8%, var(--page)); }
  .ty-cell i { flex: 1; }
  .ty-cell i.rain, .ty-sw.rain { background: color-mix(in srgb, var(--wet) 45%, var(--page)); }
  .ty-cell i.planting, .ty-cell i.harvest, .ty-sw.planting { background: color-mix(in srgb, var(--ink) 22%, var(--page)); }
  .ty-cell i.lean, .ty-sw.lean { background: color-mix(in srgb, var(--ink) 48%, var(--page)); }
  .ty-m { font-size: var(--fs-xs); color: var(--tick); text-align: center; line-height: 1.25; padding-top: 3px; }
  .ty-m b { display: block; font-weight: 600; font-size: 10px; letter-spacing: -.02em; }
  .ty-m.fc { color: var(--ink); font-weight: 600; }
  .ty-m.now { outline: 1.5px solid var(--ink); outline-offset: -1px; border-radius: 2px; }
  .ty-m1 { display: none; }
  .ty-note { grid-column: 1 / -1; font-size: var(--fs-xs); color: var(--muted); margin: 0 0 2px; }
  .ty-more { display: inline; } .ty-more summary { display: inline; cursor: pointer; color: var(--link); margin-left: 4px; }
  .ty-more[open] summary { display: none; }
  .ty-empty { font-size: var(--fs-sm); color: var(--muted); margin: 10px 0 0; }
  .ty-legend { display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 12px 0 0; font-size: var(--fs-sm); color: var(--muted); }
  .ty-legend span { display: inline-flex; align-items: center; gap: 6px; }
  .ty-sw { display: inline-block; width: 18px; height: 10px; box-shadow: inset 0 0 0 1px var(--hairline); }
  .ty-sw.fc { background: color-mix(in srgb, var(--link) 8%, var(--page)); }
  .ty-sw.now { box-shadow: inset 0 0 0 1.5px var(--ink); border-radius: 2px; }
  .ty-src { list-style: none; padding: 0; font-size: var(--fs-xs); color: var(--muted); margin: 8px 0 0; }
  .ty-src li + li { margin-top: 2px; }
  @media (max-width: 520px) {
    .ty-grid { grid-template-columns: minmax(0, 5.6rem) repeat(12, minmax(0, 1fr)); }
    .ty-lab { white-space: normal; line-height: 1.15; }
    .ty-m3, .ty-grid .ty-m b { display: none; } .ty-m1 { display: inline; }
  }
  @media print { .ty-cell, .ty-cell i, .ty-sw { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`;

  function render(el, cal, region, opts) {
    if (!document.getElementById("ty-style")) {
      const s = document.createElement("style"); s.id = "ty-style"; s.textContent = CSS; document.head.appendChild(s);
    }
    const M = model(cal, region, opts);
    const head = `<span></span>` + M.months.map(mo => `<span class="ty-m${mo.fc ? " fc" : ""}${mo.now ? " now" : ""}">`
      + `<span class="ty-m3">${MON[mo.m]}</span><span class="ty-m1" aria-hidden="true">${MON[mo.m][0]}</span>`
      + `${mo.m === 0 ? `<b>${mo.y}</b>` : ""}</span>`).join("");
    const body = M.groups.map(g => `<span class="ty-g">${esc(g.title)}${g.sub ? `<small>${esc(g.sub)}</small>` : ""}</span>`
      + g.rows.map(r => `<span class="ty-lab" title="${esc(r.label)}">${esc(r.label)}</span>`
        + r.cells.map((c, i) => `<span class="ty-cell${M.months[i].fc ? " fc" : ""}">`
          + c.map(x => `<i${x ? ` class="${r.kind}"` : ""}></i>`).join("") + `</span>`).join("")).join("")
      + (g.note ? `<p class="ty-note">${esc(g.note)}${g.more ? `<details class="ty-more"><summary>and ${g.more.length} more</summary>`
        + `${esc(g.more.join(", "))}</details>` : ""}</p>` : "")).join("");
    const LEG = { rain: "rainy season", planting: "planting and harvest", lean: "lean season" };
    el.innerHTML = (M.groups.length ? `<div class="ty-grid" role="img" aria-label="Typical year, ${esc(M.unit)}">${head}${body}</div>` : "")
      + M.notes.map(n => `<p class="ty-empty">${esc(n)}</p>`).join("")
      + (M.empty ? `<p class="ty-empty">${esc(M.empty)}</p>` : "")
      + (M.groups.length ? `<p class="ty-legend">` + M.kinds.map(k => `<span><i class="ty-sw ${k}"></i>${LEG[k]}</span>`).join("")
        + (M.fcLabel ? `<span><i class="ty-sw fc"></i>forecast months, ${esc(M.fcLabel)}</span>` : "")
        + (M.hasNow ? `<span><i class="ty-sw now"></i>this month</span>` : "") + `</p>`
        + `<ul class="ty-src" aria-label="Sources">${M.sources.map(s => `<li>${esc(s)}</li>`).join("")}</ul>` : "");
    return M;
  }

  window.ENSO_TYPICAL_YEAR = { model, render, sourceLine };
})();
