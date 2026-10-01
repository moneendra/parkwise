# Parkwise 🅿️

**Smart parking, without the search** — a modern parking booking dashboard with a
workspace-style UI: overview metrics, live availability across locations, a
pick-your-bay booking flow, UPI payment step, booking history and an admin console.

**Live demo:** https://moneendra.github.io/parkwise/

## Files

| File | Purpose |
|---|---|
| `index.html` | The full single-page dashboard (overview · find parking · activity · admin) |
| `theme.css` | Design tokens: colors, fonts, radii, base styles |
| `styles.css` | Layout + components, fully responsive |
| `app.js` | Interactivity: view switching, live slot numbers, booking → UPI flow, IR grace window, toasts |

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

## Run locally

Open `index.html` directly in a browser, or serve the folder:

```bash
npx serve .        # or any static file server
```

## License

MIT
