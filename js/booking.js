/* =========================================================
   ANINA — reusable weekly booking calendar
   Mounts on any page that has a #cal block with #calHead /
   #calBody. Configured via data-* on #cal:
     data-source          -> row "Source" value
     data-form            -> id of the contact form (default "bookingForm")
     data-service-default -> Service value when the form has no service field
   Submits all selected slots to the shared Google Sheet endpoint.
   ========================================================= */
(function () {
  "use strict";

  var head = document.getElementById("calHead");
  var body = document.getElementById("calBody");
  var calEl = document.getElementById("cal");
  if (!head || !body || !calEl) return;

  var cfg = window.ANINA_CONFIG || {};
  var SOURCE = calEl.dataset.source || "website-calendar";
  var SERVICE_DEFAULT = calEl.dataset.serviceDefault || "";
  var form = document.getElementById(calEl.dataset.form || "bookingForm");

  var FIRST = 6, LAST = 21, ROW = 48, MAX_WEEKS = 8;
  var OPEN = { 0: [7, 13], 1: [6, 21], 2: [6, 21], 3: [6, 21], 4: [6, 21], 5: [6, 21], 6: [6, 21] };
  var DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  var now = new Date();
  var baseMonday = mondayOf(now);
  var weekOffset = 0;
  var selections = [];
  var drag = null;

  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function isoDate(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function mondayOf(d) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); var wd = (x.getDay() + 6) % 7; return addDays(x, -wd); }
  function hourLabel(h) { var ap = h < 12 ? "AM" : "PM"; var hh = h % 12; if (hh === 0) hh = 12; return hh + " " + ap; }
  function hourFull(h) { var ap = h < 12 ? "AM" : "PM"; var hh = h % 12; if (hh === 0) hh = 12; return hh + ":00 " + ap; }
  function weekMonday() { return addDays(baseMonday, weekOffset * 7); }

  function render() {
    var mon = weekMonday(), days = [];
    for (var i = 0; i < 7; i++) days.push(addDays(mon, i));
    var sun = days[6];
    var rng = document.getElementById("calRange");
    if (rng) rng.textContent = MON[mon.getMonth()] + " " + mon.getDate() + " – " +
      (mon.getMonth() === sun.getMonth() ? "" : MON[sun.getMonth()] + " ") + sun.getDate() + ", " + sun.getFullYear();
    var pv = document.getElementById("calPrev"), nx = document.getElementById("calNext");
    if (pv) pv.disabled = weekOffset <= 0;
    if (nx) nx.disabled = weekOffset >= MAX_WEEKS;

    var todayISO = isoDate(now);
    var h = '<div class="cal__corner"></div>';
    days.forEach(function (d) {
      var today = isoDate(d) === todayISO ? " is-today" : "";
      h += '<div class="cal__dayhead' + today + '"><div class="dow">' + DOW[d.getDay()] + '</div><div class="dnum">' + d.getDate() + '</div></div>';
    });
    head.innerHTML = h;

    var b = '<div class="cal__gutter">';
    for (var hr = FIRST; hr < LAST; hr++) b += '<div class="cal__hourlabel">' + hourLabel(hr) + '</div>';
    b += '</div>';
    days.forEach(function (d) {
      var iso = isoDate(d), isToday = iso === todayISO, open = OPEN[d.getDay()];
      b += '<div class="cal__col' + (isToday ? " is-today" : "") + '" data-date="' + iso + '" data-dow="' + d.getDay() + '">';
      for (var hr = FIRST; hr < LAST; hr++) {
        var slot = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hr);
        var isOpen = hr >= open[0] && hr < open[1] && slot.getTime() > now.getTime();
        b += '<div class="cal__cell ' + (isOpen ? "is-open" : "is-disabled") + '" data-date="' + iso + '" data-dow="' + d.getDay() + '" data-hour="' + hr + '"></div>';
      }
      b += "</div>";
    });
    body.innerHTML = b;

    body.querySelectorAll(".cal__col").forEach(function (col) {
      var iso = col.getAttribute("data-date");
      selections.filter(function (s) { return s.dateISO === iso; }).forEach(function (s) { col.appendChild(blockEl(s)); });
      if (iso === todayISO) {
        var frac = now.getHours() + now.getMinutes() / 60;
        if (frac >= FIRST && frac <= LAST) {
          var nl = document.createElement("div");
          nl.className = "cal__now"; nl.style.top = ((frac - FIRST) * ROW) + "px"; nl.style.left = "0"; nl.style.right = "0";
          col.appendChild(nl);
        }
      }
    });
    renderChips();
  }

  function blockEl(s) {
    var el = document.createElement("div");
    el.className = "cal__block";
    el.style.top = ((s.start - FIRST) * ROW + 1) + "px";
    el.style.height = ((s.end - s.start) * ROW - 3) + "px";
    el.innerHTML = '<span class="rm">&times;</span>' + hourFull(s.start) + "<br>" + hourFull(s.end);
    el.dataset.date = s.dateISO; el.dataset.start = s.start; el.dataset.end = s.end;
    return el;
  }

  function mergeAdd(dateISO, dow, s, e) {
    var same = selections.filter(function (x) { return x.dateISO === dateISO; });
    var others = selections.filter(function (x) { return x.dateISO !== dateISO; });
    same.push({ dateISO: dateISO, dow: dow, start: s, end: e });
    same.sort(function (a, b) { return a.start - b.start; });
    var merged = [];
    same.forEach(function (it) {
      var last = merged[merged.length - 1];
      if (last && it.start <= last.end) last.end = Math.max(last.end, it.end);
      else merged.push({ dateISO: it.dateISO, dow: it.dow, start: it.start, end: it.end });
    });
    selections = others.concat(merged);
  }
  function removeBlock(dateISO, start, end) {
    selections = selections.filter(function (x) { return !(x.dateISO === dateISO && x.start === +start && x.end === +end); });
  }

  function cellFrom(x, y) { var el = document.elementFromPoint(x, y); return el && el.closest ? el.closest(".cal__cell.is-open") : null; }
  function drawProvisional() {
    removeProvisional();
    if (!drag) return;
    var s = Math.min(drag.startHour, drag.curHour), e = Math.max(drag.startHour, drag.curHour) + 1;
    var el = document.createElement("div");
    el.className = "cal__block is-prov"; el.id = "calProv";
    el.style.top = ((s - FIRST) * ROW + 1) + "px"; el.style.height = ((e - s) * ROW - 3) + "px";
    el.innerHTML = hourFull(s) + "<br>" + hourFull(e);
    drag.col.appendChild(el);
  }
  function removeProvisional() { var p = document.getElementById("calProv"); if (p) p.remove(); }

  function onDown(e) {
    var blk = e.target.closest ? e.target.closest(".cal__block") : null;
    if (blk && !blk.classList.contains("is-prov")) { removeBlock(blk.dataset.date, blk.dataset.start, blk.dataset.end); render(); return; }
    var cell = e.target.closest ? e.target.closest(".cal__cell.is-open") : null;
    if (!cell) return;
    e.preventDefault();
    drag = { dateISO: cell.dataset.date, dow: +cell.dataset.dow, col: cell.closest(".cal__col"), startHour: +cell.dataset.hour, curHour: +cell.dataset.hour };
    drawProvisional();
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }
  function onMove(e) {
    if (!drag) return;
    var cell = cellFrom(e.clientX, e.clientY);
    if (cell && cell.dataset.date === drag.dateISO) { drag.curHour = +cell.dataset.hour; drawProvisional(); }
  }
  function onUp() {
    if (drag) {
      var s = Math.min(drag.startHour, drag.curHour), e = Math.max(drag.startHour, drag.curHour) + 1;
      mergeAdd(drag.dateISO, drag.dow, s, e); removeProvisional(); drag = null; render();
    }
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
  }
  body.addEventListener("pointerdown", onDown);

  function sortedSel() { return selections.slice().sort(function (a, b) { return a.dateISO === b.dateISO ? a.start - b.start : (a.dateISO < b.dateISO ? -1 : 1); }); }
  function labelFor(s) {
    var d = new Date(s.dateISO + "T00:00:00");
    return DOW[d.getDay()] + ", " + MON[d.getMonth()] + " " + d.getDate() + " · " + hourFull(s.start) + " – " + hourFull(s.end);
  }
  function renderChips() {
    var ul = document.getElementById("calChips");
    if (!ul) return;
    var items = sortedSel();
    if (!items.length) { ul.innerHTML = '<li class="chips__empty">Nothing selected yet — drag on the calendar above.</li>'; return; }
    ul.innerHTML = items.map(function (s) {
      return '<li class="chip"><span>' + labelFor(s) + '</span><button type="button" aria-label="Remove" data-date="' + s.dateISO + '" data-start="' + s.start + '" data-end="' + s.end + '">&times;</button></li>';
    }).join("");
    ul.querySelectorAll("button").forEach(function (btn) {
      btn.addEventListener("click", function () { removeBlock(btn.dataset.date, btn.dataset.start, btn.dataset.end); render(); });
    });
  }

  var pv = document.getElementById("calPrev"), nx = document.getElementById("calNext"), td = document.getElementById("calToday");
  if (pv) pv.addEventListener("click", function () { if (weekOffset > 0) { weekOffset--; render(); } });
  if (nx) nx.addEventListener("click", function () { if (weekOffset < MAX_WEEKS) { weekOffset++; render(); } });
  if (td) td.addEventListener("click", function () { weekOffset = 0; render(); });

  /* ---------- submit ---------- */
  if (form) {
    var statusEl = form.querySelector(".form-status, .pp-status");
    var submitBtn = form.querySelector('button[type="submit"]');
    var origLabel = submitBtn ? submitBtn.textContent : "Request Booking";
    function setStatus(msg, kind) { if (!statusEl) return; statusEl.textContent = msg; statusEl.classList.remove("is-ok", "is-err"); if (kind) statusEl.classList.add(kind); }
    function val(n) { return form.elements[n] ? String(form.elements[n].value || "").trim() : ""; }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!selections.length) { setStatus("Please pick at least one time on the calendar above.", "is-err"); return; }
      if (!form.checkValidity()) { form.reportValidity(); return; }

      var extras = [];
      if (form.elements["stage"]) extras.push("Postpartum: " + val("stage"));
      if (form.elements["format"]) extras.push("Prefers: " + val("format"));
      var notes = [extras.join(" · "), val("notes")].filter(Boolean).join(" · ");

      var slots = sortedSel().map(function (s) {
        return { date: s.dateISO, day: DOW[new Date(s.dateISO + "T00:00:00").getDay()], start: hourFull(s.start), end: hourFull(s.end), label: labelFor(s) };
      });
      var data = {
        name: val("name"), email: val("email"), phone: val("phone"),
        service: val("service") || SERVICE_DEFAULT, notes: notes,
        slots: slots, slotsText: slots.map(function (s) { return s.label; }).join("; "),
        submittedAt: new Date().toISOString(), source: SOURCE,
      };

      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Sending…"; }
      setStatus("");

      function reset(ok) {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = origLabel; }
        if (ok) { selections = []; form.reset(); render(); }
      }
      var n = slots.length, plural = n > 1 ? "s" : "";
      if (!cfg.BOOKING_ENDPOINT) {
        setTimeout(function () { reset(true); setStatus("✓ Demo mode — " + n + " time" + plural + " captured. Connect Google Sheets to go live (see README).", "is-ok"); }, 700);
        return;
      }
      fetch(cfg.BOOKING_ENDPOINT, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(data) })
        .then(function () { reset(true); if (window.gtag) window.gtag("event", "booking_request", { source: SOURCE, slots: n });
        setStatus("✓ Thank you, " + (data.name.split(" ")[0] || "") + "! We've got your " + n + " time" + plural + " — we'll confirm by email within one business day.", "is-ok"); })
        .catch(function () { reset(false); setStatus("Something went wrong. Please email hello@aninasanctuary.ph and we'll help.", "is-err"); });
    });
  }

  render();
})();
