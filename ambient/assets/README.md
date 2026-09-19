# Ambience assets (HOME-104 spike)

Small POC samples only — good enough to prove the generative engine tonight.
**Not final quality.** Jason asked for "highest quality that will make a
difference," several-minutes-long seamless beds, and more variety (wind,
creek, rain-heavy/roof, more thunder character) than one evening of CC0
hunting turned up. Treat everything below as a placeholder for a proper
sourcing/recording pass, hosted on the NAS once done (see the main
ambient-model.js header for the plan).

| File | Source | License | Duration | Size | Used as |
|---|---|---|---|---|---|
| `rain.ogg` | [Wikimedia Commons, File:Rain.ogg](https://commons.wikimedia.org/wiki/File:Rain.ogg) — direct: `upload.wikimedia.org/wikipedia/commons/3/3d/Rain.ogg` | Public domain (uploader's own PD-self release) | 10 s | 194 KB | the `rain` bed, every storm preset |
| `thunder-a.mp3` | [Freesound 661233, "Severe Lightning & Thunder" by dbache](https://freesound.org/people/dbache/sounds/661233/) — direct (CDN preview render): `cdn.freesound.org/previews/661/661233_2290525-hq.mp3` | CC0 | 14.0 s | 316 KB | `thunder-a` one-shot — the bigger/closer-sounding crack |
| `thunder-b.mp3` | [Freesound 193170, "thunder" by netaj](https://freesound.org/people/netaj/sounds/193170/) — direct (CDN preview render): `cdn.freesound.org/previews/193/193170_3012047-hq.mp3` | CC0 | 6.2 s | 143 KB | `thunder-b` one-shot — the shorter/plainer crack |
| `ocean.mp3` | [Freesound 531015, "Ocean Waves.wav" by Noted451](https://freesound.org/people/Noted451/sounds/531015/) — direct (CDN preview render): `cdn.freesound.org/previews/531/531015_9818404-hq.mp3` | CC0 | 70.9 s | 1.56 MB | the `ocean` bed |

The Freesound "direct" URLs are Freesound's own CDN-hosted **preview** render
(mp3, not the original upload), which is what's fetchable without an API
key/login — the original WAVs need OAuth. Good enough for a POC; worth
getting the original files (or better, purpose-recorded/curated loops) for
real.

**Not sourced this pass, and currently faked or missing:**
- **Wind** — no CC0 wind-loop was found in the time budgeted. `ambient-model.js`
  synthesizes a placeholder (filtered/modulated noise) for the "Windy squall"
  preset instead of using a recording. Replace with a real recording later.
- **Creek** — not sourced at all; not offered as a preset yet.
- **Rain variety** (heavy downpour, on a roof/tent/leaves, distinct from
  drizzle) — only one generic rain bed exists. The five storm presets reuse
  it at different gain/pace/filtering rather than using distinct recordings.
  This is the single biggest quality gap vs. what Jason asked for.
- **More thunder character** (rolling/distant vs. sharp/close as truly
  different recordings, not just live gain/lowpass on the same two clips).

**Backups found but not used** (swap in if one of the above breaks or a
better option is wanted), all confirmed CC0/PD, all confirmed to resolve:
- Rain: Freesound 723703 "rain sound loop no thunder" by orb1t (CC0, 27.9 s,
  ~625 KB) — `cdn.freesound.org/previews/723/723703_11734604-hq.mp3`
- Thunder: same two used above were already the best CC0 hits found;
  Wikimedia's thunder files are all CC-BY/CC-BY-SA (attribution required),
  so excluded on purpose.
- Ocean: Freesound 376795 "Gentle Waves - Quiet Beach" by amholma (CC0,
  100.7 s; lq variant ~825 KB) — `cdn.freesound.org/previews/376/376795_6128004-lq.mp3`.
  Wikimedia's `Waves.ogg` is genuine public domain but 4:47 / 17.4 MB — too
  big for this pass, worth revisiting once files move to NAS hosting (see
  the report for the hosting plan).

None of these are checked into `homer.js`'s jsDelivr bundle path in spirit —
see `ambient-model.js`'s header comment for why these should move to
NAS-hosted static files instead of shipping in the injector's git repo
long-term.
