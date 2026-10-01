/* ==========================================================================
   Parkwise — app logic
   View switching · live availability · booking flow · UPI modal · toasts
   Bays are the real IR-sensor slots (Arduino Uno → serial-bridge → MQTT)
   when the hardware is online; otherwise a built-in demo simulation runs.
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
     status: "booked" → "awaiting" (grace countdown) → "occupied" | "released",
     and "occupied" → "done" once the IR sensor sees the car leave. */
  var bookings = [];

  /* ---- live IR hardware (Arduino Uno + HW-201 sensors via MQTT) -------------
     The Uno streams JSON over USB; serial-bridge.js republishes it to the
     public broker and this page subscribes over secure WebSocket — the same
     topics and payloads the real dashboard uses:
       <prefix>/slot/<ID>/status        {"slot":"S1","occupied":true,..} (retained)
       <prefix>/slot/<ID>/availability  "online" | "offline"            (retained)
     While no hardware is online, the bays fall back to a simulated demo. */
  var MQTT_URL = "wss://broker.emqx.io:8084/mqtt";
  var MQTT_PREFIX = "smartparking/mne-f3kqz2";
  var KNOWN_SLOTS = ["S1", "S2", "S3", "S4", "S5", "S6"];
  var hardware = { live: false, slots: {} }; /* id → { online, occupied } */
  var simStates = {}; /* location → { slotId: occupied } — demo fallback */

  function knownSlotIds() {
    var ids = KNOWN_SLOTS.slice();
    Object.keys(hardware.slots).forEach(function (id) {
      if (ids.indexOf(id) === -1) ids.push(id);
    });
    ids.sort(function (a, b) {
      return parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10);
    });
    return ids;
  }

  function slotIsOnline(slotId) {
    var hw = hardware.slots[slotId];
    return !!(hw && hw.online);
  }

  /* the real sensor verdict for a bay — false while that bay is offline */
  function irSeesCar(slotId) {
    var hw = hardware.slots[slotId];
    return !!(hardware.live && hw && hw.online && hw.occupied);
  }

  function simOccupied(slotId) {
    var lot = simStates[selectedLocation] || (simStates[selectedLocation] = {});
    if (typeof lot[slotId] !== "boolean") lot[slotId] = Math.random() < 0.4;
    return lot[slotId];
  }

  function setIrStatus() {
    var chip = $("#irStatus");
    if (!chip) return;
    if (hardware.live) {
      chip.className = "ir-status online";
      chip.textContent = "IR hardware live";
    } else {
      chip.className = "ir-status offline";
      chip.textContent = "IR hardware offline · demo";
    }
  }

  function refreshLiveFlag() {
    var wasLive = hardware.live;
    hardware.live = knownSlotIds().some(slotIsOnline);
    if (hardware.live && !wasLive) {
      showToast("IR hardware connected — the bays are now live from the sensors.");
    }
  }

  function ensureSlotTile(slotId) {
    if ($('[data-slot="' + slotId + '"]', els.slotMap)) return;
    var tile = document.createElement("button");
    tile.type = "button";
    tile.dataset.slot = slotId;
    els.slotMap.appendChild(tile);
  }

  function onMqttMessage(topic, payload) {
    var pattern = new RegExp(
      "^" + MQTT_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/slot/([^/]+)/(status|availability)$"
    );
    var match = topic.match(pattern);
    if (!match) return;
    var slotId = match[1];
    var kind = match[2];
    var hw = hardware.slots[slotId] || (hardware.slots[slotId] = { online: false, occupied: false });
    if (kind === "availability") {
      hw.online = payload.toString() === "online";
    } else {
      try {
        hw.occupied = !!JSON.parse(payload.toString()).occupied;
      } catch (err) { /* ignore malformed payloads */ }
    }
    refreshLiveFlag();
    ensureSlotTile(slotId);
    setIrStatus();
    paintAllTiles();
  }

  function connectHardware() {
    if (typeof mqtt === "undefined") {
      setIrStatus();
      return;
    }
    try {
      var client = mqtt.connect(MQTT_URL, {
        clientId: "parkwise-web-" + Math.random().toString(16).slice(2, 8),
        clean: true,
        reconnectPeriod: 5000,
        connectTimeout: 8000
      });
      client.on("connect", function () {
        client.subscribe([
          MQTT_PREFIX + "/slot/+/status",
          MQTT_PREFIX + "/slot/+/availability"
        ]);
      });
      client.on("message", onMqttMessage);
    } catch (err) {
      setIrStatus();
    }
  }

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
    els.summarySlot.textContent = selectedSlot ? "Bay " + selectedSlot : "Select a spot";
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

  /* the latest unfinished booking on a bay, if any */
  function activeBookingFor(slotId) {
    for (var i = bookings.length - 1; i >= 0; i--) {
      var b = bookings[i];
      if (b.slotId === slotId && (b.status === "booked" || b.status === "awaiting" || b.status === "occupied")) {
        return b;
      }
    }
    return null;
  }

  /* A bay's displayed state: an active booking wins, otherwise the real IR
     sensor decides, and with no hardware online a simulated state is used. */
  function tileStateFor(slotId) {
    var booking = activeBookingFor(slotId);
    if (booking) return booking.status; /* booked | awaiting | occupied */
    if (slotIsOnline(slotId)) {
      return hardware.slots[slotId].occupied ? "occupied" : "available";
    }
    return simOccupied(slotId) ? "occupied" : "available";
  }

  function paintTile(slotId) {
    var tile = $('[data-slot="' + slotId + '"]', els.slotMap);
    if (!tile) return;
    var state = tileStateFor(slotId);
    var booking = activeBookingFor(slotId);
    tile.className = "slot " + state;
    if (slotId === selectedSlot) tile.classList.add("selected");
    if (state === "awaiting" && booking) {
      tile.innerHTML = slotId + "<small>IR · " + mmss(booking.graceEndsAt - Date.now()) + "</small>";
    } else {
      tile.textContent = slotId;
    }
    if (state === "available") {
      tile.disabled = false;
      if (!tile.dataset.bound) {
        tile.dataset.bound = "1";
        tile.addEventListener("click", onSlotClick);
      }
    } else {
      tile.disabled = true;
    }
  }

  function paintAllTiles() {
    knownSlotIds().forEach(paintTile);
  }

  function renderSlots() {
    selectedSlot = null;
    els.slotMap.innerHTML = "";
    knownSlotIds().forEach(function (slotId) {
      var tile = document.createElement("button");
      tile.type = "button";
      tile.dataset.slot = slotId;
      els.slotMap.appendChild(tile);
    });
    paintAllTiles();
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
      /* simulated IR sensor for demo mode (no hardware online):
         roughly half the time the car shows up mid-window */
      if (!hardware.live && Math.random() < 0.5) {
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
      if (els.confirmSpot) els.confirmSpot.textContent = "Bay " + selectedSlot;
      var idEl = $$(".confirm-ticket strong")[2];
      if (idEl) idEl.textContent = bookingId;

      /* the reserved bay is no longer available */
      paintTile(booking.slotId);

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
     Once the reserved arrival time passes, the IR sensor watches the bay for
     GRACE_MS. Car detected → bay shows Occupied; still empty after the window
     → the bay is freed and shows Available again. With hardware online the
     verdict comes from the real HW-201 sensor; offline it is simulated. */
  setInterval(function () {
    var nowMs = Date.now();
    bookings.forEach(function (booking) {
      if (booking.status === "booked") {
        if (irSeesCar(booking.slotId)) {
          /* arrived early — no need to wait for the reserved time */
          booking.status = "occupied";
          setHistoryStatus(booking, "Parked", "green");
          showToast("IR sensor detected the vehicle at " + booking.slotId + " — booking active.");
        } else if (nowMs >= booking.arrivalAt) {
          booking.status = "awaiting";
          showToast("Arrival time reached — the IR sensor is watching " + booking.slotId + " for 5 minutes.");
        }
      } else if (booking.status === "awaiting") {
        var detected = irSeesCar(booking.slotId) ||
          (!hardware.live && booking.irDetectAt && nowMs >= booking.irDetectAt);
        if (detected) {
          booking.status = "occupied";
          setHistoryStatus(booking, "Parked", "green");
          showToast("IR sensor detected the vehicle at " + booking.slotId + " — booking active.");
        } else if (nowMs >= booking.graceEndsAt) {
          booking.status = "released";
          setHistoryStatus(booking, "Released", "amber");
          showToast("No vehicle detected at " + booking.slotId + " within 5 minutes — bay is free again.");
        }
      } else if (booking.status === "occupied" && slotIsOnline(booking.slotId) && !hardware.slots[booking.slotId].occupied) {
        booking.status = "done";
        setHistoryStatus(booking, "Completed", "green");
        showToast(booking.slotId + " is free again — parking session completed.");
      }
    });
    paintAllTiles();
  }, 1000);

  connectHardware();
  setIrStatus();

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
