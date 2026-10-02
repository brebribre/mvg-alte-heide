# mvg-alte-heide

A tiny Vue 3 page listing the next direct buses from the **Gertrud-Grunow-Straße** stop to **Alte Heide** in Munich, with live delays. It refreshes every 30 seconds.

## Run

```bash
npm install
npm run dev
```

`npm run build` writes a static site to `dist/` that can be hosted anywhere.

## Data

The page calls the unofficial MVG API (`https://www.mvg.de/api/bgw-pt/v3`) straight from the browser; no key or backend is needed.

- `/routes` gives the direct bus rides between the two stops.
- `/departures` gives live delays and cancellations for the origin stop.

The API is undocumented and may change without notice. MVG only permits private, non-commercial use. This project is not affiliated with MVG.

To use other stops, change `ORIGIN` and `DESTINATION` in `src/api.js`. Station IDs can be looked up with `/locations?query=<name>`.
