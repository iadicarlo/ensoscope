// One canonical name per climate index, for every page.
//
// The same index was being named three different ways: Teleconnections called
// Rx10day "10-day max rainfall", Replay called it "Heaviest 10-day rainfall",
// and the prose called it "RX10day". CDD was "Consecutive dry days" on one tab
// and "Longest dry spell" on the other. A reader moving between tabs has no
// way to know these are the same quantity, and that is the whole point of
// having both tabs.
//
// So the display name lives here, once, and every page reads it from here. The
// plain-language name leads because most readers are not climatologists; the
// index code follows in brackets so the tabs, the PDFs and the literature all
// line up. Data files may carry their own baked-in label; this table wins.
window.ENSO_INDEX = {
  pr_total:  { name: "Rainfall",                   code: null,      units: "mm" },
  rx10day:   { name: "Heaviest 10-day rainfall",   code: "Rx10day", units: "mm" },
  cdd:       { name: "Longest dry spell",          code: "CDD",     units: "days" },
  dry_days:  { name: "Dry days",                   code: null,      units: "days" },
  tmax:      { name: "Maximum temperature",        code: "Tmax",    units: "°C" },
  wbgt_max:  { name: "Heat stress",                code: "WBGT",    units: "°C" },
  utci_max:  { name: "Heat stress",                code: "UTCI",    units: "°C" },
  hw_days:   { name: "Daytime heatwave days",      code: null,      units: "days" },
};

// "Heaviest 10-day rainfall (Rx10day)". Falls back to null so a caller can
// keep whatever label it already had rather than printing "undefined".
window.ensoIndexName = function (id) {
  const e = window.ENSO_INDEX[String(id || "").replace(/_(anomaly|absolute|mm|days)$/, "")];
  if (!e) return null;
  return e.code ? `${e.name} (${e.code})` : e.name;
};
