# EcoMQ – MQTT live-data design

One-page design note for Phase 2 (see PLAN.md). Placeholders only; no real hostnames, IPs or usernames (see "Public-fork hygiene" below).

## 1. Goal & data source

The browser subscribes over MQTT-over-websockets to the WeeWX `mqtt` uploader's aggregate topic, e.g. `weather/loop` (a single JSON object per loop packet) — the same feed the Belchertown skin already consumes. Anonymous, read-only broker access is recommended for this topic. `live.json` polling remains the fallback source; nothing about the archive/chart path changes.

## 2. Payload facts (verified against a live sample)

- Most keys carry an explicit unit suffix: `outTemp_C`, `windSpeed_kph`, `rain_mm`, `soilMoist1_centibar`, `wh65_batt_count`, …
- A few keys have no suffix at all: `inHumidity`, `extraHumid17`.
- Every value in the payload is a **string**, including numbers and `usUnits`.
- `usUnits` is present as `"16.0"` (METRIC) but **must not** be used to decide conversions: the uploader overrides at least rain to millimetres regardless of the nominal unit system, so the per-field suffix is the only reliable source of truth.
- Packets are **partial**: `windDir` is absent at calm wind, some `extraTempN` keys are missing when idle. The adapter must merge each field into a last-known-value model, never replace the whole model on a new packet.

## 3. Adapter (`js/mqtt-adapter.js`) and connection (`js/mqtt-live.js`)

Pipeline per message: parse JSON → for each key, find the *longest* matching known unit suffix → `Number(value)` (skip on `NaN`/empty string) → convert by an explicit suffix table to METRICWX → map the field name (gaps below, configurable via `options.fieldMap`) → merge into a last-known-value model (`createAdapter().ingest()`). `mqtt-live.js` then calls `window.ECCE_HOOKS.applyLiveModel(model, 'mqtt', receivedAt)`.

`applyLiveModel` shares `console.js`'s `applyLiveData` with the `live.json` poller (`fetchLive`), so both sources write into the same `S.live` model; `normaliseLive`'s flat-packet `usUnits` auto-conversion is never applied to MQTT packets (point 2 above). `ECCE_HOOKS` also exposes `isReady()` (`!!S.cfg`) and `getConfig()` (`S.cfg.mqtt`); `mqtt-live.js` polls `isReady()` before connecting and replays the latest message once it flips true.

Suffix → unit → factor, as implemented (unrecognised suffixes pass through unchanged and are reported via `adapter.getUnmapped()`):

| Suffix | Unit | → METRICWX | | Suffix | Unit | → METRICWX |
|---|---|---|---|---|---|---|
| `_C` | °C | unchanged | | `_centibar` | cbar (= kPa) | unchanged |
| `_F` | °F | `(v-32)*5/9` | | `_meter` | m | unchanged |
| `_kph` | km/h | `v/3.6` | | `_ppm` | ppm | unchanged |
| `_mph`, `_mile_per_hour` | mph | `v*0.44704` | | `_minute` | min | unchanged |
| `_mm` | mm | unchanged | | `_Wpm2` | W/m² | unchanged |
| `_inch` | in | `v*25.4` | | `_lux` | lux | unchanged |
| `_mm_per_hour` | mm/h | unchanged | | `_volt` | V | unchanged |
| `_inch_per_hour` | in/h | `v*25.4` | | `_byte` | B | unchanged (diagnostic) |
| `_hPa`, `_mbar` | hPa | unchanged | | `_microgram_per_cubicmeter` | µg/m³ | unchanged |
| `_inHg` | inHg | `v*33.8639` | | `_microgram_per_meter_cubed` | µg/m³ | unchanged |
| `_percent`, `_degree_compass`, `_count` | – | unchanged | | | | |

Verified field-name remaps (each backed by an actual live read in `console.js`, cited in the adapter's own header comment): `pm2_55`→`pm2_5`, and the sensor battery fields the driver names differently from the `<id>_batt` convention: `wh65_batt`→`outTempBatteryStatus`, `wh45_batt`→`co2_Batt`, `wh57_batt`→`lightning_Batt`, `wh51_chN_batt`→`soilMoistBattN`. Deliberately **not** remapped (pass through unchanged, not read live by `console.js` today, or unverified): `lightning_last_det_time` (plausible target `lightning_disturber_count`, but only confirmed for the archive-fed case — needs a real lightning event to verify live), `co2_24h_avg`, `pm2_55_24h_avg`, `pm10_0`, `altimeter`, `relbarometer`, `cloudbase`, `daySunshine_time`, `heap_free`, `maxSolarRad`, `uvradiation`, `luminosity`, `rain24`, `stormRain`, `daymaxwind`. `extraTemp17`/`extraHumid17` stay unmapped too: the skin's default channel list only goes to CH8.

## 4. Source selection / fallback

MQTT counts as fresh while a message arrived within `mqtt_stale_seconds` (`S.mqttLastSeen`, set from the message's own receive time, not the replay time). While fresh, `fetchLive()` skips the `live.json` poll entirely (no double polling); once stale, polling resumes on its own next tick. If `live.json` is also stale, the dashboard falls back to archive-only, same as today. The Wi-Fi header icon/tooltip names the active source (`Live data (MQTT), Ns old` / `Live data (live.json), Ns old` / archive-only / stale, unchanged wording otherwise). Rendering triggered by MQTT is throttled to at most once per second, with a trailing render scheduled so the last packet in a burst is never left undrawn. Reconnects use manual exponential backoff, 1s to 30s. `S.cfg` (hence `getConfig()`) only exists after `init()` has processed the embedded page config, so `mqtt-live.js` polls `isReady()` every 500ms (giving up after ~2 minutes) before connecting, and queues one pending model to replay once ready.

## 5. Configuration

Belchertown-compatible key names, so a user can copy values straight from their existing Belchertown setup. Lives in `weewx.conf [StdReport][[EcowittConsoleEmulatorReport]][[[Extras]]]` (survives reinstalls; `skin.conf` is overwritten on update), read with explicit `extras.get()` calls in `build_dashboard_config()` and embedded in the page config as `config['mqtt']`, same path as every other `Extras` setting today. Invalid `mqtt_websockets_port`/`mqtt_stale_seconds` values fall back to their default with one log warning, never raise.

| Key | Meaning | Placeholder example | Required |
|---|---|---|---|
| `mqtt_enabled` | turn the MQTT source on | `false` (default) | no |
| `mqtt_websockets_host` | broker hostname | `broker.example.org` | if enabled |
| `mqtt_websockets_port` | websocket port | `9001` (default) | no |
| `mqtt_websockets_ssl` | use `wss://` | `true` (default) | no |
| `mqtt_websockets_path` | websocket URL path | `/` (default) | no |
| `mqtt_topic` | aggregate loop topic | `weather/loop` (default) | no |
| `mqtt_username` | optional login | empty = anonymous (default) | no |
| `mqtt_password` | optional login | empty = anonymous (default) | no |
| `mqtt_stale_seconds` | freshness window | `30` (default) | no |

## 6. Public-fork hygiene

The repo ships only defaults and placeholders (as above); real values live only in the user's own `weewx.conf`, never in this repository. A local, untracked private-strings list drives a pre-commit/deploy secret check that blocks any commit or push containing one of those strings.

## 7. Why MQTT via the Belchertown/uploader feed

Already widely deployed (any Belchertown install already has it running); no extra service needed on the WeeWX host; works even when the report is served from a different machine than WeeWX; roughly 1-second push updates instead of polling; `live.json` stays as the fallback. Trade-off: requires a websocket listener on the broker. `mqtt.js` is vendored locally (no CDN), so the page keeps working without outside internet access.

## 8. Open points

- `lightning_last_det_time`'s remap to `lightning_disturber_count` is not applied yet (section 3): needs a real lightning event to confirm the live loop packet actually uses that field name, not just the archive query path.
- Rain-rate and daily-total semantics still need a side-by-side check against `live.json`/archive values.
- No browser/DOM-level test yet (would need a headless browser or `jsdom`, an npm dependency we've avoided so far); `node --test tests/` covers the adapter and `createSourceTracker` only. Manual check against the real site is still required before calling Phase 3b done.
- Reconnect backoff (1s..30s) and the stale/fresh source switch are implemented but not yet exercised against a real broker outage.
- `eventRain`/`erain_piezo` (the "Event" rain reading `RF.trad.event`/`RF.piezo.event`) were absent from the dry-weather sample payload in section 2. Most likely there was simply no rain event at the time; this is unverified. After switching the dashboard to MQTT it still showed an event value, but live.json had shown the same value before, and the page starts from live.json and only overlays MQTT data, so that does not prove the MQTT path delivers it. To be confirmed during the next rain: does the Event value follow the MQTT payload?
