# mvg-alte-heide

A tiny Vue 3 page that shows the next public transport connections between Munich stops, with live delays, in a Google Maps-style list. Each connection refreshes every 30 seconds.

## Choosing connections by URL

Connections are read from repeated `c` parameters:

```
?c=<from>~<to>            any transport
?c=<from>~<to>~bus,tram   only these modes
```

- `<from>` and `<to>` are station names (`Alte Heide`) or MVG global IDs (`de:09162:530`).
- Modes: `bus`, `ubahn`, `tram`, `sbahn`, `bahn`.
- Repeat `c` for several connections on one page.

Example, both directions of one trip plus a second trip:

```
?c=Gertrud-Grunow-Straße~Alte Heide~bus&c=Alte Heide~Gertrud-Grunow-Straße~bus&c=Alte Heide~Marienplatz
```

Without parameters the page shows buses from Gertrud-Grunow-Straße to Alte Heide. Reversing, removing, filtering or adding a connection on the page rewrites the URL, so bookmark it to keep your setup.

## Run

```bash
npm install
npm run dev
```

`npm run build` writes a static site to `dist/` that can be hosted anywhere.

## Data

The page calls the unofficial MVG API (`https://www.mvg.de/api/bgw-pt/v3`) straight from the browser; no key or backend is needed. It uses `/routes` for connections and `/locations` or `/stations/<id>` to resolve stops.

The API is undocumented and may change without notice. MVG only permits private, non-commercial use. This project is not affiliated with MVG or Google.
