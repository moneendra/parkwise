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
| `app.js` | Interactivity: view switching, live slot numbers, booking → UPI flow, toasts |

## Notes

- **Demo data only** — availability numbers drift every 10 seconds and bookings are
  kept in the page (nothing is sent to a server).
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
