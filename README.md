# Christchurch commute assistant

Safety-first Cloudflare Worker for a weekday iPhone commute notification to **287 Durham Street North, Christchurch Central City**, with a hard **08:30 Pacific/Auckland** arrival deadline.

Supported zero-transfer journeys:

- Home → Metro Route 27 toward Huntsbury / city.
- Flex Fitness Belfast, 4 Bellewood Avenue → Metro Route 1 toward Cashmere / city.

The private home street address is never stored in this repository. Production only needs the public Metro boarding stop plus a measured walking baseline inside Cloudflare secrets.

## Final decision model

The Worker no longer depends on a bus already being visible in GTFS-Realtime at 07:00.

1. A compact `JOURNEY_SCHEDULE` secret is generated locally from Metro's official GTFS Static feed.
2. The generator selects only trips that actually serve the configured boarding and alighting stops in order.
3. It honours GTFS `pickup_type` / `drop_off_type`, so trips that pass a stop without allowing boarding are excluded. This is important for Route 1 express services.
4. GTFS `calendar.txt` and `calendar_dates.txt` determine whether a trip is active on the local service date.
5. Fresh GTFS-Realtime Trip Updates overlay the static candidate when available.
6. Missing or stale realtime does **not** imply "on time"; it leaves the trip at conservative confidence C using the static schedule.
7. Realtime cancellation/deletion/replacement or a skipped configured stop removes the affected trip.
8. Metro Service Alerts are mandatory. If alerts cannot be checked, the recommendation fails closed.
9. Open-Meteo can only increase walking risk buffers. Weather never changes the Metro bus ETA.
10. All remaining trips are evaluated independently; the Worker chooses the **latest leave-by time** that still meets the conservative 08:30 deadline.

## Confidence levels

- **A** — fresh realtime prediction available at both configured stops.
- **B** — fresh realtime is partial; one target time still relies on the static schedule.
- **C** — official GTFS Static fallback only.

Omitted GTFS-Realtime uncertainty is treated as unknown rather than zero. Static fallback carries its own uncertainty allowance.

## Walking calibration

Walking is split into:

- `accessWalkingMinutes`: origin → boarding stop.
- `egressWalkingMinutes`: alighting stop → work.

The production model adds the user's personal **+2 minute walking buffer to each walking leg**. Weather can add a further 0–6 minutes to each walking leg. A separate `boardingLeadMinutes` requires arrival at the stop before the predicted bus.

Current conservative calibration in the example:

- Home access baseline: 14 minutes.
- Gym access baseline: 8 minutes.
- Manchester St Super Stop → work baseline: 12 minutes.
- Personal walking buffer: +2 minutes per walking leg.
- Boarding lead: 2 minutes.
- Additional arrival safety margin: 10 minutes.

These baselines are deliberately conservative; changing them changes the latest-safe leave time and should be done only after measuring the same walking route repeatedly.

## Why Manchester St Super Stop

The configured CBD alighting stop is public stop `53074` (Manchester St Super Stop). It is served by both selected southbound routes in the validated GTFS sequence and avoids a transfer. The final walking baseline remains conservative rather than relying on a daily routing API.

## Required secrets

Production requires exactly four Worker secrets:

- `METRO_API_KEY`
- `JOURNEY_CONFIG`
- `JOURNEY_SCHEDULE`
- `COMMUTE_TOKEN`

`wrangler.toml` declares all four as required, so a deployment must fail if one is missing. Secret values are never committed.

## Generate the private schedule

The schedule is regenerated from official GTFS whenever Metro publishes a timetable change.

1. Put the private configuration at:
   `data/private/journey-config.private.json`
2. Download current GTFS:
   `npm.cmd run gtfs:fetch`
3. Generate the compact schedule:
   `npm.cmd run journey:schedule`

The output is:

`data/private/journey-schedule.private.json`

The generator:

- never copies the private home address;
- selects the exact configured stop pair;
- rejects no-pickup/no-drop-off trips;
- includes only weekday-capable morning services;
- includes service-calendar exceptions;
- refuses output above Cloudflare's 5 KB variable limit.

Upload it without placing its value in shell history:

```powershell
Get-Content .\data\private\journey-schedule.private.json -Raw | npx.cmd wrangler secret put JOURNEY_SCHEDULE
```

## Runtime endpoints

Public:

- `GET /health` — readiness metadata only; no secret values.

Bearer-authenticated:

- `GET /commute?origin=home`
- `GET /commute?origin=gym`
- `GET /validate` — validates config/schedule plus live Metro Trip Updates and Service Alerts without making a commute recommendation.

Authorization:

`Authorization: Bearer <COMMUTE_TOKEN>`

All responses use `Cache-Control: no-store`.

## Weekday behavior

Weekend requests and requests after the local 08:30 deadline return `status: "outside-window"` and do not make Metro/weather calls for a morning recommendation.

At weekday commute time the Worker:

1. resolves the current local service date;
2. builds catchable static GTFS candidates;
3. overlays fresh realtime where available;
4. applies cancellations/skipped stops and mandatory Service Alerts;
5. applies walking, weather, uncertainty and safety margins;
6. picks the latest safe leave-by time.

If no trip can be verified conservatively, the user is told to check MetroGo.

## Local checks

Windows PowerShell:

```powershell
npm.cmd install
npm.cmd run format:check
npm.cmd run lint
npm.cmd run check
npm.cmd test
npm.cmd run worker:check
```

Use `npm.cmd` / `npx.cmd` on machines where PowerShell blocks the npm `.ps1` shim.

## Deployment

```powershell
npx.cmd wrangler secret list
npx.cmd wrangler deploy
```

The Worker is configured for `workers.dev` and disables preview URLs. Wrangler is pinned in `package.json` so a future CLI release cannot silently alter the deployment path.

## iPhone automation

The intended Personal Automation:

- 07:00 weekday authenticated request.
- Retry at 07:05 and 07:10 if the request fails.
- Silent rechecks around 07:25 and 07:35.
- Notify again only when the leave-by time materially worsens or the trip becomes unverified.
- Never reuse a previous positive response.
- Open MetroGo when `safeRecommendation !== true`.

The Shortcut should store the Bearer token locally and send it in the `Authorization` header, never in the URL.

## Cost and privacy

The architecture is designed for Cloudflare Workers Free and very low request volume. It uses no paid mapping service, no VPS, no trial dependency, and no credit-card-only service.

Private address, Metro API key, commute token and private journey files must never be committed, pasted into GitHub issues/PRs, or written to Worker logs.
