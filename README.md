# Parkwise 🅿️

**Smart parking, without the search** — a modern parking booking dashboard with a
workspace-style UI: overview metrics, live availability across locations, a
pick-your-bay booking flow, UPI payment step, booking history and an admin console.

**Live demo:** https://moneendra.github.io/parkwise/

## Files

| File | Purpose |
|---|---|
| `index.html` | The full single-page dashboard (overview · find parking · activity · admin) |
| `login.html` | Sign-in / create-account page (User and Admin roles) |
| `theme.css` | Design tokens: colors, fonts, radii, base styles |
| `styles.css` | Layout + components, fully responsive |
| `auth.css` | Login page styles |
| `auth.js` | Sessions, PBKDF2 password hashing, Supabase DB + local fallback, page gating |
| `app.js` | Interactivity: view switching, live slot numbers, booking → UPI flow, IR grace window, toasts |
| `car-video.mp4` | Background video (aerial parking lot, from Pexels, free license) |
| `supabase-setup-parkwise.sql` | One-time SQL: `parkwise_users` table + RLS + seeded admin |

## Notes

- **Demo data only** — availability numbers drift every 10 seconds and bookings are
  kept in the page (nothing is sent to a server).
- **Any-time booking + IR grace window** — the arrival time accepts any time of day.
  After the reserved arrival time passes, the IR sensor watches the bay for
  5 minutes: if a car is detected the bay shows *Occupied* (and *Available* again
  when it leaves), otherwise the bay is freed and shows *Available*.
- **Live IR hardware** — the bay map is the real sensor lot (S1–S6). The page
  subscribes to the same MQTT topics the Arduino system publishes
  (`smartparking/mne-f3kqz2/slot/<ID>/status` + `/availability` on
  `broker.emqx.io`, over secure WebSocket). With the Uno plugged in and
  `serial-bridge.js` running, the chip above the map turns green
  *“IR hardware live”* and the bays follow the real HW-201 sensors.
  No hardware online? It falls back to a simulated demo automatically.
- **Background video** — the page looks for `123456789.mp4` next to `index.html`.
  Drop the file in to enable it; without it a clean gradient background is shown.
- **UPI payment** — the payment step links to the UPI deep link in `index.html`
  (`upi://pay?…`) and reveals a *Verify payment* button, mirroring a real UPI flow.
- Icons load from [lucide](https://lucide.dev) and fonts from Google Fonts (CDN).

## Login & the users database

The whole site sits behind `login.html`. Admins get the **Admin console** menu;
normal users don't. Passwords are salted **PBKDF2-SHA256** (Web Crypto) and are
never stored in plain text.

Out of the box the site runs in **demo storage** mode: accounts live in the
browser only, and the seeded demo admin is `admin` / `admin123`.

To store accounts in the **real database** (your existing Supabase project):

1. **Create the table** — Supabase Dashboard → SQL Editor → paste
   `supabase-setup-parkwise.sql` → Run. This creates `parkwise_users`
   with Row Level Security (the public site may only sign people up and
   check logins) and seeds the `admin` account.
2. **Paste the public key** — Supabase Dashboard → Settings → API → copy the
   **anon / publishable** key (never the secret one!) and paste it into
   `SUPABASE_ANON_KEY` at the top of `auth.js`.

That's it — signups and logins now hit the database from the live GitHub Pages
site. Create more admins by inserting rows (role `admin`) from the Supabase
Table Editor.

## Run locally

Open `index.html` directly in a browser, or serve the folder:

```bash
npx serve .        # or any static file server
```

## License

MIT
