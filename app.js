/* ==========================================================================
   Parkwise — app logic
   View switching · live availability · booking flow · UPI modal · toasts
   Demo data only — no backend required.
   ========================================================================== */

(function () {
  "use strict";

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ---- icons ---------------------------------------------------------- */

  function refreshIcons() {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
  }
  refreshIcons();

  /* ---- background video: hide gracefully if the file is missing -------- */

  var bgVideo = $(".site-background-video");
  if (bgVideo) {
    var killVideo = function () { bgVideo.style.display = "none"; };
    bgVideo.addEventListener("error", killVideo);
    var bgSource = bgVideo.querySelector("source");
    if (bgSource) bgSource.addEventListener("error", killVideo);
  }

  /* ---- toast ------------------------------------------------------------ */

  var toastEl = $("#toast");
  var toastTimer = null;

  function showToast(message) {
    if (!toastEl) return;
    toastEl.querySelector("span").textContent = message;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove("show");
    }, 3800);
  }

  /* ---- view switching ----------------------------------------------------- */

  var views = {
    overview: { el: $("#overviewView"), label: "Overview" },
    find: { el: $("#findView"), label: "Find parking" },
    activity: { el: $("#activityView"), label: "My activity" },
    admin: { el: $("#adminView"), label: "Admin console" }
  };

  function showView(name) {
    var target = views[name];
    if (!target) return;
    Object.keys(views).forEach(function (key) {
      views[key].el.classList.toggle("active", key === name);
    });
    $$(".main-nav .nav-item[data-view]").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.view === name);
    });
    var crumb = $("#breadcrumbCurrent");
    if (crumb) crumb.textContent = target.label;
    document.body.classList.remove("nav-open");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  $$(".main-nav .nav-item[data-view]").forEach(function (btn) {
    btn.addEventListener("click", function () { showView(btn.dataset.view); });
  });

  $$("[data-view-target]").forEach(function (btn) {
    btn.addEventListener("click", function () { showView(btn.dataset.viewTarget); });
  });

  /* ---- sidebar extras (demo actions) --------------------------------------- */

  var mobileMenuBtn = $(".mobile-menu");
  if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener("click", function () {
      document.body.classList.toggle("nav-open");
    });
  }

  var quietActions = [
    { sel: ".sidebar-bottom .nav-item:nth-of-type(1)", msg: "Settings are on the roadmap." },
    { sel: ".sidebar-bottom .nav-item:nth-of-type(2)", msg: "Signed out — this is a demo account." }
  ];
  quietActions.forEach(function (action) {
    var btn = $(action.sel);
    if (btn) btn.addEventListener("click", function () { showToast(action.msg); });
  });

  var contactBtn = $(".help-card .text-button");
  if (contactBtn) contactBtn.addEventListener("click", function () { showToast("Support chat is coming soon."); });

  var notifBtn = $(".notification-button");
  if (notifBtn) notifBtn.addEventListener("click", function () { showToast("No new notifications."); });

  /* ---- overview: greeting, date, copy code, live numbers --------------------- */

  var now = new Date();
  var eyebrow = $(".welcome-row .eyebrow");
  if (eyebrow) {
    eyebrow.textContent = now.toLocaleDateString("en-US", {
      weekday: "long", year: "numeric", month: "long", day: "numeric"
    });
  }

  var greeting = $(".welcome-row h1");
  if (greeting) {
    var profileName = $(".profile-card strong");
    var userName = profileName ? profileName.textContent.trim() : "there";
    var part = now.getHours() < 12 ? "morning" : now.getHours() < 17 ? "afternoon" : "evening";
    greeting.innerHTML = "Good " + part + ", " + userName + '<span class="accent">.</span>';
  }

  var copyBtn = $(".copy-button");
  if (copyBtn) {
    copyBtn.addEventListener("click", function () {
      try {
        navigator.clipboard.writeText("PW-2841");
      } catch (err) { /* clipboard unavailable — toast still confirms */ }
      showToast("Booking code copied to clipboard");
    });
  }

  $$(".select-location").forEach(function (btn) {
    btn.addEventListener("click", function () { showView("find"); });
  });

  function jitter(el) {
    var value = parseInt(el.textContent, 10);
    if (isNaN(value)) return;
    var drift = 1 + (Math.random() * 2 - 1) * 0.08;
    el.textContent = String(Math.max(1, Math.round(value * drift)));
  }

  setInterval(function () {
    $$(".location-grid .availability strong").forEach(jitter);
    $$(".city-location-row .city-slots strong").forEach(jitter);
  }, 10000);

  /* ---- modals ------------------------------------------------------------------ */

  function openModal(backdrop) { backdrop.classList.add("open"); }
  function closeModal(backdrop) { backdrop.classList.remove("open"); }

  $$(".modal-backdrop").forEach(function (backdrop) {
    backdrop.addEventListener("click", function (event) {
      if (event.target === backdrop) closeModal(backdrop);
    });
  });

  $$(".modal-close").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var backdrop = btn.closest(".modal-backdrop");
      if (backdrop) closeModal(backdrop);
    });
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      $$(".modal-backdrop.open").forEach(closeModal);
    }
  });

  /* ---- booking flow --------------------------------------------------------------- */

  var LOCATIONS = {
    central: { name: "Central Station Garage", address: "14 Market Street", rate: 420 },
    harbor: { name: "Harbor Point Parking", address: "2 Pier Avenue", rate: 400 },
    museum: { name: "Northside Museum", address: "88 Elm Boulevard", rate: 300 }
  };

  var DURATION_HOURS = { "1 hour": 1, "2 hours": 2, "3 hours": 3, "All day": 8 };
  var PAYMENT_STATUS_DEFAULT = "After payment, return here to verify your transaction.";

  /* IR grace window: after the reserved arrival time the sensor waits this long
     for a car; if none is detected the bay is freed again. */
  var GRACE_MS = 5 * 60 * 1000;

  function pad2(n) { return String(n).padStart(2, "0"); }

  function formatTime12h(hhmm) {
    if (!hhmm) return "";
    var parts = hhmm.split(":");
    var h = parseInt(parts[0], 10);
    if (isNaN(h) || !parts[1]) return hhmm;
    var h12 = h % 12 || 12;
    return h12 + ":" + parts[1] + " " + (h < 12 ? "AM" : "PM");
  }

  function mmss(ms) {
    var total = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(total / 60) + ":" + pad2(total % 60);
  }

  var els = {
    locationOptions: $("#locationOptions"),
    bookingDate: $("#bookingDate"),
    arrivalTime: $("#arrivalTime"),
    duration: $("#duration"),
    slotMap: $("#slotMap"),
    summaryLocation: $("#summaryLocation"),
    summaryAddress: $(".summary-address"),
    summaryDate: $("#summaryDate"),
    summaryArrival: $("#summaryArrival"),
    summaryDuration: $("#summaryDuration"),
    summarySlot: $("#summarySlot"),
    summaryPrice: $("#summaryPrice"),
    reserveButton: $("#reserveButton"),
    paymentModal: $("#paymentModal"),
    paymentAmount: $("#paymentAmount"),
    payButton: $("#payButton"),
    verifyPayment: $("#verifyPayment"),
    paymentStatus: $("#paymentStatus"),
    confirmationModal: $("#confirmationModal"),
    confirmLocation: $("#confirmLocation"),
    confirmTime: $("#confirmTime"),
    confirmSpot: $("#confirmSpot")
  };

  var selectedLocation = "central";
  var selectedSlot = null;

  /* Active bookings for the IR grace-window logic.
     status: "booked" → "awaiting" (grace countdown) → "occupied" | "released" */
  var bookings = [];

  if (!els.slotMap || !els.reserveButton) return;

  var todayIso = now.getFullYear() + "-" + pad2(now.getMonth() + 1) + "-" + pad2(now.getDate());

  if (els.bookingDate) {
    els.bookingDate.min = todayIso;
    els.bookingDate.value = todayIso;
  }

  /* any time of day is bookable — default the arrival to the next 5-minute mark */
  if (els.arrivalTime) {
    var t = new Date(Date.now() + 60000);
    if (t.getMinutes() % 5) t.setMinutes(t.getMinutes() + 5 - (t.getMinutes() % 5));
    t.setSeconds(0, 0);
    els.arrivalTime.value = pad2(t.getHours()) + ":" + pad2(t.getMinutes());
  }

  function rateFor() { return LOCATIONS[selectedLocation].rate; }
  function hoursFor() { return DURATION_HOURS[els.duration.value] || 2; }
  function priceFor() { return rateFor() * hoursFor(); }
  function rupees(amount) { return "₹" + amount.toLocaleString("en-IN"); }

  function updateSummary() {
    var loc = LOCATIONS[selectedLocation];
    var dateVal = els.bookingDate && els.bookingDate.value ? els.bookingDate.value : todayIso;
    var dateObj = new Date(dateVal + "T00:00:00");

    els.summaryLocation.textContent = loc.name;
    if (els.summaryAddress) {
      els.summaryAddress.innerHTML = '<i data-lucide="map-pin"></i> ' + loc.address;
      refreshIcons();
    }
    if (els.summaryDate) {
      els.summaryDate.textContent = dateObj.toLocaleDateString("en-US", {
        weekday: "short", month: "short", day: "numeric", year: "numeric"
      });
    }
    if (els.summaryArrival) els.summaryArrival.textContent = formatTime12h(els.arrivalTime ? els.arrivalTime.value : "");
    if (els.summaryDuration) els.summaryDuration.textContent = els.duration.value;
    els.summarySlot.textContent = selectedSlot ? selectedSlot + " · Level B2" : "Select a spot";
    els.summaryPrice.textContent = rupees(priceFor());

    if (selectedSlot) {
      els.reserveButton.disabled = false;
      els.reserveButton.innerHTML = "Reserve & pay " + rupees(priceFor()) + ' <i data-lucide="arrow-right"></i>';
    } else {
      els.reserveButton.disabled = true;
      els.reserveButton.innerHTML = 'Choose a spot to continue <i data-lucide="arrow-right"></i>';
    }
    refreshIcons();
  }

  function onSlotClick(event) {
    var clicked = event.currentTarget;
    $$(".slot.selected", els.slotMap).forEach(function (other) {
      other.classList.remove("selected");
    });
    clicked.classList.add("selected");
    selectedSlot = clicked.dataset.slot;
    updateSummary();
  }

  /* Paint a booking's current state onto its slot tile (if it is on the map). */
  function applyBookingToTile(booking) {
    var tile = $('.slot[data-slot="' + booking.slotId + '"]', els.slotMap);
    if (!tile) return;
    tile.classList.remove("selected", "available", "booked", "awaiting", "occupied");

    if (booking.status === "released") {
      tile.className += " available";
      tile.disabled = false;
      tile.textContent = booking.slotId;
      tile.addEventListener("click", onSlotClick);
      return;
    }

    if (booking.status === "awaiting") {
      tile.className += " awaiting";
      tile.innerHTML = booking.slotId + "<small>IR · " + mmss(booking.graceEndsAt - Date.now()) + "</small>";
    } else if (booking.status === "occupied") {
      tile.className += " occupied";
      tile.textContent = booking.slotId;
    } else {
      tile.className += " booked";
      tile.textContent = booking.slotId;
    }
    tile.disabled = true;
  }

  function reapplyBookings() {
    bookings.forEach(function (booking) {
      if (booking.location === selectedLocation && booking.status !== "released") {
        applyBookingToTile(booking);
      }
    });
  }

  function renderSlots() {
    selectedSlot = null;
    els.slotMap.innerHTML = "";
    ["A", "B", "C"].forEach(function (rowLetter) {
      for (var i = 1; i <= 8; i++) {
        var slotId = rowLetter + "-" + String(i).padStart(2, "0");
        var roll = Math.random();
        var state = roll < 0.45 ? "available" : roll < 0.75 ? "booked" : "occupied";

        var tile = document.createElement("button");
        tile.type = "button";
        tile.className = "slot " + state;
        tile.textContent = slotId;
        if (state !== "available") tile.disabled = true;
        tile.dataset.slot = slotId;

        if (state === "available") {
          tile.addEventListener("click", onSlotClick);
        }
        els.slotMap.appendChild(tile);
      }
    });
    reapplyBookings();
  }

  if (els.locationOptions) {
    els.locationOptions.addEventListener("click", function (event) {
      var option = event.target.closest(".location-option");
      if (!option || option.dataset.location === selectedLocation) return;
      $$(".location-option", els.locationOptions).forEach(function (other) {
        other.classList.remove("selected");
      });
      option.classList.add("selected");
      selectedLocation = option.dataset.location;
      if (LOCATIONS[selectedLocation]) {
        renderSlots();
        updateSummary();
      }
    });
  }

  [els.bookingDate, els.arrivalTime, els.duration].forEach(function (input) {
    if (input) input.addEventListener("change", updateSummary);
  });

  renderSlots();
  updateSummary();

  /* reserve → payment modal */
  els.reserveButton.addEventListener("click", function () {
    if (els.reserveButton.disabled || !selectedSlot) return;
    if (els.paymentAmount) els.paymentAmount.textContent = rupees(priceFor());
    if (els.verifyPayment) els.verifyPayment.hidden = true;
    if (els.paymentStatus) els.paymentStatus.textContent = PAYMENT_STATUS_DEFAULT;
    if (els.paymentModal) openModal(els.paymentModal);
  });

  /* UPI link → reveal verify button */
  if (els.payButton) {
    els.payButton.addEventListener("click", function () {
      if (els.paymentStatus) {
        els.paymentStatus.textContent = "Payment app opened. Complete the payment there, then tap Verify.";
      }
      if (els.verifyPayment) els.verifyPayment.hidden = false;
    });
  }

  /* verify → confirmation */
  if (els.verifyPayment) {
    els.verifyPayment.addEventListener("click", function () {
      var loc = LOCATIONS[selectedLocation];
      var dateVal = els.bookingDate && els.bookingDate.value ? els.bookingDate.value : todayIso;
      var dateObj = new Date(dateVal + "T00:00:00");
      var bookingId = "PW-" + (1000 + Math.floor(Math.random() * 9000));

      /* reserved arrival moment — clamped to now if the user picked a past time */
      var timeVal = els.arrivalTime && els.arrivalTime.value ? els.arrivalTime.value : "10:30";
      var arrivalAt = new Date(dateVal + "T" + timeVal + ":00").getTime();
      if (isNaN(arrivalAt) || arrivalAt < Date.now()) arrivalAt = Date.now();

      var booking = {
        location: selectedLocation,
        slotId: selectedSlot,
        arrivalAt: arrivalAt,
        graceEndsAt: arrivalAt + GRACE_MS,
        irDetectAt: null,
        status: "booked",
        row: null
      };
      /* simulated IR sensor: roughly half the time the car shows up mid-window */
      if (Math.random() < 0.5) {
        booking.irDetectAt = arrivalAt + 15000 + Math.floor(Math.random() * (GRACE_MS - 30000));
      }
      bookings.push(booking);

      if (els.paymentModal) closeModal(els.paymentModal);

      if (els.confirmLocation) els.confirmLocation.textContent = loc.name;
      if (els.confirmTime) {
        els.confirmTime.textContent = dateObj.toLocaleDateString("en-US", {
          weekday: "short", month: "short", day: "numeric"
        }) + " · " + formatTime12h(timeVal);
      }
      if (els.confirmSpot) els.confirmSpot.textContent = selectedSlot + " · Level B2";
      var idEl = $$(".confirm-ticket strong")[2];
      if (idEl) idEl.textContent = bookingId;

      /* the reserved bay is no longer available */
      applyBookingToTile(booking);

      addHistoryRow(loc.name, dateObj, bookingId, booking);
      bumpActivityCount();
      selectedSlot = null;
      updateSummary();

      if (els.confirmationModal) openModal(els.confirmationModal);
      showToast("Booking confirmed. The IR sensor holds " + booking.slotId + " for you until 5 minutes after " + formatTime12h(timeVal) + ".");
    });
  }

  /* done → show activity */
  var doneButton = $("#doneButton");
  if (doneButton) {
    doneButton.addEventListener("click", function () {
      if (els.confirmationModal) closeModal(els.confirmationModal);
      showView("activity");
    });
  }

  function addHistoryRow(locationName, dateObj, bookingId, booking) {
    var table = $(".history-table");
    if (!table) return;
    var row = document.createElement("div");
    row.className = "history-table-row";
    row.innerHTML =
      '<span class="table-location"><i data-lucide="square-parking"></i><strong>' + locationName + "</strong></span>" +
      "<span>" + dateObj.toLocaleDateString("en-US", {
        month: "short", day: "numeric", year: "numeric"
      }) + " · " + formatTime12h(els.arrivalTime ? els.arrivalTime.value : "") + "</span>" +
      "<span>" + (booking ? booking.slotId : "—") + "</span>" +
      '<span class="status-pill green"><span></span> Confirmed</span>' +
      "<span>" + els.summaryPrice.textContent + "</span>";
    /* keep the id for reference even though the column shows the bay */
    row.dataset.bookingId = bookingId;
    table.insertBefore(row, table.children[1] || null);
    if (booking) booking.row = row;
    refreshIcons();
  }

  function setHistoryStatus(booking, label, pillClass) {
    if (!booking.row) return;
    var pill = booking.row.querySelector(".status-pill");
    if (!pill) return;
    pill.className = "status-pill " + pillClass;
    pill.innerHTML = "<span></span> " + label;
  }

  /* ---- IR grace-window ticker ------------------------------------------------
     When the reserved arrival time passes, the (simulated) IR sensor watches the
     bay for GRACE_MS. Car detected → bay shows Occupied; still empty after the
     window → the bay is freed and shows Available again. */
  setInterval(function () {
    var nowMs = Date.now();
    bookings.forEach(function (booking) {
      if (booking.status === "booked" && nowMs >= booking.arrivalAt) {
        booking.status = "awaiting";
        applyBookingToTile(booking);
        showToast("Arrival time reached — IR sensor watching " + booking.slotId + " for 5 minutes.");
      } else if (booking.status === "awaiting") {
        if (booking.irDetectAt && nowMs >= booking.irDetectAt) {
          booking.status = "occupied";
          applyBookingToTile(booking);
          setHistoryStatus(booking, "Parked", "green");
          showToast("IR sensor detected the vehicle at " + booking.slotId + " — booking active.");
        } else if (nowMs >= booking.graceEndsAt) {
          booking.status = "released";
          applyBookingToTile(booking);
          setHistoryStatus(booking, "Released", "amber");
          showToast("No vehicle detected at " + booking.slotId + " within 5 minutes — bay is free again.");
        } else {
          applyBookingToTile(booking); /* keep the countdown fresh */
        }
      }
    });
  }, 1000);

  function bumpActivityCount() {
    var count = $(".nav-count");
    if (!count) return;
    var value = parseInt(count.textContent, 10) || 0;
    count.textContent = String(value + 1);
  }

  /* ---- admin demo actions --------------------------------------------------- */

  var adminExport = $("#adminView .outline-button");
  if (adminExport) adminExport.addEventListener("click", function () { showToast("Report exported (demo)."); });

  var addLocation = $("#adminView .admin-location-panel .primary-button");
  if (addLocation) addLocation.addEventListener("click", function () { showToast("Add location (demo)."); });

  var viewDetails = $(".metric-footer .text-button");
  if (viewDetails) viewDetails.addEventListener("click", function () { showToast("Booking details (demo)."); });
})();
