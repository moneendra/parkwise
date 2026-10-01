/* ==========================================================================
   Parkwise — authentication (login / signup · user & admin roles)
   Accounts are stored in Supabase (parkwise_users table) once the anon
   key below is pasted in. Until then a local per-browser store is used
   so the whole flow still works. Passwords are never stored in plain
   text — salted PBKDF2-SHA256 via the browser's Web Crypto API.
   ========================================================================== */

(function () {
  "use strict";

  /* ------------------------------------------------------------------ *
   *  TO GO LIVE with the real database:                                 *
   *   1. Run supabase-setup-parkwise.sql once in the Supabase SQL       *
   *      Editor (creates the table + seeds the admin account).          *
   *   2. Supabase Dashboard → Settings → API → copy the anon /          *
   *      publishable key (the PUBLIC one) and paste it below.           *
   * ------------------------------------------------------------------ */
  var SUPABASE_URL = "https://mvuucbutwhlkmlsfbdqm.supabase.co";
  var SUPABASE_ANON_KEY = ""; /* ← paste the anon key here */

  var TABLE = "parkwise_users";
  var SESSION_KEY = "pw_session";
  var LOCAL_KEY = "pw_local_users";

  var sb = (SUPABASE_ANON_KEY && window.supabase && window.supabase.createClient)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

  /* ---- crypto helpers -------------------------------------------------- */

  function toHex(buf) {
    return Array.prototype.map.call(new Uint8Array(buf), function (b) {
      return b.toString(16).padStart(2, "0");
    }).join("");
  }

  function hexToBytes(hex) {
    var out = new Uint8Array(hex.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  function cryptoOk() {
    return !!(window.crypto && window.crypto.subtle && window.crypto.subtle.deriveBits);
  }

  function hashPassword(password, saltHex, iterations) {
    var enc = new TextEncoder();
    return window.crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"])
      .then(function (key) {
        return window.crypto.subtle.deriveBits(
          { name: "PBKDF2", hash: "SHA-256", salt: hexToBytes(saltHex), iterations: iterations },
          key, 256
        );
      })
      .then(function (bits) {
        return "pbkdf2$" + iterations + "$" + saltHex + "$" + toHex(bits);
      });
  }

  /* password vs stored "pbkdf2$iterations$salt$hash" record */
  function verifyPassword(password, stored) {
    var parts = String(stored || "").split("$");
    if (parts.length !== 4 || parts[0] !== "pbkdf2") {
      return Promise.reject(new Error("Corrupt credential record."));
    }
    return hashPassword(password, parts[2], parseInt(parts[1], 10) || 100000)
      .then(function (computed) {
        if (computed.length !== stored.length) return false;
        var diff = 0;
        for (var i = 0; i < computed.length; i++) {
          diff |= computed.charCodeAt(i) ^ stored.charCodeAt(i);
        }
        return diff === 0;
      });
  }

  /* ---- local (demo) store ---------------------------------------------- */

  function readLocal() {
    try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]"); }
    catch (err) { return []; }
  }

  function writeLocal(rows) {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(rows));
  }

  /* the admin account exists in the DB seed; mirror it for local demo */
  function ensureLocalAdmin() {
    var rows = readLocal();
    if (rows.some(function (r) { return r.username === "admin"; })) return Promise.resolve();
    return hashPassword("admin123", randomSalt(), 100000).then(function (hash) {
      rows.push({ username: "admin", password_hash: hash, role: "admin" });
      writeLocal(rows);
    });
  }

  function randomSalt() {
    return toHex(window.crypto.getRandomValues(new Uint8Array(16)));
  }

  /* ---- API: signup / login ---------------------------------------------- */

  function apiSignup(username, password) {
    if (!cryptoOk()) return Promise.reject(new Error("This browser can't hash passwords securely — open the site over HTTPS or localhost."));
    username = String(username || "").trim();
    if (username.length < 3) return Promise.reject(new Error("Username needs at least 3 characters."));
    if (password.length < 6) return Promise.reject(new Error("Password needs at least 6 characters."));

    return hashPassword(password, randomSalt(), 100000).then(function (hash) {
      if (sb) {
        return sb.from(TABLE).insert({ username: username, password_hash: hash, role: "user" })
          .then(function (res) {
            if (res.error) {
              if (res.error.code === "23505" || /duplicate|unique/i.test(res.error.message || "")) {
                throw new Error("That username is already taken.");
              }
              throw new Error(res.error.message || "Signup failed.");
            }
            return { username: username, role: "user" };
          });
      }
      var rows = readLocal();
      if (rows.some(function (r) { return r.username === username; })) {
        return Promise.reject(new Error("That username is already taken (on this device)."));
      }
      rows.push({ username: username, password_hash: hash, role: "user" });
      writeLocal(rows);
      return { username: username, role: "user" };
    });
  }

  function apiLogin(username, password, role) {
    if (!cryptoOk()) return Promise.reject(new Error("This browser can't verify passwords securely — open the site over HTTPS or localhost."));
    username = String(username || "").trim();

    if (sb) {
      return sb.from(TABLE).select("*").eq("username", username).maybeSingle()
        .then(function (res) {
          if (res.error) throw new Error(res.error.message || "Login failed.");
          var row = res.data;
          if (!row) throw new Error("No account with that username.");
          return verifyPassword(password, row.password_hash).then(function (ok) {
            if (!ok) throw new Error("Wrong password.");
            if (role && row.role !== role) {
              throw new Error(role === "admin"
                ? "This is not an admin account — sign in as User."
                : "Admin accounts must use the Admin option.");
            }
            return { username: row.username, role: row.role };
          });
        });
    }

    return ensureLocalAdmin().then(function () {
      var row = null;
      readLocal().forEach(function (r) {
        if (r.username === username) row = r;
      });
      if (!row) return Promise.reject(new Error("No account with that username (on this device)."));
      return verifyPassword(password, row.password_hash).then(function (ok) {
        if (!ok) throw new Error("Wrong password.");
        if (role && row.role !== role) {
          throw new Error(role === "admin"
            ? "This is not an admin account — sign in as User."
            : "Admin accounts must use the Admin option.");
        }
        return { username: row.username, role: row.role };
      });
    });
  }

  /* ---- session ----------------------------------------------------------- */

  function saveSession(s) { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); }
  function session() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); }
    catch (err) { return null; }
  }
  function logout() { localStorage.removeItem(SESSION_KEY); }

  /* ---- gate + page wiring ------------------------------------------------- */

  var onLoginPage = /(^|\/)login\.html$/.test(location.pathname);
  var current = session();

  if (!onLoginPage && !current) {
    location.replace("login.html");
    return;
  }
  if (onLoginPage && current) {
    location.replace("index.html");
    return;
  }

  function paintProfile() {
    if (onLoginPage || !current) return;
    var strong = document.querySelector(".profile-card strong");
    if (strong) strong.textContent = current.username;
    var avatar = document.querySelector(".profile-card .avatar");
    if (avatar) avatar.textContent = current.username.slice(0, 2).toUpperCase();
    var sub = document.querySelector(".profile-card div span");
    if (sub) sub.textContent = current.role === "admin" ? "Admin account" : "Personal account";
    var adminNav = document.querySelector('.main-nav .nav-item[data-view="admin"]');
    if (adminNav && current.role !== "admin") adminNav.style.display = "none";
  }

  function bindSignOut() {
    var btns = document.querySelectorAll(".sidebar-bottom .nav-item");
    for (var i = 0; i < btns.length; i++) {
      var label = btns[i].textContent || "";
      if (/sign out/i.test(label)) {
        btns[i].addEventListener("click", function () {
          logout();
          location.href = "login.html";
        });
      }
    }
  }

  paintProfile();
  bindSignOut();

  /* ---- public surface ------------------------------------------------------ */

  window.PWAuth = {
    configured: function () { return !!sb; },
    signup: apiSignup,
    login: apiLogin,
    saveSession: saveSession,
    session: session,
    logout: logout
  };
})();
