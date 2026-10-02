# Find your connection

A tiny Vue 3 page that shows the next public transport connections between Munich stops, with live delays, in a Google Maps-style list. Each connection refreshes every 30 seconds.

Live at https://find-your-connection.vercel.app

## Choosing connections by URL

Connections are read from repeated `c` parameters. Stops are separated by `~`, and a stop can be prefixed with `<modes>@` to say how to get there:

```
?c=<from>~<to>                               any transport
?c=<from>~bus,tram@<to>                      only these modes
?c=<from>~bus@<via>~ubahn@<via>~sbahn@<to>   fixed route through via stops
```

- Stops are station names (`Alte Heide`), MVG global IDs (`de:09162:530`), `here`, or coordinates (`48.18372,11.59668`).
- Modes: `bus`, `ubahn`, `tram`, `sbahn`, `bahn`. They are optional on every leg.
- Repeat `c` for several connections on one page.
- The older form `?c=<from>~<to>~bus` still works.

Example: a simple bus connection, plus a fixed route that takes the bus to Alte Heide, the U-Bahn to Marienplatz and the S-Bahn to Fasanenpark:

```
?c=Gertrud-Grunow-Straße~bus@Alte Heide&c=Gertrud-Grunow-Straße~bus@Alte Heide~ubahn@Marienplatz~sbahn@Fasanenpark
```

### Current location

Use `here` as a stop (or **Start from current location** in the add form) to route from wherever the device is. The browser asks for location permission, and the first leg becomes the walk to the nearest suitable stop.

**Copy display link** replaces `here` with the coordinates the device has at that moment, for example `?c=48.18372,11.59668~Alte Heide&display=1`, so the TV never asks for a location. Note that this link therefore contains those coordinates.

### Fixed routes (via stops)

Via stops are optional. Without them MVG picks the route. With them, each leg is looked up on its own and the rides are chained, allowing 2 minutes to change at each via stop, so the route always changes where you asked. When several early rides lead to the same onward connection, only the last one that still makes it is listed. On the page, use **Add a stop to change at** on a connection. **Hide departures** folds away a connection's fetched rows while keeping its stops and filters visible. Drag a stop by its handle to reorder the sequence; the transport filters stay with their position (first leg, second leg, …).

Without parameters the page shows buses from Gertrud-Grunow-Straße to Alte Heide. Reversing, removing, filtering or adding a connection on the page rewrites the URL, so bookmark it to keep your setup.

## TV display mode

Add `&display=1` to the URL, or use the **Copy display link** button, to get a read-only board: the stop inputs, filters and add form are hidden, and each connection shows as many upcoming departures as fit the screen (more on larger resolutions, up to eight) in large text, without scrolling. Remove `display=1` to edit again.

By default the board decides how many connections go side by side. Add `&cols=1` or `&cols=2` (or pick it under **Connections per row on the TV** before copying the link) to force one or two per row. With one per row, each departure is laid out on a single line across the full width.

## Run

```bash
npm install
npm run dev
```

`npm run build` writes a static site to `dist/` that can be hosted anywhere.

## Data

The page calls the unofficial MVG API (`https://www.mvg.de/api/bgw-pt/v3`) straight from the browser; no key or backend is needed. It uses `/routes` for connections and `/locations` or `/stations/<id>` to resolve stops.

The API is undocumented and may change without notice. MVG only permits private, non-commercial use. This project is not affiliated with MVG or Google.
