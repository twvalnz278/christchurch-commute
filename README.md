# Christchurch commute assistant

Safety-first first version of an iPhone-oriented morning commute report. The hard requirement is arrival at **287 Durham Street North, Christchurch Central City, Christchurch 8013 by 08:30 Pacific/Auckland**. It compares **Home → Route 27 toward Huntsbury/Christchurch city** with **Flex Fitness Belfast, 4 Bellewood Avenue → Route 1 toward Cashmere/Christchurch city**, preferring no transfer and less walking only after an option has passed live-data and deadline checks.

Flex Fitness Belfast is a fixed physical gym, not a transport or booking service. Metro's static GTFS, GTFS-Realtime Service Alerts, and SIRI Estimated Time endpoint URLs and authentication header have been manually verified. Exact stop IDs, the SIRI response schema, current times, walking durations, and the private home location remain unverified. The adapter therefore fails closed and says to check MetroGo. It never treats a scheduled time as a live prediction.

## Current design

- `src/gtfs/static.ts`: downloads and parses bounded GTFS ZIP data and validates configured route/stops against it.
- `src/gtfs-realtime/service-alerts.ts`: decodes Service Alerts using the official GTFS-Realtime protobuf field definitions.
- `src/siri.ts`: calls the verified Estimated Time URL, while refusing to interpret its still-unverified response schema.
- `src/metro.ts`: validates static identifiers before requesting or interpreting a live journey.
- `src/freshness.ts`: rejects future, invalid, or old observations.
- `src/evaluate.ts`: rejects missing, stale, conflicting, invalid, or late results; adds the confirmed final walk, source uncertainty, and a configurable arrival margin.
- `src/deadline.ts`: creates the 08:30 deadline in `Pacific/Auckland`, including daylight-saving offset.
- `src/format.ts`: plain text suitable for Shortcuts plus a JSON option.
- `src/worker.ts`: Cloudflare Worker `/health` and `/commute?origin=home|gym` routes with `no-store` responses.

The interfaces in `src/types.ts` are an **internal normalized model**, not an assertion about Metro response fields. Tests use synthetic mock observations only.

## Private configuration

`docs/journey-config.example.json` documents the shape, using obvious placeholders rather than real stops or private locations. Never edit it with personal values. Copy it outside the repository, confirm every value, then store the complete JSON as the Cloudflare **Secret** `JOURNEY_CONFIG`. `journey-config.json`, `.dev.vars`, and private JSON files are ignored.

The following must be confirmed before setting the secret:

1. Exact private origin and acceptable disclosure/storage policy.
2. Route 27 boarding and alighting stop IDs.
3. Route 1 stops near the fixed Flex Fitness Belfast origin at 4 Bellewood Avenue.
4. Route 1 boarding and alighting stop IDs.
5. Walking times measured conservatively, including the final walk to the destination.
6. Whether each option truly has zero transfers.
7. A suitable freshness threshold based on the documented feed frequency.
8. An explicit safety margin; the example's `walkingMinutes: 0` values are placeholders, not estimates.

Configuration validation refuses blank origins/stops, but a human must ensure placeholder text has been replaced and facts are correct.

## Verified Metro interfaces

All three authenticated requests use the `Ocp-Apim-Subscription-Key` header, populated only from the `METRO_API_KEY` Worker secret:

- GTFS Static: `GET https://apis.metroinfo.co.nz/rti/gtfs/v1/gtfs.zip`
- GTFS-Realtime Service Alerts: `GET https://apis.metroinfo.co.nz/rti/gtfsrt/v1/service-alerts.pb`
- SIRI Estimated Time: `GET https://apis.metroinfo.co.nz/rti/siri/v1/et?routecode={routecode}`

Static GTFS is the source of truth for routes, stops, trips, stop times, and service calendars. The parser requires those tables, applies compressed/download and expanded-entry limits, validates ZIP paths and CRCs, decodes UTF-8 strictly, and parses quoted CSV. The Worker caches a successfully loaded feed in an isolate for at most one hour; failed loads are evicted.

Service Alerts parsing is implemented from the official GTFS-Realtime protobuf schema. The configurable conservative policy ignores unrelated/inactive alerts, blocks relevant explicit no-service/cancellation/closure alerts, marks relevant significant-delay/detour/stop-move alerts high risk, annotates configured lesser effects, and returns `CONFLICT` for ambiguous relevant alerts. Recommendation wiring still remains TODO until sanitized production fixtures are reviewed. SIRI and GTFS-Realtime share the same Metro API host and authentication mechanism here; the code does not claim they are operationally independent.

**Explicitly unverified/TODO:** Trip Updates and Vehicle Positions endpoints. They are not called or invented anywhere in this project.

## Still required before recommendations

- Identify current GTFS `route_id` values whose `route_short_name` is `27` and `1`.
- Confirm boarding and alighting `stop_id` values for both journeys. The Worker checks that each exists and is served by a trip on the configured route before any SIRI interpretation.
- Obtain the documented SIRI Estimated Time response schema and sanitized fixture. The URL and route-code parameter are verified; response fields are not, so `UnverifiedSiriParser` intentionally returns no journey.
- Verify how SIRI records match GTFS routes, stops, trips and direction, including timestamp and cancellation behavior.
- Verify the static feed licence/update policy, SIRI/alerts quotas and cache terms, and Service Alert recommendation rules.
- Human-review Route 27 candidates in the Casebrook/Regents Park area, Route 1 candidates near the gym, and CBD alighting candidates for the final walk. The discovery tool deliberately does not select them.
- Confirm the private origin, both final walking times, and whether each journey is transfer-free.

## Weather

Open-Meteo is an intended enhancement, but is not called in this version. Before adding it, verify its current endpoint/schema, attribution, acceptable-use limits, and continued no-card availability. Weather may increase the walking/uncertainty margin; it must never reduce it or make an unverified journey safe.

## Local development

Prerequisites: Node.js 20+ and TypeScript 6+ available on `PATH`.

```sh
npm install
npm run format
npm run format:check
npm run lint
npm run check
npm test
npm run worker:check
```

Wrangler is declared from npm's current stable `latest` release channel as a development dependency; commit the resolved lockfile after installing in a network-enabled environment. ZIP, CSV, and protobuf parsing use Worker-compatible Web APIs and local TypeScript. To exercise the HTTP handler locally, use non-private fixtures; do not paste secrets into shell history. Without a verified SIRI parser and GTFS-confirmed IDs, commute results remain explicitly unverified.

### Fetch and inspect current GTFS safely

Set `METRO_API_KEY` in the local process environment without putting it in an argument, source file, shell-history assignment, or committed dotenv file. Then run:

```sh
npm run gtfs:fetch
npm run gtfs:discover -- data/production/gtfs.zip --output data/discovery/routes-1-27.json
```

The fetch command uses the verified endpoint/header, rejects redirects, times out after 20 seconds, streams with a 30 MB compressed-response ceiling, validates archive structure, expansion limits, required tables, UTF-8, and CRCs, and atomically stores the result with owner-only permissions. Production downloads, partial files, diagnostic responses, and discovery reports under `data/` are ignored by Git.

Discovery includes only routes whose `route_short_name` is exactly `1` or `27`; route IDs and names; observed headsigns/directions; trip and service IDs; service activation derived from `calendar.txt` plus `calendar_dates.txt`; ordered stop sequences; and public stop IDs, names, and coordinates. Its direction-term filter creates candidate pools only. It cannot determine the correct Casebrook/Regents Park, gym, or CBD stop without human map/walking review, and it never reads or prints the private home address.

To inspect a specific service date, append `--date YYYYMMDD`. Send back the discovery JSON or, preferably, a reduced list containing the route ID, headsign, direction ID, boarding candidates, CBD alighting candidates, and ordered sequence for each option. Do not send the private home address or a Metro key.

### Capture an opaque SIRI diagnostic body

After setting the key locally, run one of:

```sh
npm run siri:diagnose -- 27
npm run siri:diagnose -- 1
```

The command saves only the bounded response body under ignored `data/diagnostics/`; request headers, credentials, and the key are not serialized. Treat the output as opaque until the response schema is verified, and review it for unexpected sensitive content before sharing a sanitized copy.

## Cloudflare secrets and deployment preparation

Do not deploy until Metro documentation and the private configuration have been confirmed. Immediately before eventual deployment:

1. Regenerate the Metro credential so any previously handled value is invalid.
2. In a terminal controlled by the user, run `npx wrangler secret put METRO_API_KEY` and enter the newly regenerated value only into Wrangler's hidden prompt. Do **not** give its value to GitHub, Codex, source files, issue text, build logs, or command arguments.
3. Run `npx wrangler secret put JOURNEY_CONFIG` and enter the verified private JSON into the secret prompt. Do not commit that JSON.
4. Add a SIRI parser only from verified documentation and sanitized fixtures; never log request headers, raw private configuration, or payloads containing personal details.
5. Confirm Cloudflare Workers' current free plan permits the expected traffic without a card. If it does not, this architecture does not satisfy the NZ$0/no-card constraint and deployment must stop.
6. Run type checks, tests, a full-history secret scan, and a local fail-closed exercise.

`METRO_API_KEY` is read only at request time and passed only in the verified subscription header. The code never prints or returns it.

## 07:00 report and rechecks

The intended iPhone Shortcut workflow is:

1. Personal Automation at 07:00 calls `GET https://<verified-worker-host>/commute?origin=home` or `?origin=gym` with `Accept: text/plain` and displays the response.
2. Separate pre-departure automations re-call the selected commute endpoint at confirmed decision points. Times cannot be set responsibly until walking durations, boarding stops, directions, and actual service data are known.
3. For structured Shortcut logic, request `Accept: application/json` and require `safeRecommendation === true`; otherwise show the fallback verbatim and open MetroGo manually.
4. Never let a Shortcut reuse a previous positive response: responses use `Cache-Control: no-store`, and every recheck must succeed independently.

The endpoint currently has no access-control layer. Do not deploy it with private configuration until an iPhone-compatible authentication design has been selected and verified. Any credential must be stored in Cloudflare/Shortcuts secret storage, never in Git.

`GET /health` reports integration readiness but does not contact Metro or expose secret/configuration values. It must not be interpreted as proof that a commute is safe.

Do not automate notifications until the Worker has a verified data adapter and all failure cases have been tested. MetroGo remains the manual fallback whenever live data is missing, stale, contradictory, or cannot establish arrival by 08:30.

## Cost constraints

The target is long-term **NZ$0**, without a credit card, trial, VPS, LINE, or Telegram. No paid service is introduced here. Cloudflare plan limits, Metro access terms, mapping/geocoding (if later added), and Open-Meteo use must be rechecked before deployment. Any component requiring billing details, a trial, or an uncertain ongoing free tier must be rejected or clearly replaced before launch.
