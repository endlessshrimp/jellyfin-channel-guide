# HOMER as a TV input: the living-room box (plan, not started)

An eventual plan for a small box, plugged into a TV, that boots straight into
HOMER full screen and is driven by the TV's own remote. Nothing here is built
yet; this is what to do when it's time.

## What it should feel like

- Turn on the TV, pick the box's input: HOMER's Home is there, no browser
  chrome, no mouse, no keyboard.
- The TV remote's arrows, OK, Back and Home work HOMER (it's already built for
  ▲▼◀▶ / OK / Esc / H).
- Live TV, the guide, movies and shows, Weather, and Rooms (with the doorbell
  picture-in-picture over whatever's on) all work.
- It survives power cuts and browser crashes on its own.

## Hardware

| | Raspberry Pi 5 (8 GB) | Intel N100 mini PC (recommended) |
|---|---|---|
| Rough cost, all in | ~$100–120 | ~$150–200 |
| HOMER's screens | Fine at 1080p | Fine, with headroom |
| H.264 video (the whole library, since the September re-grab) | Software only (the Pi 5 has no H.264 hardware decoder): OK at 1080p, likely to stutter at 4K | Hardware (Quick Sync, VA-API in Chromium), 4K fine |
| HEVC | Hardware | Hardware |
| TV remote over HDMI (CEC) | Built in | Needs a USB-CEC adapter (Pulse-Eight, ~$40), or use a USB/Bluetooth remote instead |

The N100 is the pick for a library that's mostly H.264 with some 4K. A Pi 5 is
fine if everything it plays is 1080p (or HEVC).

## Software

- **OS:** a minimal Debian 12 (N100) or Raspberry Pi OS Lite (Pi 5), no desktop.
- **Display:** [cage](https://github.com/cage-kiosk/cage), a Wayland compositor that
  runs one app full screen, started by a systemd service that auto-logs in a
  `homer` user.
- **Browser:** Chromium in kiosk mode, pointed at
  `http://192.168.68.100:8096/web/index.html#/home` (the full `index.html`
  address: the bare `/web/` can come from a pre-injector browser cache).
  Flags to start with:
  - `--kiosk --noerrdialogs --disable-infobars --no-first-run`
  - `--autoplay-policy=no-user-gesture-required` (live TV starts without a click)
  - `--password-store=basic` (no keyring prompt)
  - on Intel: `--enable-features=VaapiVideoDecoder,VaapiVideoDecodeLinuxGL` and
    check `chrome://gpu` shows hardware video decode
- **Staying up:** the service restarts Chromium if it exits; a nightly reboot
  (e.g. 4:30 AM) clears memory creep; screen blanking and DPMS off.
- **Audio:** HDMI out through PipeWire. The browser sends decoded PCM (stereo or
  multichannel), not Dolby/DTS passthrough, so a receiver gets PCM. Fine for TV
  speakers and most soundbars.

## The remote

- **CEC (preferred):** `libcec`'s `cec-client` reads the TV remote's buttons
  over HDMI; a small service maps them to key presses through `uinput`:
  arrows → arrow keys, Select → Enter, Back/Return → Escape, Home/Menu → H,
  Play/Pause → Space, FF/Rew → ◀▶ where useful. Some TVs only pass some
  buttons over CEC; check which ones yours sends.
- **Fallback:** a small USB or Bluetooth "air remote" that sends arrows,
  Enter and Esc as a keyboard. It works with anything, no CEC needed.

## One-time setup on the box

- Sign in to Jellyfin once. The browser profile keeps it.
- Connect Home Assistant once (Settings → Home Assistant). Its login page needs
  typing, so plug in a keyboard for that step, or use an air remote with a keyboard.
- Weather: set the ZIP in Settings (browser location needs HTTPS; the box uses
  the local http address).

## HOMER changes this might need

- A "TV box" flag (e.g. a query parameter on the kiosk URL) so HOMER can:
  - hide the mouse cursor for good
  - never show phone layouts, whatever the window reports
  - map Play/Pause and other media keys the CEC service sends
- Possibly an idle/screensaver mode (dim to the clock and weather after a while).
- A quick check that no stock Jellyfin page can strand the remote (the safety
  net sends unknown routes Home already).

## Test list when it's built

- Cold boot to HOMER with no input; power cut and back.
- Every remote button from the TV remote.
- Live TV: tune, the guide, dock and full screen, Back, and the auto-stop
  behavior (a box isn't a pocketed phone, so it shouldn't stop live TV).
- 1080p and 4K H.264 movies, an HEVC file, and a recording.
- Rooms: lights, the thermostat, cameras, the L panel over video, a real
  doorbell ring.
- A week of uptime: memory, the nightly reboot, and CPU temperature.

## Open questions for when it starts

- Which TV (CEC button support varies by brand), and is there an AV receiver?
- N100 or Pi 5?
- One box, or one per TV?
