/* ENSOscope "What's new" - single source of truth for the changelog.
 *
 * EDIT THIS ARRAY ONLY. It feeds both the full updates.html page and the short
 * teaser on the landing page, so the two can never drift apart.
 *
 * Deliberately a .js file and not data/updates.json: the monthly refresh runs
 * `rsync -a --delete data/ website/data/`, which would delete a hand-authored
 * JSON that the build does not regenerate.
 *
 * Newest entry FIRST. Fields:
 *   date  - ISO "YYYY-MM-DD" (rendered as "31 July 2026")
 *   tag   - one of: "New data" | "New feature" | "Fix" | "Forecast update"
 *   title - short plain-language headline
 *   items - one or more plain-language bullets
 */
window.ENSOSCOPE_UPDATES = [
  {
    date: "2026-08-27",
    tag: "New data",
    title: "Reported disasters and outbreaks now cover all 83 countries",
    items: [
      "The impacts panel on the event replay tab went from ten countries to every country the tab supports: 6,257 recorded floods, droughts, heat waves and outbreaks, of which 72% name a place precise enough to put on a map.",
      "A plainer note now sits under the figure. EM-DAT holds only events that were reported and met its entry threshold, so most floods, droughts and outbreaks are missing from it, and how much is missing differs by country and has changed over the decades. A marker falling inside an El Nino or La Nina window shows only that both were recorded in the same months: it is a timeline, not evidence of cause.",
      "The extreme heat theme is often empty, and it now says why instead of leaving a blank. EM-DAT holds 181 heat waves but in only 31 of these 83 countries, with India, the United States and Japan accounting for a large share. That is a gap in reporting rather than an absence of dangerous heat, and the heat panels on the same page are measured from ERA5 and do not depend on a report being filed."
    ]
  },
  {
    date: "2026-08-26",
    tag: "New data",
    title: "Observations now run through July 2026",
    items: [
      "One more month of CHIRPS rainfall and ERA5 heat, across the world maps, the country charts and the sub-national zoom.",
      "The sea surface temperature record and the global mean temperature used for detrending already held July. Both are monthly, so July is the newest month that can exist, and they were current already."
    ]
  },
  {
    date: "2026-08-26",
    tag: "New data",
    title: "Observations now run through June 2026",
    items: [
      "The maps and charts reached April 2026; they now reach June. Two more months of CHIRPS rainfall and of ERA5 heat, across the world maps, the country charts and the sub-national zoom.",
      "The Teleconnections maps deliberately do not include 2026. Classifying an El Nino or La Nina intensity takes about five months, so the developing event has no settled classification yet and its months cannot join a phase composite without changing what the composite means. They enter once the event resolves.",
      "Two faults were found and fixed on the way. The build skips work whose inputs have not changed, and that check could not read the disk it was checking, so it reported everything up to date and skipped seven of the eleven gridded stores. The site's own audit caught the result before it was published, which is what it is for.",
      "The second was quieter: the maps had moved to June while the charts under them were still at April, in the same panel. That is the failure the coverage module was written to prevent, and nothing compared those two stores to each other. A check now does, and it was proven on the live fault rather than a made-up one."
    ]
  },
  {
    date: "2026-08-26",
    tag: "New feature",
    title: "Event replay now shows what was recorded on the ground during an event",
    items: [
      "The replay page answered what the climate did. It could not answer whether anything happened. A new panel puts the disasters and outbreaks EM-DAT recorded in that country, during that window, on the same month axis as the charts above it: a dot on the month each one began, coloured by what it was, with its duration trailing behind. Reading down the page you now get sea surface temperature, then rainfall against normal, then what was reported.",
      "The method follows Anyamba et al. 2019, which is explicit that this shows timing and presence, never size. Reporting quality varies by country and has improved over time, so drawing markers by death toll would rank countries by how well they report rather than by what happened to them. Every marker is the same size for that reason.",
      "Placement is the part that had to be right. EM-DAT records where an event happened as free text, and matching an admin-1 name inside it put six events in a region their source never named: \"northeastern\" matched Eastern, \"Nigeria\" matched Niger state, \"Galmudug\" matched Mudug. On a map that is indistinguishable from evidence. A name must now match as a whole word, with a short list of real spelling variants. 60% of events name a place we hold a boundary for; the rest appear on the timeline as hollow rings and are never put on a map.",
      "Switching to Extreme heat switches the driver to heat stress, days above UTCI 32 °C against a neutral year, rather than leaving rainfall underneath it. EM-DAT files heat and cold together under one type, so nearly half of those records are cold waves; only heat waves appear under a heat theme now. That leaves two heat waves across ten countries and 46 years, and both are visible in our own indices at the region where they were recorded.",
      "Ten countries to start: Kenya, Somalia, Ethiopia, Sudan, South Sudan, Chad, DR Congo, Nigeria, Venezuela and Honduras. EM-DAT is the first source, not the only one; the panel names its sources from the data, so others can join it without the page changing."
    ]
  },
  {
    date: "2026-08-25",
    tag: "New data",
    title: "Heat and warm-night counts are now bands, not running totals",
    items: [
      "Every heat count used to be cumulative: days at or above 32 °C, at or above 38, at or above 46. That is honest, and it was labelled that way, but it makes the three numbers impossible to read together. A day at UTCI 47 was counted in all three, so the series could not be compared and could not be added up, and the extreme count was hidden inside the other two.",
      "They are now disjoint bands: 32 to 38, 38 to 46, and 46 and above. Each day falls in exactly one. The same applies to WBGT (29-31, 31-32, 32+) and warm nights (20-25, 25-30, 30+). Requested by the humanitarian teams in August 2026.",
      "Nothing published before was wrong, and the totals still agree: checked across 11.7 million grid cells, the three bands sum to the old cumulative count exactly, and the top band is unchanged. What changes is what you can see. A place that recorded 31 days above 32 °C now reads 16 + 15 + 0, which says something the single number could not: it had no extreme days at all.",
      "This affects the Teleconnections maps, the Event replay charts and their maps. Observations reach April 2026."
    ]
  },
  {
    date: "2026-08-14",
    tag: "Fix",
    title: "Event replay now opens on a blank page, and any chart can be enlarged",
    items: [
      "The replay page used to open on the developing El Niño. That looked like the most useful default and was the opposite: the monthly maps are built from complete years of observations and currently end in December 2025, while the developing event's window runs from January 2026. The two did not overlap by a single month, so the maps were blank at every position of the month slider and the only thing that changed as you dragged was the year label. Reported from the field, and correctly.",
      "The page now opens with no event chosen and asks you to pick one. Every event you can pick has maps behind it. Nothing else about the page changed.",
      "\"Same type and intensity only\" is now disabled while the developing event is selected, and says why. Classifying an intensity takes five months, so a developing event does not have one yet and the option quietly drew the same lines as \"Other events of the same type\". For past events the two are unchanged and do differ: 1997-98 compares against eleven other El Niños, or against 1982-83 alone.",
      "The charts now carry real dates along the bottom, 1997 and 1998 rather than \"year 0\" and \"year 1\". The relative labelling was there because the grey comparison lines come from different decades and share one axis, which is true but answered a question nobody was asking: you follow the coloured line, and it happened in known years. The dates are that event's, and the note under each chart says so.",
      "Any of the eight charts can now be enlarged: hover a panel and click Enlarge, or press Escape to close. The large copy is drawn from the same data as the small one, including a selected sub-national region and the chosen heat threshold, so the two cannot disagree.",
      "A check now runs before every deploy that resolves whichever event the page would open on against the months it can actually draw, and fails if there is no overlap. The two halves of this bug were each internally consistent, which is why nothing caught it before."
    ]
  },
  {
    date: "2026-08-14",
    tag: "Forecast update",
    title: "August forecast: the extreme El Niño is here, not just ahead",
    items: [
      "ECMWF SEAS5 and Météo-France System 9 are updated to the August 2026 start, with refreshed sea surface temperature maps for all six lead months.",
      "The headline has changed in kind, not just in degree. July put extreme El Niño at 69% by December, a forecast about the future. August puts SEAS5 at 74% extreme for August itself, peaking at 80% in September. Read alongside the observed index reaching +2.17 standard deviations in June, this is an event that has arrived rather than one that is coming.",
      "The two centres agree on what and disagree on when, and the gap is wider than usual, so it is worth stating rather than smoothing over. SEAS5 peaks early, 80% extreme in September, easing to 24% by January 2027. Météo-France does close to the opposite: nothing extreme in August, then 98 to 100% from October and staying there through January. Both say extreme El Niño; they differ on whether it peaks this autumn or persists into next year. Where the dashed forecast lines on the Event replay page spread apart, that gap is the honest uncertainty.",
      "For planning purposes the useful reading is the overlap rather than either line alone: both centres put the October to December window in the strong-to-extreme range, and that is the part they agree on."
    ]
  },
  {
    date: "2026-08-13",
    tag: "New feature",
    title: "Event replay goes sub-national: click a province, get its own history",
    items: [
      "The replay maps now carry admin-1 boundaries, and clicking one puts that province into every chart below it. All six panels switch together, in the same units and against the same normal-year reference as the country view, so nothing changes meaning under you. Click the province again, or use the button, to go back to the whole country.",
      "Underneath the maps there is now a table of every region for the month on screen, one column per event, sorted worst first. It answers the question a map cannot: not where the rain fell, but how much. In January 1997 Nord-Kivu ran 51 mm above a normal January while Bas-Congo ran 27 mm below, in the same country in the same month.",
      "Each figure carries a ± that is the spread of the 0.25° cells inside that region, which is a different question from the average and sometimes contradicts it. Katanga reads +18 ± 25 mm: the spread is larger than the mean, so part of the province went the other way and calling it a wet province would be wrong. Bandundu in January 2023 reads +2 ± 39 mm, which is not a province where nothing happened, it is a province split down the middle.",
      "Both sources, at full resolution: four rainfall and drought indices from CHIRPS and seven heat and warm-night indices from ERA5, for 82 countries and 1,737 regions, every month from 1981 to 2025, computed on the 0.25° grid rather than the 1° one the world map uses.",
      "The boundaries are Natural Earth, which for a few countries are the older administrative divisions: DR Congo appears as its eleven pre-2015 provinces, and Kenya as its former provinces rather than its 47 counties. A handful of very small units are left out entirely, Nairobi among them, because they are smaller than three grid cells and an average over one or two pixels is noise rather than a measurement. Where a finer or more current split is needed for operational work, tell us the country and we will move it to the OCHA humanitarian boundaries."
    ]
  },
  {
    date: "2026-08-13",
    tag: "Fix",
    title: "Three things that were quietly wrong on the replay page",
    items: [
      "Switching country could leave the previous country's maps on screen under the new country's name. The panels load asynchronously, so a slow request finished after a fast one and painted over it; on a good connection the wrong map was visible for a full second, and much longer on a poor one. Only the newest request can draw now, and the panels say which country they are loading instead of showing the last one.",
      "The month readout printed the full date and value inside every chart, covering the first months of the series in all six panels at once. It now shows the value alone, above the plot rather than on top of it, and the hover tooltip is about half its former width.",
      "The printed PDF silently dropped the new regional table for anyone who had not expanded it on screen, and would have cut the table off at whatever fitted the scroll box. Both fixed: the sheet always carries the full table."
    ]
  },
  {
    date: "2026-08-13",
    tag: "New data",
    title: "Every observation refreshed, and the whole site rebuilt on it",
    items: [
      "The observational records behind the site have been refreshed and every product downstream of them rebuilt: the ENSO index, the event catalogue, the seasonal composites for all four seasons, the country series, the monthly fields and every map tile. Nothing on the site is a mixture of vintages any more.",
      "The refresh moved the event catalogue itself. Classifying an El Niño or a La Niña means removing the long-term warming trend first, and refreshing the temperature record changes that trend a little, which is enough to move individual months between classes. Since every anomaly here is measured against neutral years, changing which months count as neutral shifts numbers across the whole site. The shifts are small, but they are real, and they are the reason everything was rebuilt in one pass rather than patched.",
      "The observed index now runs to June 2026 and reads +2.17 standard deviations, up from +1.51 in May and +0.78 in April. That is a fast warming by any standard.",
      "It is worth being exact about what that does and does not mean, because two parts of the site describe it in two different ways and both are correct. The sea surface is already at strong El Niño amplitude, which is what the forecast headline on the front page reflects. What has not happened yet is classification: an event has to persist for five months before the catalogue records it as one, and this warming is three months old, so the catalogued period is still neutral. That is why the replay page calls it an El Niño developing rather than naming it, and why it does not yet appear among the historical events you can compare against."
    ]
  },
  {
    date: "2026-08-13",
    tag: "Fix",
    title: "The replay maps no longer answer a different question when you run past the record",
    items: [
      "An event's replay window is padded to whole calendar years, so it runs to the end of the year the event finished in, while the observations stop at the last complete year. Stepping the month slider into that gap used to leave the world map showing the average of the entire event, under a label naming a single month. That is precisely the confusion the month slider was added to remove.",
      "Those months now say so plainly instead. This is most visible on current conditions, where the window is 2026 to 2027 and the mapped record does not reach it yet: the comparison panel beside it still shows the event you are comparing against, which is the useful half of that view."
    ]
  },
  {
    date: "2026-08-13",
    tag: "New feature",
    title: "Event replay, rebuilt: eleven indices, month by month, side by side",
    items: [
      "The maps now move with time. A month slider steps the world map and both country panels together through an event, so you watch a season develop instead of reading one average for the whole thing. That distinction is usually the point: two seasons often differ less in how much rain fell than in when it fell.",
      "The chosen country is drawn twice, side by side, on one shared colour scale: your event on the left, any other event of the same kind on the right. Pick any month and compare November 1997 against November 2023 directly.",
      "Eleven indices, the same set as the Teleconnections maps: rainfall, the heaviest 10-day rainfall, the longest dry spell, dry days, maximum temperature, and heat stress and warm nights at each of their three health thresholds. Every one has a map and a time series underneath it, two to a row.",
      "Anomalies across the whole site now mean one thing: the departure from a neutral year. The replay tab had been using the 1991-2020 normal, which contains the 1997-98 and 2015-16 El Niños and the 1998-2001 and 2020-23 La Niñas, so an event measured against it was partly measured against itself.",
      "Point at any map to read the latitude, longitude and value under the cursor, and at any grey comparison line to see which event it is. The charts mark the month the maps are showing, with its date and value.",
      "Three corrections worth naming. The maps carried real values over the ocean, because ERA5 reports a temperature over the sea and a dry-day count turns missing rainfall into a legitimate-looking zero; everything is now masked to land. Several colour scales were wrong by up to forty times, which is why the dry-day and heat-stress maps looked blank while the rainfall map saturated; every scale is now measured from its own data. And the live forecast shows both centres, ECMWF SEAS5 and Météo-France System 9, in the same colours the Forecast tab uses.",
      "One limit stated plainly: the maps are drawn at 1°, while the country time series use the full 0.25° of the source data. On a world map a 0.25° cell is half a pixel, so nothing is lost there; on the country zoom it would be a real improvement, and that version is built and waiting on somewhere large enough to host it."
    ]
  },
  {
    date: "2026-08-11",
    tag: "New feature",
    title: "Replay a past El Niño, and new all-events map layers",
    items: [
      "New Event replay page, under Teleconnections. Pick a past El Niño or La Niña and a country, and follow it month by month instead of averaged into a season: sea surface temperature, rainfall, dry days, days of strong heat stress and warm nights, from January of the year it began to December of the year it ended. Every other observed event of the same type is drawn faintly behind, lined up on January of its own first year, so you can see at a glance whether the one you picked was doing something unusual. Countries are chosen by clicking a map.",
      "The Teleconnections map gains an All El Niño events and an All La Niña events option, which average over every event of that sign whatever its intensity, for rainfall, drought and heat, from both the observations and the model. These are now the default, because splitting an already short observed record into intensity classes leaves as few as one event in a class.",
      "Robustness dots on the observed layers now appear only on those pooled all-events layers. On a single intensity class the observed record holds between one and seven events, and for strong La Niña it is a single event in every season, where agreement is 100 percent by definition so no dot could ever be drawn and the map would read as completely reliable on the strength of one event. Those layers now say plainly that there are too few events to test, instead of staying silent. The model layers, with hundreds of events per class, keep their dots throughout.",
      "On the replay page, an event that is still running also carries the live ECMWF forecast: all 51 members of the sea surface temperature plume, dashed so it cannot be mistaken for something that has already happened. It appears only where the forecast actually overlaps the window, so a finished event shows none. The rainfall and heat panels deliberately stop at the observed record, because there is no calibrated forecast of country rainfall or heat behind this site and extrapolating one from the sea surface temperature forecast would be a much larger claim than that forecast supports.",
      "The maps also load faster. Every tile used to carry its own copy of the same list of land grid cells; that list is now stored once and shared, which removed about 380 MB of duplication without changing a single value on any map.",
      "One correction to the heat layers: the underlying UTCI and WBGT archive turned out to be missing whole months in ten years, which was quietly pulling some seasonal averages down, including for the neutral baseline that every anomaly is measured against. Affected seasons are excluded for now rather than shown wrong, and the missing months are being rebuilt from source."
    ]
  },
  {
    date: "2026-08-11",
    tag: "New data",
    title: "Health heat thresholds are now map layers, and heat maps finally show robustness",
    items: [
      "The nine fixed-temperature heat indicators are now selectable on the Teleconnections map, for all four seasons, from both the observations and the CESM2 model ensemble, as an absolute count and as an anomaly against neutral. Days of at least strong, very strong and extreme heat stress on the UTCI scale; days above the three WBGT thresholds; and tropical, equatorial and torrid nights.",
      "The heat layers now draw robustness dots. They never did before, and that was a defect rather than a design choice: the agreement between past events was only ever computed for the two rainfall layers, so every heat map was published without it and drew no dots at all, which reads as though every pixel were robust. Agreement is now computed and shown for every heat layer on both sources.",
      "Two of the layers behave differently on purpose. Extreme heat stress (UTCI at or above 46 °C) and torrid nights (at or above 30 °C) are reached on only one to three percent of land, and in those places the count is already close to the seasonal maximum, so El Niño and La Niña barely move it. Their anomaly maps therefore use a much narrower colour range, so that the small real signal is visible instead of being flattened into an apparently blank map.",
      "A reminder carried on the Methodology page: fixed thresholds read the actual temperature, so unlike the percentile-based layers they inherit any model bias directly. Read the model layers as the change El Niño brings, and the observations for the absolute counts."
    ]
  },
  {
    date: "2026-08-11",
    tag: "New feature",
    title: "Heat thresholds that carry a direct health meaning",
    items: [
      "The Methodology page now documents a set of fixed-temperature heat indicators, added at the request of the humanitarian teams so that a number can be read as days of at least strong heat stress rather than days above the local 90th percentile. They are: UTCI at or above 32, 38 and 46 °C (strong, very strong and extreme heat stress on the standard scale); WBGT at or above 29, 31 and 32 °C, approximately the US National Weather Service category edges; and nights whose minimum stays at or above 20, 25 and 30 °C (tropical, equatorial and torrid nights). The map layers themselves follow shortly; the definitions and sources are published first.",
      "These are reported from the observations only, and the Methodology page explains why. A percentile threshold is defined from the data's own distribution, so a uniform warm or cold bias cancels out. A fixed threshold reads the actual value, so a bias lands directly in the day count: measured on ERA5, a 1 °C warm bias adds around 6 days per season over the Horn of Africa and 10 over Southeast Asia, which is as large as the El Niño signal itself. The percentile-based layers remain the ones to use with the model ensemble.",
      "A note has also been added on the WBGT formula used here, which relies on temperature and humidity alone and assumes light winds and fairly sunny conditions. That approximation is fine for a seasonal average but less so for counting threshold crossings, so UTCI is the more reliable of the two for this purpose."
    ]
  },
  {
    date: "2026-08-11",
    tag: "Fix",
    title: "Rainfall and heat composites rebuilt after a season-window bug",
    items: [
      "A question from the humanitarian teams about the drought layer uncovered a bug in how each El Niño or La Niña event was cut down to a single season. For seasons that do not cross the new year (spring, summer, autumn) the code kept every matching month in the event, so a neutral period lasting several years contributed several summers while an event contributed one. Metrics that grow with the length of the window, such as the longest dry spell and the heaviest 10-day rainfall, were inflated for the neutral baseline, which pushed every anomaly in the same direction regardless of whether it was an El Niño or a La Niña. Winter was never affected.",
      "All affected layers have been recomputed: observed rainfall and drought, observed heat, and the CESM2 model equivalents. The heat layers were also carrying a separate counting error that inflated heatwave days for longer events. Heatwave days now correctly show El Niño hotter and La Niña cooler, which the previous version had the wrong way round in summer.",
      "The methodology page has been corrected too: it implied the composited fields were detrended for global warming, when that correction is applied to the El Niño indices used for classification, not to the maps themselves."
    ]
  },
  {
    date: "2026-08-07",
    tag: "Fix",
    title: "Robustness dots on the drought layer",
    items: [
      "The observed drought layer offered a robustness toggle but never drew any dots, which read as though every pixel was robust. The real reason is sample size: with only two or three observed El Niño events the agreement between events can only take a few values (100%, 67%, 50%) and never falls below the 60% threshold that triggers a dot. The map now says this directly instead of staying silent, and points to the CESM2 ensemble, where hundreds of events make the robustness test meaningful."
    ]
  },
  {
    date: "2026-07-31",
    tag: "New data",
    title: "Heat indicators from the climate model ensemble",
    items: [
      "Heat is now available from the CESM2 large ensemble (50 model runs over 1850 to 2014), not only from observations: maximum temperature, daytime, nighttime and compound heatwave days, WBGT and UTCI. The observed record contains only a handful of strong El Niño events, so the ensemble fills in where observations alone are too thin to show a clear signal.",
      "Absolute temperature maps now use a blue to red scale centred at 0 °C, so cold seasons show their real values instead of being flattened to a single colour."
    ]
  },
  {
    date: "2026-07-30",
    tag: "New data",
    title: "Nighttime and compound heat in the observations",
    items: [
      "Added observed maximum temperature (Tmax), nighttime heatwave days, and compound heatwave days (hot by day and by night at once), following the daytime, nighttime and compound framework of Zhang et al. (2025)."
    ]
  },
  {
    date: "2026-07-30",
    tag: "Fix",
    title: "Country labels, and the missing contexts",
    items: [
      "Fixed the country drill-down labels. Some countries were being matched to a neighbour, so for example Mali was labelled as Nigeria.",
      "Added South Sudan, Uganda, Rwanda, Burundi, DR Congo, Central African Republic, Niger, Mali, Chad, Burkina Faso, Malawi, Afghanistan and Syria to the country drill-down."
    ]
  },
  {
    date: "2026-07-21",
    tag: "Fix",
    title: "Map colours",
    items: [
      "Fixed inverted colours on the absolute dry and heat layers, so drier and hotter now read as darker.",
      "Fixed colour bars smearing in long bands across the globe when the map was rotated."
    ]
  },
  {
    date: "2026-07-14",
    tag: "Forecast update",
    title: "July 2026 forecast",
    items: [
      "ECMWF SEAS5 and Météo-France updated to the July 2026 start, with refreshed sea surface temperature maps.",
      "Fixed a Météo-France skill bug where some ECMWF hindcast files were being counted in its verification."
    ]
  },
  {
    date: "2026-07-08",
    tag: "New feature",
    title: "Walkthrough video",
    items: [
      "Added a four minute captioned walkthrough video to the Guide.",
      "Clarified the difference between forecast models and climate models, and corrected the dataset wording (ERA5 is a reanalysis, not a direct observation)."
    ]
  },
  {
    date: "2026-06-30",
    tag: "New feature",
    title: "The Guide",
    items: [
      "New Guide tab: a plain-language walkthrough built around a worked example (a hospital in Kenya), a map-reading legend, and a glossary that explains CESM2, CHIRPS, ERA5, Rx10day, CDD and WBGT in plain words.",
      "Plain-language labels across the Teleconnections and Skill pages."
    ]
  },
  {
    date: "2026-06-24",
    tag: "Fix",
    title: "Skill verification",
    items: [
      "Fixed a year-rollover bug in the skill calculation. Forecasts valid from December into January were being compared against the wrong year's observations, which had produced a spurious negative band in the skill heatmaps."
    ]
  }
];

(function () {
  var MONTHS = ["January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December"];

  function prettyDate(iso) {
    var p = String(iso).split("-");
    if (p.length !== 3) return iso;
    return parseInt(p[2], 10) + " " + MONTHS[parseInt(p[1], 10) - 1] + " " + p[0];
  }

  function tagClass(tag) {
    return "upd-tag upd-tag-" + String(tag).toLowerCase().replace(/[^a-z]+/g, "-");
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  var list = window.ENSOSCOPE_UPDATES || [];

  // ── Full list (updates.html) ───────────────────────────────────────────────
  var host = document.getElementById("updates-list");
  if (host && list.length) {
    host.innerHTML = list.map(function (u) {
      return '<article class="upd">' +
        '<div class="upd-meta"><time datetime="' + esc(u.date) + '">' + prettyDate(u.date) + "</time>" +
          '<span class="' + tagClass(u.tag) + '">' + esc(u.tag) + "</span></div>" +
        '<div class="upd-body"><h3>' + esc(u.title) + "</h3><ul>" +
          u.items.map(function (i) { return "<li>" + esc(i) + "</li>"; }).join("") +
        "</ul></div></article>";
    }).join("");
  }

  // ── Landing-page teaser: the most recent entry only ────────────────────────
  var teaser = document.getElementById("whats-new-teaser");
  if (teaser && list.length) {
    var u = list[0];
    // Mirrors the "New here?" callout: icon + one flowing sentence with the
    // link inline, so the two bands read as siblings rather than two designs.
    teaser.innerHTML =
      '<div class="intro-news">' +
        '<svg class="in-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#1565C0" ' +
          'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/>' +
          '<path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>' +
        '<p><strong class="in-lead">What\'s new</strong> ' +
          '<span class="in-date">' + prettyDate(u.date) + "</span>: " +
          esc(u.title) + ". " +
          '<a href="updates.html">All updates &rarr;</a></p>' +
      "</div>";
    teaser.style.display = "";
  }
})();
