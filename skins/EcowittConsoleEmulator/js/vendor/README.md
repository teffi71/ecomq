# Vendored: mqtt.js

- **Package**: [`mqtt`](https://www.npmjs.com/package/mqtt) on npm, by the MQTT.js contributors.
- **Version pinned**: `5.16.1`.
- **File**: `mqtt.min.js`, copied verbatim from that version's `dist/mqtt.min.js` (the
  browser bundle; exposes a `window.mqtt` global).
- **Source**: `npm pack mqtt@5.16.1` (run in a scratch directory under `/tmp`, outside this
  repo, per CLAUDE.md rule 2 -- `npm` is never run inside the repo itself), then
  `dist/mqtt.min.js` was copied in as-is from the extracted tarball.
- **Why vendored, not a CDN**: PLAN.md N5 -- the dashboard must keep working without
  outside internet access.
- **sha256** of `mqtt.min.js` as vendored here:
  `75873d04a6400bbbac093b3602caf06f44ed92ee032925e1f4f21c03eba05a4e`

## Licence

MIT. Full text, copied from the package's own `LICENSE.md` (version 5.16.1):

```
The MIT License (MIT)
=====================

Copyright (c) 2015-2016 MQTT.js contributors
---------------------------------------

MQTT.js contributors listed at <https://github.com/mqttjs/MQTT.js#contributors>

Copyright 2011-2014 by Adam Rudd

Permission is hereby granted, free of charge, to any person obtaining a copy of this
software and associated documentation files (the "Software"), to deal in the Software
without restriction, including without limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons
to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

## Updating this vendored copy

1. In a scratch directory **outside** this repo (e.g. `/tmp/...`): `npm pack mqtt@<version>`.
2. Extract the tarball, copy `package/dist/mqtt.min.js` over this file.
3. Update the pinned version, the sha256 (`sha256sum mqtt.min.js`) and the licence text
   above (re-copy `package/LICENSE.md` in case it changed) in this README.
4. Re-run `node --test tests/` and reload the dashboard once to confirm `window.mqtt` is
   still defined and a connection still works.
