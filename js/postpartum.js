/* =========================================================
   ANINA × Coach Joycee — postpartum landing interactions
   ========================================================= */
(function () {
  "use strict";

  var yr = document.getElementById("ppYear");
  if (yr) yr.textContent = new Date().getFullYear();

  /* sticky bar solidify */
  var bar = document.getElementById("ppBar");
  function onScroll() {
    if (window.scrollY > 40) bar.classList.add("is-solid");
    else bar.classList.remove("is-solid");
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* scroll reveal */
  var reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("is-visible"); io.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("is-visible"); });
  }

  /* booking calendar + submit handled in js/booking.js */

  /* sticky CTA bar — show past the hero, hide when the form is on screen */
  var sticky = document.getElementById("ppSticky");
  var bookEl = document.getElementById("ppForm");
  function toggleSticky() {
    if (!sticky || !bookEl) return;
    var pastHero = window.scrollY > window.innerHeight * 0.7;
    var r = bookEl.getBoundingClientRect();
    var bookOnScreen = r.top < window.innerHeight * 0.75 && r.bottom > 0;
    sticky.classList.toggle("is-shown", pastHero && !bookOnScreen);
  }
  window.addEventListener("scroll", toggleSticky, { passive: true });
  window.addEventListener("resize", toggleSticky);
  toggleSticky();

})();
