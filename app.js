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

  function isAdminSignedIn() {
    var s = window.PWAuth && window.PWAuth.session ? window.PWAuth.session() : null;
    return !!(s && s.role === "admin");
  }

  function showView(name) {
    if (name === "admin" && !isAdminSignedIn()) {
      showToast("The Admin console is only for admin accounts.");
      return;
    }
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
    if (name === "admin") renderAdminConsole();
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
    { sel: ".sidebar-bottom .nav-item:nth-of-type(1)", msg: "Settings are on the roadmap." }
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

  /* ---- admin-managed data: bays + locations (saved on this device) --------
     The admin console writes these stores; the booking flow reads them.
     Defaults apply until the admin makes a change. */
  var STORE_BAYS = "pw_bays_v1";
  var STORE_LOCS = "pw_locations_v1";

  function readStore(key, fallback) {
    try {
      var raw = JSON.parse(localStorage.getItem(key) || "null");
      if (raw != null) return raw;
    } catch (err) { /* corrupt or blocked storage — use fallback */ }
    return fallback;
  }
  function writeStore(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) { /* storage blocked */ }
  }

  var DEFAULT_LOCATIONS = {
    central: { name: "Central Station Garage", address: "14 Market Street", rate: 420 },
    harbor: { name: "Harbor Point Parking", address: "2 Pier Avenue", rate: 400 },
    museum: { name: "Northside Museum", address: "88 Elm Boulevard", rate: 300 }
  };
  var LOCATIONS = readStore(STORE_LOCS, null) || JSON.parse(JSON.stringify(DEFAULT_LOCATIONS));
  function saveLocations() { writeStore(STORE_LOCS, LOCATIONS); }

  var DEFAULT_BAYS = ["S1", "S2", "S3", "S4", "S5", "S6"];
  function managedBays() {
    var stored = readStore(STORE_BAYS, null);
    if (Array.isArray(stored) && stored.length) return stored.map(String);
    return DEFAULT_BAYS.slice();
  }

  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function slugFor(name, taken) {
    var base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "location";
    var slug = base, n = 2;
    while (taken.hasOwnProperty(slug)) slug = base + "-" + n++;
    return slug;
  }

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
  var KNOWN_SLOTS = managedBays(); /* admin-managed bay list, default S1–S6 */
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
    updateAdminMetrics();
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
    var loc = LOCATIONS[selectedLocation] || LOCATIONS[Object.keys(LOCATIONS)[0]];
    if (!loc) return;
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

  /* word shown under each bay ID so the sensor verdict is unmistakable */
  var STATE_LABELS = { available: "OPEN", booked: "BOOKED", occupied: "OCCUPIED", awaiting: "" };

  function paintTile(slotId) {
    var tile = $('[data-slot="' + slotId + '"]', els.slotMap);
    if (!tile) return;
    var state = tileStateFor(slotId);
    var booking = activeBookingFor(slotId);
    tile.className = "slot " + state;
    tile.title = slotId + " — " +
      ({ available: "available", booked: "booked", awaiting: "waiting for your car (IR)", occupied: "occupied — IR sensor detects a vehicle" }[state] || state);
    if (slotId === selectedSlot) tile.classList.add("selected");
    if (state === "awaiting" && booking) {
      tile.innerHTML = slotId + "<small>IR · " + mmss(booking.graceEndsAt - Date.now()) + "</small>";
    } else {
      tile.innerHTML = slotId + "<small>" + (STATE_LABELS[state] || "") + "</small>";
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
    var ids = knownSlotIds();
    if (!ids.length) {
      els.slotMap.innerHTML =
        '<p class="slot-map-empty">No bays configured — an admin can add them in the Admin console.</p>';
      return;
    }
    ids.forEach(function (slotId) {
      var tile = document.createElement("button");
      tile.type = "button";
      tile.dataset.slot = slotId;
      els.slotMap.appendChild(tile);
    });
    paintAllTiles();
  }

  /* the location picker is rebuilt from the admin-managed store, so new or
     removed locations show up here immediately */
  var THUMB_CLASSES = ["generic-thumb", "generic-thumb-2", "generic-thumb-3"];

  function openBayCount() {
    return knownSlotIds().filter(function (id) { return tileStateFor(id) === "available"; }).length;
  }

  function renderLocationOptions() {
    if (!els.locationOptions) return;
    var keys = Object.keys(LOCATIONS);
    if (!keys.length) return;
    if (keys.indexOf(selectedLocation) === -1) selectedLocation = keys[0];
    var open = openBayCount();
    els.locationOptions.innerHTML = keys.map(function (key, i) {
      var loc = LOCATIONS[key];
      var selected = key === selectedLocation;
      return '<button class="location-option' + (selected ? " selected" : "") +
        '" data-location="' + escHtml(key) + '">' +
        '<span class="option-image ' + THUMB_CLASSES[i % THUMB_CLASSES.length] + '"></span>' +
        '<span><strong>' + escHtml(loc.name) + '</strong><small>' + escHtml(loc.address || "—") +
        " · " + open + " spots open</small></span>" +
        '<i data-lucide="' + (selected ? "check-circle-2" : "circle") + '"></i></button>';
    }).join("");
    refreshIcons();
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

  renderLocationOptions();
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
    updateAdminMetrics();
  }, 1000);

  connectHardware();
  setIrStatus();

  function bumpActivityCount() {
    var count = $(".nav-count");
    if (!count) return;
    var value = parseInt(count.textContent, 10) || 0;
    count.textContent = String(value + 1);
  }

  /* ---- admin console ---------------------------------------------------------- */

  function bayPillClass(state) {
    return { available: "green", booked: "blue", awaiting: "amber", occupied: "red" }[state] || "green";
  }
  function bayStateLabel(state) {
    return {
      available: "Available", booked: "Booked", awaiting: "Awaiting (IR)", occupied: "Occupied"
    }[state] || state;
  }

  function updateAdminMetrics() {
    var view = views.admin && views.admin.el;
    if (!view || !view.classList.contains("active")) return;
    var ids = knownSlotIds();
    var occupied = ids.filter(function (id) { return tileStateFor(id) === "occupied"; }).length;
    var online = ids.filter(slotIsOnline).length;
    var activeBookings = bookings.filter(function (b) {
      return b.status === "booked" || b.status === "awaiting" || b.status === "occupied";
    }).length;

    var t = $("#adminTotalBays"); if (t) t.textContent = String(ids.length);
    var o = $("#adminOccupiedNow"); if (o) o.textContent = String(occupied);
    var bar = $("#adminOccupiedBar");
    if (bar) bar.style.width = (ids.length ? Math.round((occupied * 100) / ids.length) : 0) + "%";
    var ab = $("#adminActiveBookings"); if (ab) ab.textContent = String(activeBookings);

    var pill = $("#adminSensorPill");
    if (pill) {
      pill.className = hardware.live ? "sensor-online" : "sensor-offline";
      pill.innerHTML = "<span></span> " + (hardware.live ? "live" : "offline");
    }
    var sub = $("#adminSensorSub");
    if (sub) sub.textContent = online + " of " + ids.length + " sensors reporting";
    var pct = $("#adminSensorOnline");
    if (pct) pct.textContent = ids.length ? Math.round((online * 100) / ids.length) + "%" : "0%";
    var act = $("#adminSensorsActive"); if (act) act.textContent = online + " sensors active";
    var chk = $("#adminSensorsChecking"); if (chk) chk.textContent = (ids.length - online) + " offline";
  }

  function renderAdminConsole() {
    if (!isAdminSignedIn()) return;

    var bayList = $("#adminBayList");
    if (bayList) {
      var ids = knownSlotIds();
      bayList.innerHTML = ids.length
        ? ids.map(function (id) {
            var st = tileStateFor(id);
            var online = slotIsOnline(id);
            return '<div class="admin-location-row admin-manage-row">' +
              '<div class="admin-location-name">' +
              '<span class="location-status ' + (online ? "green-bg" : "gray-bg") + '"><i data-lucide="radio"></i></span>' +
              '<div><strong>Bay ' + escHtml(id) + '</strong><span>' +
              (online ? "IR sensor online" : "IR sensor offline") + '</span></div></div>' +
              '<span class="status-pill ' + bayPillClass(st) + '"><span></span> ' + bayStateLabel(st) + '</span>' +
              '<button class="icon-button subtle admin-remove" data-remove-bay="' + escHtml(id) + '" aria-label="Remove bay ' + escHtml(id) + '"><i data-lucide="trash-2"></i></button>' +
              '</div>';
          }).join("")
        : '<p class="admin-empty">No bays yet — add the first one above.</p>';
    }

    var locList = $("#adminLocationList");
    if (locList) {
      var keys = Object.keys(LOCATIONS);
      locList.innerHTML = keys.length
        ? keys.map(function (key) {
            var loc = LOCATIONS[key];
            return '<div class="admin-location-row admin-manage-row">' +
              '<div class="admin-location-name">' +
              '<span class="location-status teal-bg"><i data-lucide="map-pin"></i></span>' +
              '<div><strong>' + escHtml(loc.name) + '</strong><span>' + escHtml(loc.address || "—") + '</span></div></div>' +
              '<strong class="admin-rate">₹' + Number(loc.rate || 0).toLocaleString("en-IN") + '<small>/hr</small></strong>' +
              '<button class="icon-button subtle admin-remove" data-remove-location="' + escHtml(key) + '" aria-label="Remove ' + escHtml(loc.name) + '"><i data-lucide="trash-2"></i></button>' +
              '</div>';
          }).join("")
        : '<p class="admin-empty">No locations yet — add one above.</p>';
    }

    updateAdminMetrics();
    refreshIcons();
  }

  function saveBays() { writeStore(STORE_BAYS, KNOWN_SLOTS); }

  function removeBay(id) {
    var i = KNOWN_SLOTS.indexOf(id);
    if (i === -1) return;
    KNOWN_SLOTS.splice(i, 1);
    saveBays();
    if (selectedSlot === id) selectedSlot = null;
    renderSlots();
    updateSummary();
    renderAdminConsole();
    showToast("Bay " + id + " removed.");
  }

  function removeLocation(key) {
    if (!LOCATIONS[key]) return;
    if (Object.keys(LOCATIONS).length <= 1) {
      showToast("Keep at least one location.");
      return;
    }
    var name = LOCATIONS[key].name;
    delete LOCATIONS[key];
    saveLocations();
    renderLocationOptions();
    updateSummary();
    renderAdminConsole();
    showToast("Location “" + name + "” removed.");
  }

  var adminViewEl = $("#adminView");
  if (adminViewEl) {
    adminViewEl.addEventListener("click", function (event) {
      var bayBtn = event.target.closest("[data-remove-bay]");
      if (bayBtn) {
        var id = bayBtn.dataset.removeBay;
        if (confirm("Remove bay " + id + "? It will disappear from Find parking too.")) removeBay(id);
        return;
      }
      var locBtn = event.target.closest("[data-remove-location]");
      if (locBtn) {
        var key = locBtn.dataset.removeLocation;
        var loc = LOCATIONS[key];
        if (loc && confirm("Remove “" + loc.name + "” from Find parking?")) removeLocation(key);
      }
    });
  }

  var addBayForm = $("#addBayForm");
  if (addBayForm) {
    addBayForm.addEventListener("submit", function (event) {
      event.preventDefault();
      var input = $("#newBayId");
      var raw = String(input.value || "").trim().toUpperCase();
      if (!raw) return;
      if (/^\d+$/.test(raw)) raw = "S" + raw; /* "7" → "S7" */
      if (!/^[A-Z0-9]{1,6}$/.test(raw)) {
        showToast("Bay IDs are 1–6 letters/numbers, e.g. S7.");
        return;
      }
      if (knownSlotIds().indexOf(raw) !== -1) {
        showToast("Bay " + raw + " already exists.");
        return;
      }
      KNOWN_SLOTS.push(raw);
      KNOWN_SLOTS.sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); });
      saveBays();
      input.value = "";
      renderSlots();
      updateSummary();
      renderAdminConsole();
      showToast("Bay " + raw + " added — it now appears in Find parking.");
    });
  }

  var addLocationForm = $("#addLocationForm");
  if (addLocationForm) {
    addLocationForm.addEventListener("submit", function (event) {
      event.preventDefault();
      var name = String($("#newLocName").value || "").trim();
      var address = String($("#newLocAddress").value || "").trim();
      var rate = parseInt($("#newLocRate").value, 10);
      if (!name) {
        showToast("Give the location a name.");
        return;
      }
      if (isNaN(rate) || rate < 0) rate = 0;
      var key = slugFor(name, LOCATIONS);
      LOCATIONS[key] = { name: name, address: address, rate: rate };
      saveLocations();
      addLocationForm.reset();
      renderLocationOptions();
      updateSummary();
      renderAdminConsole();
      showToast("Location “" + name + "” added to Find parking.");
    });
  }

  var adminExport = $("#adminExport");
  if (adminExport) {
    adminExport.addEventListener("click", function () {
      var lines = ["type,id,state"];
      knownSlotIds().forEach(function (id) {
        lines.push("bay," + id + "," + tileStateFor(id) + (slotIsOnline(id) ? ",online" : ",offline"));
      });
      bookings.forEach(function (b) { lines.push("booking," + b.slotId + "," + b.status); });
      var blob = new Blob([lines.join("\n")], { type: "text/csv" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "parkwise-report.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      showToast("Report downloaded.");
    });
  }

  var viewDetails = $(".metric-footer .text-button");
  if (viewDetails) viewDetails.addEventListener("click", function () { showToast("Booking details (demo)."); });
})();
