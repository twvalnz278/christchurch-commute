# Christchurch commute assistant

Safety-first Cloudflare Worker for an iPhone morning commute notification. The hard requirement is arrival at **287 Durham Street North, Christchurch Central City by 08:30 Pacific/Auckland**.

The two supported zero-transfer journeys are:

- Home → Metro Route 27 toward Huntsbury / city.
- Flex Fitness Belfast, 4 Bellewood Avenue → Metro Route 1 toward Cashmere / city.

The private home street address is deliberately **not stored in this repository or required by the Worker**. The production secret only needs the confirmed boarding stop and measured access-walk baseline.

## Current data path

1. Metro GTFS Static validates current routes, stops, trips, stop order and service structure.
2. Metro GTFS-Realtime Trip Updates supplies predicted boarding/alighting times.
3. Static GTFS trip IDs are used to match realtime records; the captured Metro Trip Updates feed can omit `route_id`.
4. Metro GTFS-Realtime Service Alerts are a conservative safety gate. Relevant BLOCK, HIGH_RISK or ambiguous CONFLICT alerts prevent a verified recommendation.
5. Open-Meteo changes walking risk only. It never changes the Metro bus ETA.
6. The evaluator checks whether the bus is still physically catchable, calculates a local leave-by time, adds final walking and safety margins, and enforces the hard 08:30 deadline.
7. Any missing, stale, contradictory or unsafe condition fails closed to MetroGo.

SIRI Estimated Time remains available only as a diagnostic. Production captures returned a valid JSON envelope but no usable journey payload, so the recommendation engine does not depend on it.

## Walking and safety model

Walking is split into two legs:

- `accessWalkingMinutes`: origin → boarding stop.
- `egressWalkingMinutes`: alighting stop → work.

A configurable personal `walkingBufferMinutes` is added to **each** walking leg. The intended production value is 2 minutes because the user walks more slowly than the map baseline.

A separate `boardingLeadMinutes` requires arrival at the stop before the predicted bus. Weather can only increase walking buffers. If weather lookup fails, a conservative fallback walking increment is applied.

The text response is formatted in `Pacific/Auckland`, while JSON timestamps remain ISO timestamps.

## Current public stop configuration

`docs/journey-config.example.json` contains only public/non-sensitive configuration and placeholders. Current public values include:

- Route 27 Huntsbury-bound route hint: `27_4175_6_3`.
- Route 1 southbound route hint: `1_0854_6_3`.
- Common CBD alighting candidate: `53074` (Manchester St Super Stop).
- Gym boarding candidate: `15357` (Main North Rd near Belfast Rd).

GTFS route IDs can change between timetable versions. The Worker therefore treats the configured route ID as a hint: if it no longer exists, it attempts to resolve the unique current route variant using route short name plus boarding/alighting stop order. Ambiguous or missing matches fail closed.

The real home boarding stop and access-walk baseline belong only in the Cloudflare `JOURNEY_CONFIG` secret, never in tracked files.

## Verified Metro interfaces

Authenticated Metro calls use `Ocp-Apim-Subscription-Key` from the `METRO_API_KEY` Worker secret:

- GTFS Static: `GET https://apis.metroinfo.co.nz/rti/gtfs/v1/gtfs.zip`
- GTFS-Realtime Trip Updates: `GET https://apis.metroinfo.co.nz/rti/gtfsrt/v1/trip-updates.pb`
- GTFS-Realtime Service Alerts: `GET https://apis.metroinfo.co.nz/rti/gtfsrt/v1/service-alerts.pb`
- GTFS-Realtime Vehicle Positions: endpoint identified but not required for V1.
- SIRI Estimated Time: diagnostic only.

A real Trip Updates capture was validated without committing the raw production payload. Synthetic parser tests remain in the repository.

## API surface and privacy

- `GET /health` — readiness metadata only; does not expose secrets or private configuration.
- `GET /commute?origin=home`
- `GET /commute?origin=gym`

The commute endpoint requires:

`Authorization: Bearer <COMMUTE_TOKEN>`

Responses use `Cache-Control: no-store`. The token, Metro key and private journey JSON are Cloudflare secrets and must never be committed, pasted into issue/PR text, or placed in command arguments.

## Local checks

On Windows PowerShell in this project use `npm.cmd` / `npx.cmd` because the PowerShell execution policy may block the `.ps1` npm shim.

```powershell
npm.cmd install
npm.cmd run format:check
npm.cmd run lint
npm.cmd run check
npm.cmd test
npm.cmd run worker:check
```

Production captures and discovery files under `data/` are ignored by Git.

## Deployment gate

Do not call this production-ready until all of the following pass:

1. Full local build/lint/test/Worker dry-run on the PR branch.
2. Current GTFS confirms the configured home/gym boarding and CBD alighting journey order.
3. A live Trip Updates check confirms both configured journeys can be matched.
4. Cloudflare's current free/no-card constraints are rechecked.
5. `METRO_API_KEY`, `JOURNEY_CONFIG`, and `COMMUTE_TOKEN` are stored as Worker secrets.
6. Authenticated Worker responses are tested without exposing secrets.
7. iPhone Shortcuts retries/rechecks and MetroGo fallback are configured and tested.

## Intended iPhone flow

The iPhone Personal Automation calls the authenticated Worker at about 07:00 on weekdays, retries if the request fails, and displays the returned local leave-by time and conservative work-arrival time. Later pre-departure rechecks notify only if the recommendation materially worsens.

A positive result is never reused from cache. If live data cannot verify a safe journey, the notification tells the user to check MetroGo.
