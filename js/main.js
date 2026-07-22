/* =========================================================
   ANINA Wellness Sanctuary — interactions
   ========================================================= */
(function () {
  "use strict";

  /* ---------- year ---------- */
  var yr = document.getElementById("year");
  if (yr) yr.textContent = new Date().getFullYear();

  /* ---------- nav: solidify on scroll ---------- */
  var nav = document.getElementById("nav");
  function onScroll() {
    if (window.scrollY > 40) nav.classList.add("is-solid");
    else nav.classList.remove("is-solid");
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- mobile menu ---------- */
  var toggle = document.getElementById("navToggle");
  var links = document.querySelector(".nav__links");
  if (toggle && links) {
    toggle.addEventListener("click", function () {
      var open = links.classList.toggle("is-open");
      toggle.classList.toggle("is-active", open);
      toggle.setAttribute("aria-expanded", String(open));
    });
    links.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () {
        links.classList.remove("is-open");
        toggle.classList.remove("is-active");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  /* ---------- scroll reveal ---------- */
  var reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.classList.add("is-visible");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("is-visible"); });
  }

  /* ---------- gallery lightbox ---------- */
  var lb = document.getElementById("lightbox");
  var lbImg = document.getElementById("lightboxImg");
  var lbClose = document.getElementById("lightboxClose");
  function openLb(src, alt) {
    lbImg.src = src; lbImg.alt = alt || "";
    lb.classList.add("is-open"); lb.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }
  function closeLb() {
    lb.classList.remove("is-open"); lb.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    setTimeout(function () { lbImg.src = ""; }, 400);
  }
  document.querySelectorAll(".gallery__item").forEach(function (btn) {
    btn.addEventListener("click", function () {
      openLb(btn.getAttribute("data-full"), btn.querySelector("img").alt);
    });
  });
  if (lbClose) lbClose.addEventListener("click", closeLb);
  if (lb) lb.addEventListener("click", function (e) { if (e.target === lb) closeLb(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeLb(); });

  /* booking form + calendar handled in js/booking.js */
  var cfg = window.ANINA_CONFIG || {};

  /* ---------- instagram live feed ---------- */
  // If a widget snippet is configured, render the live auto-updating feed;
  // otherwise leave the on-brand fallback grid (which links to the profile).
  var ig = cfg.INSTAGRAM || {};
  var igFeed = document.getElementById("igFeed");
  function runEmbedScripts(container) {
    // innerHTML does not execute <script> tags — re-create them so they run.
    container.querySelectorAll("script").forEach(function (old) {
      var sc = document.createElement("script");
      if (old.src) sc.src = old.src; else sc.textContent = old.textContent;
      sc.async = true;
      old.parentNode.replaceChild(sc, old);
    });
  }
  var IG_GLYPH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.16c3.2 0 3.58 0 4.85.07 3.25.15 4.77 1.69 4.92 4.92.06 1.27.07 1.65.07 4.85s0 3.58-.07 4.85c-.15 3.23-1.66 4.77-4.92 4.92-1.27.06-1.65.07-4.85.07s-3.58 0-4.85-.07c-3.26-.15-4.77-1.7-4.92-4.92-.06-1.27-.07-1.65-.07-4.85s0-3.58.07-4.85C2.38 3.92 3.9 2.38 7.15 2.23 8.42 2.17 8.8 2.16 12 2.16zm0 3.68a6.16 6.16 0 100 12.32 6.16 6.16 0 000-12.32zm0 10.16a4 4 0 110-8 4 4 0 010 8zm6.4-10.4a1.44 1.44 0 100 2.88 1.44 1.44 0 000-2.88z"/></svg>';

  function escAttr(v) {
    return String(v || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // minimal CSV parser (handles quoted fields, embedded commas/newlines)
  function parseCSV(text) {
    var rows = [], row = [], cur = "", q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') { q = true; }
      else if (c === ",") { row.push(cur); cur = ""; }
      else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else if (c === "\r") { /* skip */ }
      else cur += c;
    }
    if (cur.length || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  function renderSheetFeed(rows) {
    if (!rows || !rows.length) return false;
    var find = function (re) { return header.findIndex(function (h) { return re.test(h); }); };
    var header = rows[0].map(function (h) { return String(h).trim().toLowerCase(); });
    var looksLikeHeader = header.some(function (h) { return /image|photo|img|url|src|caption|text|title|link|post|permalink/.test(h); });
    var iImg = 0, iCap = 1, iLink = 2, body = rows;
    if (looksLikeHeader) {
      var a = find(/image|photo|img|src|url/); iImg = a < 0 ? 0 : a;
      iCap = find(/caption|text|title|desc/);
      iLink = find(/link|post|permalink/);
      body = rows.slice(1);
    }
    var isUrl = function (v) { return /^https?:\/\//i.test(String(v || "").trim()); };
    var tiles = body
      .filter(function (r) { return isUrl(r[iImg]); })
      .slice(0, 12)
      .map(function (r) {
        var img = r[iImg].trim();
        var cap = iCap > -1 && r[iCap] ? r[iCap].trim() : "";
        var link = iLink > -1 && isUrl(r[iLink]) ? r[iLink].trim() : (ig.PROFILE_URL || "#");
        return '<a class="ig__tile" href="' + escAttr(link) + '" target="_blank" rel="noopener"' +
          (cap ? ' aria-label="' + escAttr(cap) + '"' : "") + '>' +
          '<img src="' + escAttr(img) + '" alt="' + escAttr(cap) + '" loading="lazy" />' +
          '<span class="ig__ov">' + IG_GLYPH + "</span></a>";
      });
    if (!tiles.length) return false;
    igFeed.innerHTML = '<div class="ig__grid">' + tiles.join("") + "</div>";
    return true;
  }

  if (igFeed) {
    if (ig.EMBED_HTML && ig.EMBED_HTML.trim()) {
      igFeed.innerHTML = ig.EMBED_HTML;
      runEmbedScripts(igFeed);
    } else if (ig.LIGHTWIDGET_ID && ig.LIGHTWIDGET_ID.trim()) {
      var id = ig.LIGHTWIDGET_ID.trim();
      igFeed.innerHTML =
        '<iframe src="https://lightwidget.com/widgets/' + id + '.html" ' +
        'scrolling="no" allowtransparency="true" class="lightwidget-widget" ' +
        'style="width:100%;border:0;overflow:hidden;"></iframe>';
      var lw = document.createElement("script");
      lw.src = "https://cdn.lightwidget.com/widgets/lightwidget.js";
      lw.async = true;
      document.body.appendChild(lw);
    } else if (ig.SHEET_CSV_URL && ig.SHEET_CSV_URL.trim()) {
      // Read a published Google Sheet (CSV) and build the grid from it.
      // On any failure (private sheet, HTML login page, no image rows) we
      // silently keep the on-brand fallback grid already in the page.
      fetch(ig.SHEET_CSV_URL.trim(), { cache: "no-store" })
        .then(function (r) { return r.ok ? r.text() : Promise.reject(r.status); })
        .then(function (text) {
          if (/^\s*</.test(text)) return; // got an HTML page, not CSV -> keep fallback
          renderSheetFeed(parseCSV(text));
        })
        .catch(function () { /* keep fallback grid */ });
    }
  }

})();
