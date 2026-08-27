/* site.js - shared site chrome loaded on every page:
   - click/tap-to-open nav dropdowns (idempotent; works on touch)
   - "About" nav link
   - mobile hamburger menu
   - site footer with author credit, contact, and data-source pointer
   Self-contained and safe to load alongside app.js. */
(function () {
  function wireNavDropdowns() {
    document.querySelectorAll(".nav-dropdown-toggle").forEach(function (t) {
      if (t.dataset.navWired) return;
      t.dataset.navWired = "1";
      t.addEventListener("click", function (e) {
        e.stopPropagation();
        var parent = t.closest(".nav-dropdown");
        if (!parent) return;
        var wasOpen = parent.classList.contains("open");
        document.querySelectorAll(".nav-dropdown.open").forEach(function (p) {
          if (p !== parent) p.classList.remove("open");
        });
        parent.classList.toggle("open", !wasOpen);
      });
    });
    // Selecting an item closes its dropdown (so it never stays stuck open,
    // including when the link points back to the current page).
    document.querySelectorAll(".nav-dropdown-menu a").forEach(function (link) {
      if (link.dataset.navLinkWired) return;
      link.dataset.navLinkWired = "1";
      link.addEventListener("click", function () {
        document.querySelectorAll(".nav-dropdown.open").forEach(function (p) { p.classList.remove("open"); });
      });
    });
    if (!document.body.dataset.navOutsideWired) {
      document.body.dataset.navOutsideWired = "1";
      document.addEventListener("click", function (e) {
        if (e.target.closest(".nav-dropdown")) return;
        document.querySelectorAll(".nav-dropdown.open").forEach(function (p) { p.classList.remove("open"); });
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") {
          document.querySelectorAll(".nav-dropdown.open").forEach(function (p) { p.classList.remove("open"); });
        }
      });
    }
  }

  function injectChrome() {
    var headerInner = document.querySelector(".header-inner");
    var nav = headerInner ? headerInner.querySelector("nav") : null;

    if (nav && !nav.querySelector('a[data-nav="guide"]')) {
      var gl = document.createElement("a");
      gl.href = "guide.html";
      gl.textContent = "Guide";
      gl.setAttribute("data-nav", "guide");
      if (document.body.dataset.page === "guide") gl.classList.add("active");
      // place Guide as the SECOND tab, right after Forecast
      nav.insertBefore(gl, nav.children[1] || null);
    }

    if (nav && !nav.querySelector('.nav-dropdown[data-nav-group="about"]')) {
      var page = document.body.dataset.page;
      var isAbout = (page === "about" || page === "methodology" || page === "updates");
      var dd = document.createElement("div");
      dd.className = "nav-dropdown";
      dd.setAttribute("data-nav-group", "about");
      dd.innerHTML =
        '<span class="nav-dropdown-toggle' + (isAbout ? " active" : "") + '" data-nav="about">About</span>' +
        '<div class="nav-dropdown-menu">' +
          '<a href="updates.html" data-nav-item="updates"' + (page === "updates" ? ' class="active"' : "") + ">What's new</a>" +
          '<a href="about.html" data-nav-item="about_me"' + (page === "about" ? ' class="active"' : "") + ">About and contact</a>" +
          '<a href="methodology.html" data-nav-item="methodology"' + (page === "methodology" ? ' class="active"' : "") + ">Methodology and data</a>" +
        "</div>";
      nav.appendChild(dd);
    }

    if (headerInner && nav && !headerInner.querySelector(".nav-toggle")) {
      var btn = document.createElement("button");
      btn.className = "nav-toggle";
      btn.type = "button";
      btn.setAttribute("aria-label", "Toggle navigation");
      btn.innerHTML = "<span></span><span></span><span></span>";
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        headerInner.classList.toggle("nav-open");
      });
      headerInner.appendChild(btn);
      nav.addEventListener("click", function (e) {
        if (e.target.tagName === "A") headerInner.classList.remove("nav-open");
      });
    }

    if (!document.querySelector("footer.site-footer")) {
      var f = document.createElement("footer");
      f.className = "site-footer";
      f.innerHTML =
        '<div class="footer-inner">' +
          '<div class="footer-col">' +
            '<div class="footer-title">ENSOscope</div>' +
            '<p>Operational El Niño / La Niña forecasts and teleconnection maps, turning seasonal climate forecasts into regional signals for anticipatory action.</p>' +
            '<p class="footer-muted">Created by Isma Abdelkader Di Carlo (PhD).</p>' +
          '</div>' +
          '<div class="footer-col">' +
            '<div class="footer-title">Explore</div>' +
            '<a href="guide.html">Guide</a>' +
            '<a href="index.html">Forecast</a>' +
            '<a href="map_explorer.html">Teleconnections</a>' +
            '<a href="event_replay.html">Event replay</a>' +
            '<a href="hindcast_skill.html">Skill</a>' +
            '<a href="methodology.html">Methodology and data sources</a>' +
            '<a href="updates.html">What&rsquo;s new</a>' +
            '<a href="about.html">About and contact</a>' +
          '</div>' +
          '<div class="footer-col">' +
            '<div class="footer-title">Contact and code</div>' +
            '<a href="https://iadicarlo.org" target="_blank" rel="noopener">iadicarlo.org</a>' +
            '<a href="https://github.com/iadicarlo" target="_blank" rel="noopener">github.com/iadicarlo</a>' +
            '<a href="about.html">Full contact details</a>' +
            '<p class="footer-muted">All input datasets are open and cited on the Methodology page.</p>' +
          '</div>' +
        '</div>' +
        '<div class="footer-bottom">For research and humanitarian decision-support. Seasonal forecasts carry real uncertainty; read the Skill and Methodology pages before acting on them.' +
          '<span style="display:block;margin-top:0.85rem;opacity:0.8">© 2026 Isma Abdelkader Di Carlo · Content licensed <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline">CC BY 4.0</a> · Underlying datasets keep their own licenses (see Methodology).</span></div>';
      document.body.appendChild(f);
    }
  }

  function init() { injectChrome(); wireNavDropdowns(); }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
