/* =========================================================
   ANINA — Google Analytics 4 loader
   Loads gtag only when a Measurement ID is set in config.js.
   Works on any host (incl. github.io) — no custom domain needed.
   ========================================================= */
(function () {
  var id = (window.ANINA_CONFIG || {}).GA_ID;
  if (!id) return; // analytics off until an ID is provided
  var s = document.createElement("script");
  s.async = true;
  s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(id);
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag("js", new Date());
  window.gtag("config", id);
})();
