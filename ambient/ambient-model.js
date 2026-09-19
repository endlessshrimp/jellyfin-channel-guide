/*
 * HOMER Ambience (HOME-104 spike): background sound — a storm/nature/noise
 * preset, or a radio station — playing under a book (and, best-effort, music)
 * without pausing it. Built as an explicit, Jason-approved exception to the
 * current feature freeze; the goal is "good enough to try tomorrow," not a
 * finished feature — see ~/.claude/projects/-Users-jason/memory/homer-ambience-poc.md
 * for the write-up this ships with.
 *
 * ---------- Can two things play sound at once here? ----------
 *
 * Books already runs its own <audio id="homer-books-audio">, completely
 * separate from Music's <audio id="homer-music-audio"> (music/music-model.js)
 * — two independent HTMLMediaElements have coexisted in HOMER since Music
 * shipped, and neither pauses the other today (each only watches
 * HomerPlayer, HOMER's *video* docking, and pauses for a video, not for each
 * other). So "can a book and something else make sound at the same time" was
 * already true; the open question was whether a *third* concurrent source
 * (ambience) hits a real platform limit, particularly in tvOS/iOS WebKit,
 * which has historically been stingier about concurrent audio than desktop
 * Safari/Chrome.
 *
 * What's actually true (researched, not just assumed): iOS/tvOS WebKit's
 * well-documented restriction is on *starting* audio without a user gesture
 * (autoplay), and on video elements specifically wanting to go fullscreen
 * natively (irrelevant here — everything in this file is audio-only,
 * `playsinline`-equivalent by construction). There is no current, general
 * WebKit restriction on the number of *simultaneously playing* <audio>
 * elements or AudioContexts once each has been started from a real gesture —
 * this is how web-based DJ/mixer/soundboard apps work on iOS at all. Where
 * WebKit *has* had real, cited limits is the total number of *decoded* media
 * elements/AudioContexts alive at once on very old iOS versions (a handful,
 * not "one"), which this design respects by keeping the ambience engine to a
 * small, fixed node count and by never creating more than one AudioContext.
 * I could not test this on Jason's actual sideloaded tvOS wrapper (automated
 * tabs can't play audio at all — see the repo's traps doc), so this is
 * still **unverified on the real device** and is the single most important
 * thing to confirm tomorrow. If tvOS WebKit turns out to duck/pause one
 * layer when the other starts, the fallback already exists in this file's
 * shape: the "engine" (noise/storm/nature) path already mixes everything
 * through one shared AudioContext + one destination, so if the *book* layer
 * ever needs pulling into the same graph to avoid a two-media-element
 * problem, only `attachForeground()` below needs writing — the mixing graph
 * it would feed into already exists.
 *
 * ---------- The engine ----------
 *
 * One shared AudioContext, one masterGain -> destination. A "preset" (storm/
 * nature/noise) is: 0+ looping bed buffers (real recordings, decoded once and
 * cached, or procedurally generated noise when there's no asset) each on its
 * own BufferSourceNode+GainNode, plus 0+ one-shot buffers (thunder) fired on
 * a randomized schedule (shared/ambient-logic.js's pickWeighted/randRange) at
 * a random distance (gain + lowpass + pan per DISTANCE_PARAMS) so repeats
 * don't sound identical. Radio is NOT routed through this graph — it's a
 * second, independent <audio> element (reusing music/radio-model.js's
 * playUrl/tune plumbing), because streaming stations don't need mixing, only
 * their own volume. Exactly one ambience source plays at a time (Jason's
 * call: a storm preset and a radio station never mix together) — starting
 * one stops the other.
 *
 * ---------- Assets ----------
 *
 * The real, several-minutes, 256kbps Opus assets sourced in HOME-104's
 * follow-up pass (11 beds + a 20-clip thunder pool — see
 * ~/Media-staging/homer-ambience/README.md for the source table and QC
 * flags) are hosted on the NAS, served by the HOMER app's own Caddy at
 * :8097/ambient/ — too big for this git repo (the injector ships via
 * jsDelivr off this repo, see homer.js's header). `baseUrl()` below defaults
 * to that host and is still overridable (localStorage.homer-ambient-base, or
 * setBaseUrl()) for testing against a different one. `ambient/assets/` still
 * has the original 4 tiny POC samples bundled in-repo, unused by the current
 * catalog now that every preset points at a real file — left in place rather
 * than deleted, since removing them wasn't asked and they cost nothing.
 *
 * Real beds are *streamed*, not decodeAudioData'd — see streamedBedNode()
 * below for why (Apple TV memory).
 *
 * window.HomerAmbientModel = { presets, radioSources, current, start, stop,
 *   setAmbientVolume, setForegroundVolume, setSleep, sleepOptions, baseUrl,
 *   setBaseUrl, lastChoice, onChange, destroy, version }
 */
(() => {
    const VERSION = '0.1.0';

    if (window.HomerAmbientModel && typeof window.HomerAmbientModel.destroy === 'function') {
        window.HomerAmbientModel.destroy();
    }

    const L = window.HomerAmbientLogic;
    if (!L) { console.error('[HOMER Ambience] ambient-logic.js must load first'); return; }

    const warn = (...a) => console.warn('[HOMER Ambience]', ...a);

    // The real, several-minutes-long delivery files (HOME-104 follow-up
    // pass) are too big to ship in this git repo (the injector goes out via
    // jsDelivr off this repo — see homer.js's header) so they're hosted on
    // the NAS instead, served by the HOMER app's own Caddy at :8097. Still
    // overridable (localStorage.homer-ambient-base, or setBaseUrl()) for
    // testing against a different host.
    const DEFAULT_BASE = 'http://192.168.68.100:8097/ambient/';
    const BASE_KEY = 'homer-ambient-base'; // an override for testing a different host
    const AMB_VOL_KEY = 'homer-ambient-volume';
    const LAST_KEY = 'homer-ambient-last';
    const FADE_MS = 30000;
    const LOOP_SECONDS = 8; // procedural noise buffer length before it repeats

    const store = {
        get(k, fb) { try { const v = localStorage.getItem(k); return v == null ? fb : JSON.parse(v); } catch { return fb; } },
        set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full or blocked */ } },
    };

    const baseUrl = () => {
        try {
            const o = localStorage.getItem(BASE_KEY);
            if (o) return o.replace(/\/?$/, '/');
        } catch { /* blocked */ }
        return DEFAULT_BASE;
    };
    const setBaseUrl = (url) => {
        try {
            if (url) localStorage.setItem(BASE_KEY, url);
            else localStorage.removeItem(BASE_KEY);
        } catch { /* blocked */ }
        bufferCache.clear(); // re-fetch from the new base next time something plays
    };

    // Filenames match ~/Media-staging/homer-ambience/README.md's delivery
    // set exactly (256kbps Opus): beds are `<id>-<freesound-id>.opus`, the
    // thunder pool is `<id>.opus` since the id already carries the
    // freesound id (thunder-338093.opus, etc).
    const ASSET_FILES = {
        'light-rain': 'light-rain-592482.opus',
        'steady-rain': 'steady-rain-723101.opus',
        'heavy-downpour': 'heavy-downpour-705730.opus',
        'rain-on-roof': 'rain-on-roof-577507.opus',
        'rain-on-tent': 'rain-on-tent-592997.opus',
        'wind-strong': 'wind-strong-754911.opus',
        'wind-gusty': 'wind-gusty-331222.opus',
        'ocean-gentle': 'ocean-gentle-417797.opus',
        'ocean-rough': 'ocean-rough-867645.opus',
        'creek-stream': 'creek-stream-592995.opus',
        'full-storm': 'full-storm-278866.opus',
        'thunder-672776': 'thunder-672776.opus',
        'thunder-338093': 'thunder-338093.opus',
        'thunder-338089': 'thunder-338089.opus',
        'thunder-338088': 'thunder-338088.opus',
        'thunder-338091': 'thunder-338091.opus',
        'thunder-338090': 'thunder-338090.opus',
        'thunder-534023': 'thunder-534023.opus',
        'thunder-458015': 'thunder-458015.opus',
        'thunder-17059': 'thunder-17059.opus',
        'thunder-613276': 'thunder-613276.opus',
        'thunder-581125': 'thunder-581125.opus',
        'thunder-200990': 'thunder-200990.opus',
        'thunder-729539': 'thunder-729539.opus',
        'thunder-347853': 'thunder-347853.opus',
        'thunder-347854': 'thunder-347854.opus',
        'thunder-840628': 'thunder-840628.opus',
        'thunder-328391': 'thunder-328391.opus',
        'thunder-243780': 'thunder-243780.opus',
        'thunder-486557': 'thunder-486557.opus',
        'thunder-393634': 'thunder-393634.opus',
    };

    // ---------- Web Audio ----------

    let ctx = null;
    const ensureCtx = () => {
        if (!ctx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            ctx = new AC();
        }
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        return ctx;
    };

    const bufferCache = new Map(); // asset id -> Promise<AudioBuffer|null>
    const loadBuffer = (id) => {
        if (bufferCache.has(id)) return bufferCache.get(id);
        const file = ASSET_FILES[id];
        const c = ensureCtx();
        const job = !file ? Promise.resolve(null) : fetch(baseUrl() + file)
            .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('HTTP ' + r.status))))
            .then((ab) => new Promise((resolve, reject) => {
                // decodeAudioData has both a Promise form and an old two-callback
                // form; the callback form is what's left in some WebKit builds.
                const p = c.decodeAudioData(ab, resolve, reject);
                if (p && typeof p.then === 'function') p.then(resolve, reject);
            }))
            .catch((err) => { warn('asset', id, (err && err.message) || err); return null; });
        bufferCache.set(id, job);
        return job;
    };

    // A deterministic-enough seed per id, so repeated runs of the same
    // preset in a session don't regenerate identical noise (real randomness
    // is fine at runtime; the logic module's seeded RNG is what tests use).
    let seedCounter = (Date.now() % 1e6) >>> 0;
    const nextSeed = () => (seedCounter = (seedCounter + 0x9e3779b9) >>> 0);

    const noiseBuffer = (kind, seconds) => {
        const c = ensureCtx();
        const frames = Math.round(c.sampleRate * (seconds || LOOP_SECONDS));
        const data = L.generateNoiseBuffer(kind, frames, L.mulberry32(nextSeed()));
        const buf = c.createBuffer(1, frames, c.sampleRate);
        buf.getChannelData(0).set(data);
        return buf;
    };

    // ---------- The engine: one preset playing at a time ----------

    let engine = null; // { masterGain, nodes: [], timers: [], degraded: bool, preset }
    const stopEngine = () => {
        if (!engine) return;
        engine.timers.forEach(clearTimeout);
        engine.nodes.forEach((n) => {
            if (n instanceof HTMLMediaElement) {
                try { n.pause(); } catch { /* already stopped */ }
                try { n.removeAttribute('src'); n.load(); } catch { /* fine */ }
                try { n.remove(); } catch { /* already gone */ }
                return;
            }
            try { n.stop && n.stop(); } catch { /* already stopped */ } try { n.disconnect(); } catch { /* already gone */ }
        });
        try { engine.masterGain.disconnect(); } catch { /* gone */ }
        engine = null;
    };

    // A short window to hear back from a streamed bed before giving up and
    // falling back to procedural noise (a stalled LAN request shouldn't hang
    // preset startup indefinitely).
    const STREAM_READY_TIMEOUT_MS = 8000;

    // Real beds (light rain, full storm, etc) are several minutes long —
    // decodeAudioData-ing one whole into memory is ~200MB of Float32 PCM for
    // a 9-minute stereo bed, which is a real risk on Apple TV's WKWebView
    // memory budget. Instead, stream via a plain <audio> element routed into
    // the Web Audio graph with createMediaElementSource: the browser decodes
    // incrementally as it plays, nothing is held as one big buffer. This
    // requires the file to be served with CORS (the HOMER app's Caddy sends
    // Access-Control-Allow-Origin for :8096) and `el.crossOrigin` set, or
    // WebKit taints the node and it plays silently through Web Audio.
    const streamedBedNode = (bed, asset, masterGain) => new Promise((resolve) => {
        const file = ASSET_FILES[bed.id];
        const fallback = () => resolve(proceduralBedNode(bed, asset, masterGain, true));
        if (!file) { fallback(); return; }
        const el = document.createElement('audio');
        el.crossOrigin = 'anonymous';
        el.loop = true;
        el.preload = 'auto';
        el.style.display = 'none';
        let settled = false;
        const timeout = setTimeout(() => { if (!settled) { settled = true; try { el.remove(); } catch { /* fine */ } fallback(); } }, STREAM_READY_TIMEOUT_MS);
        const onError = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            warn('bed stream', bed.id, el.error && el.error.message);
            try { el.remove(); } catch { /* fine */ }
            fallback();
        };
        const onReady = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            try { if (el.duration > 1 && isFinite(el.duration)) el.currentTime = Math.random() * el.duration; } catch { /* seek not ready yet, fine */ }
            document.body.appendChild(el);
            const src = ctx.createMediaElementSource(el);
            let tail = src;
            const nodes = [el, src];
            if (bed.bandpass) {
                const f = ctx.createBiquadFilter();
                f.type = 'bandpass';
                const [lo, hi] = bed.bandpass;
                f.frequency.value = Math.sqrt(lo * hi);
                f.Q.value = f.frequency.value / Math.max(1, hi - lo);
                tail.connect(f);
                tail = f;
                nodes.push(f);
            }
            const gain = ctx.createGain();
            gain.gain.value = bed.gain != null ? bed.gain : 1;
            tail.connect(gain);
            gain.connect(masterGain);
            nodes.push(gain);
            el.play().catch((err) => { if (err && err.name !== 'AbortError') warn('bed play', bed.id, err.message); });
            resolve({ nodes, degraded: false, gustGain: bed.gust ? gain : null });
        };
        el.addEventListener('loadedmetadata', onReady, { once: true });
        el.addEventListener('error', onError, { once: true });
        el.src = baseUrl() + file;
        el.load();
    });

    // No file (shouldn't happen — validateCatalog checks this), or a
    // streamed bed's fetch/network failed: fall back to shaped procedural
    // noise so the preset still makes *a* sound instead of going silent.
    const proceduralBedNode = (bed, asset, masterGain, degraded) => {
        const kind = (asset && asset.fallback) || 'pink';
        const buffer = noiseBuffer(kind);
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        let tail = src;
        const nodes = [];
        if (bed.bandpass) {
            const f = ctx.createBiquadFilter();
            f.type = 'bandpass';
            const [lo, hi] = bed.bandpass;
            f.frequency.value = Math.sqrt(lo * hi);
            f.Q.value = f.frequency.value / Math.max(1, hi - lo);
            tail.connect(f);
            tail = f;
            nodes.push(f);
        }
        const gain = ctx.createGain();
        gain.gain.value = bed.gain != null ? bed.gain : 1;
        tail.connect(gain);
        gain.connect(masterGain);
        src.start(0, buffer.duration > 1 ? Math.random() * buffer.duration : 0);
        nodes.push(src, gain);
        return { nodes, degraded: !!degraded, gustGain: bed.gust ? gain : null };
    };

    const bedNode = (bed, masterGain) => {
        const asset = L.ASSETS[bed.id];
        if (asset && asset.stream) return streamedBedNode(bed, asset, masterGain);
        // no real asset for this id (shouldn't happen for current presets —
        // every bed the catalog ships is a real streamed file) — straight to
        // procedural noise.
        return Promise.resolve(proceduralBedNode(bed, asset, masterGain, false));
    };

    const scheduleOneShots = (preset, masterGain, timers) => {
        const weighted = (preset.oneShots || []).map((o) => ({ weight: o.weight, value: o.id }));
        if (!weighted.length) return;
        const fire = async () => {
            if (!engine) return;
            const id = L.pickWeighted(weighted, Math.random);
            const buf = id && await loadBuffer(id);
            if (buf && engine) {
                const dist = L.pickDistance(preset.distanceMix, Math.random);
                const p = L.DISTANCE_PARAMS[dist];
                const src = ctx.createBufferSource();
                src.buffer = buf;
                src.playbackRate.value = 1 + (Math.random() * 0.16 - 0.08);
                const lp = ctx.createBiquadFilter();
                lp.type = 'lowpass';
                lp.frequency.value = p.lowpassHz;
                const gain = ctx.createGain();
                gain.gain.value = p.gain;
                const pan = (ctx.createStereoPanner && ctx.createStereoPanner()) || null;
                if (pan) pan.pan.value = (Math.random() * 2 - 1) * p.panSpread;
                src.connect(lp);
                lp.connect(gain);
                (pan ? (gain.connect(pan), pan.connect(masterGain)) : gain.connect(masterGain));
                src.start();
                engine.nodes.push(src, lp, gain, ...(pan ? [pan] : []));
                src.onended = () => { try { src.disconnect(); lp.disconnect(); gain.disconnect(); pan && pan.disconnect(); } catch { /* already torn down */ } };
            }
            if (!engine) return;
            const t = setTimeout(fire, L.randRange(preset.strikeEverySec, Math.random) * 1000);
            timers.push(t);
        };
        const t = setTimeout(fire, L.randRange(preset.strikeEverySec, Math.random) * 1000);
        timers.push(t);
    };

    const scheduleGusts = (preset, gustGains, timers) => {
        if (!preset.gustEverySec || !gustGains.length) return;
        const gust = () => {
            if (!engine) return;
            const now = ctx.currentTime;
            gustGains.forEach((g) => {
                const base = g.gain.value;
                const peak = Math.min(1.6, base * 1.7);
                const up = 1.5 + Math.random() * 1.5;
                const down = 2 + Math.random() * 2;
                g.gain.cancelScheduledValues(now);
                g.gain.setValueAtTime(base, now);
                g.gain.linearRampToValueAtTime(peak, now + up);
                g.gain.linearRampToValueAtTime(base, now + up + down);
            });
            if (!engine) return;
            const t = setTimeout(gust, L.randRange(preset.gustEverySec, Math.random) * 1000);
            timers.push(t);
        };
        const t = setTimeout(gust, L.randRange(preset.gustEverySec, Math.random) * 1000);
        timers.push(t);
    };

    const startPreset = async (presetId) => {
        const preset = L.PRESETS.find((p) => p.id === presetId);
        if (!preset) return false;
        stopRadio();
        stopEngine();
        const c = ensureCtx();
        const masterGain = c.createGain();
        masterGain.gain.value = ambientVolume;
        masterGain.connect(c.destination);
        engine = { masterGain, nodes: [], timers: [], degraded: false, preset };
        if (preset.noise) {
            const buf = noiseBuffer(preset.noise);
            const src = c.createBufferSource();
            src.buffer = buf;
            src.loop = true;
            src.connect(masterGain);
            src.start();
            engine.nodes.push(src);
        } else {
            const gustGains = [];
            for (const bed of preset.beds || []) {
                const { nodes, degraded, gustGain } = await bedNode(bed, masterGain);
                if (!engine) return true; // stopped while awaiting a decode
                engine.nodes.push(...nodes);
                engine.degraded = engine.degraded || degraded;
                if (bed.gust && gustGain) gustGains.push(gustGain);
            }
            scheduleOneShots(preset, masterGain, engine.timers);
            scheduleGusts(preset, gustGains, engine.timers);
        }
        store.set(LAST_KEY, { kind: 'preset', id: presetId });
        emit('change');
        return true;
    };

    // ---------- Radio (a plain second <audio>, not routed through Web Audio) ----------

    let radioAudio = null;
    let radioStation = null;
    const ensureRadioAudio = () => {
        if (radioAudio) return radioAudio;
        radioAudio = document.createElement('audio');
        radioAudio.id = 'homer-ambient-radio-audio';
        radioAudio.preload = 'auto';
        radioAudio.style.display = 'none';
        radioAudio.volume = ambientVolume;
        radioAudio.addEventListener('error', () => {
            warn('radio', radioAudio.error && radioAudio.error.message);
            emit('change');
        });
        document.body.appendChild(radioAudio);
        return radioAudio;
    };
    const stopRadio = () => {
        if (!radioAudio) return;
        radioAudio.pause();
        radioAudio.removeAttribute('src');
        try { radioAudio.load(); } catch { /* fine */ }
        radioStation = null;
    };
    const startRadio = async (station) => {
        const RM = window.HomerRadioModel;
        if (!RM || !station) return false;
        stopEngine();
        stopRadio();
        const track = await RM.tune(station);
        if (!track || !track.streamUrl) {
            warn('radio', 'no playable address for', station.name);
            emit('change');
            return false;
        }
        const a = ensureRadioAudio();
        radioStation = station;
        a.src = track.streamUrl;
        a.volume = ambientVolume;
        a.load();
        try { await a.play(); } catch (err) {
            if (err && err.name !== 'AbortError') warn('radio play', err.message);
        }
        store.set(LAST_KEY, { kind: 'radio', id: station.id });
        emit('change');
        return true;
    };

    // ---------- Volumes ----------

    let ambientVolume = Math.max(0, Math.min(1, +(store.get(AMB_VOL_KEY, 0.6))));
    if (!isFinite(ambientVolume)) ambientVolume = 0.6;

    const setAmbientVolume = (v) => {
        ambientVolume = Math.max(0, Math.min(1, v));
        store.set(AMB_VOL_KEY, ambientVolume);
        if (engine) engine.masterGain.gain.value = ambientVolume;
        if (radioAudio) radioAudio.volume = ambientVolume;
        emit('change');
    };

    // Which player is "the book" right now: books first (this feature's main
    // reason to exist), music second (Jason's "ideally" — this spike wires it
    // up too, just less tested). Neither model needs to change for this;
    // books-model.js gained setVolume()/state().volume for HOME-104, music
    // already had both.
    const foreground = () => {
        const bp = window.HomerBooksModel && window.HomerBooksModel.player;
        if (bp && typeof bp.setVolume === 'function') {
            if (bp.state().book) return { kind: 'books', api: bp };
        }
        const mp = window.HomerMusicModel && window.HomerMusicModel.player;
        if (mp && mp.state().track) return { kind: 'music', api: mp };
        if (bp && typeof bp.setVolume === 'function') return { kind: 'books', api: bp, idle: true };
        if (mp) return { kind: 'music', api: mp, idle: true };
        return null;
    };
    const setForegroundVolume = (v) => {
        const fg = foreground();
        if (fg) fg.api.setVolume(Math.max(0, Math.min(1, v)));
        emit('change');
    };

    // ---------- Sleep timer: fades both layers over FADE_MS, then stops both ----------

    let sleep = null; // { mode: minutes|'chapter', startedAt, totalMs, fadeMs } (minutes mode only uses totalMs/fadeMs)
    let sleepTimer = null;
    let fgVolumeAtSleepStart = null;

    const applyFade = (multiplier) => {
        if (engine) engine.masterGain.gain.value = ambientVolume * multiplier;
        if (radioAudio && radioStation) radioAudio.volume = ambientVolume * multiplier;
        // .audio is a getter that *creates* the element on first touch (books/
        // music both do this) — only reach for it when something real is
        // loaded, so a sleep timer set with nothing playing doesn't spawn an
        // empty <audio> tag as a side effect.
        const fg = foreground();
        if (fg && !fg.idle && fgVolumeAtSleepStart != null) fg.api.audio.volume = fgVolumeAtSleepStart * multiplier;
    };
    const finishSleep = () => {
        applyFade(0);
        stopEngine();
        stopRadio();
        const fg = foreground();
        if (fg) {
            try { fg.api.pause(); } catch { /* nothing to pause */ }
            // undo the temporary fade: the *persisted* preference was never
            // touched, so this just puts the live element back to it
            if (!fg.idle && fgVolumeAtSleepStart != null) fg.api.audio.volume = fgVolumeAtSleepStart;
        }
        sleep = null;
        fgVolumeAtSleepStart = null;
        clearInterval(sleepTimer);
        sleepTimer = null;
        emit('change');
    };
    const tickSleep = () => {
        if (!sleep) return;
        if (sleep.mode === 'chapter') {
            const fg = foreground();
            const b = fg && fg.kind === 'books' && fg.api.state().book;
            const at = b && window.HomerBooksModel.chapterAt(b, fg.api.state().position);
            if (!at) { finishSleep(); return; }
            const leftMs = at.left * 1000;
            if (leftMs <= 0) { finishSleep(); return; }
            const mult = leftMs <= FADE_MS ? L.fadeMultiplier(FADE_MS - leftMs, FADE_MS) : 1;
            applyFade(mult);
            emit('change');
            return;
        }
        const phase = L.sleepPhase(sleep, Date.now());
        if (phase.phase === 'done') { finishSleep(); return; }
        applyFade(phase.multiplier);
        emit('change');
    };
    const setSleep = (mode) => {
        clearInterval(sleepTimer);
        sleepTimer = null;
        sleep = null;
        fgVolumeAtSleepStart = null;
        if (mode) {
            const fg = foreground();
            fgVolumeAtSleepStart = fg ? fg.api.state().volume : 1;
            sleep = mode === 'chapter'
                ? { mode: 'chapter' }
                : { mode, startedAt: Date.now(), totalMs: mode * 60000, fadeMs: FADE_MS };
            sleepTimer = setInterval(tickSleep, 1000);
        }
        emit('change');
    };

    // ---------- Casting hint ----------
    // Best-effort: true when HOMER last sent music/radio to a Home Assistant
    // speaker and hasn't been told otherwise. Not a live "is it still
    // actually playing there" check (playon.js doesn't expose one) — a
    // deliberate approximation for this spike, documented in the report.
    const casting = () => {
        try {
            const po = window.HomerPlayOn;
            if (po && typeof po.current === 'function' && po.current()) return true;
        } catch { /* fine */ }
        return false;
    };

    // ---------- Public state ----------

    const listeners = new Set();
    const emit = (what) => listeners.forEach((fn) => {
        try { fn(what); } catch (err) { console.error('[HOMER Ambience]', err); }
    });

    const grouped = () => {
        const by = {};
        L.PRESETS.forEach((p) => { (by[p.group] = by[p.group] || []).push({ kind: 'preset', id: p.id, label: p.label, group: p.group }); });
        return by;
    };

    // Local stations + favorites + a handful of SomaFM, deduped — enough to
    // pick from without rebuilding Radio's full browse/search UI here.
    const radioSources = () => {
        const RM = window.HomerRadioModel;
        if (!RM) return [];
        const seen = new Set();
        const out = [];
        const add = (st, group) => {
            if (!st || !st.id || seen.has(st.id)) return;
            seen.add(st.id);
            out.push({ kind: 'radio', id: st.id, label: st.name, sub: st.sub || '', group, station: st });
        };
        (RM.local() || []).forEach((st) => add(st, 'Local'));
        (RM.favorites() || []).forEach((st) => add(st, 'Favorites'));
        (RM.soma() || []).slice(0, 10).forEach((st) => add(st, 'SomaFM'));
        return out;
    };

    const current = () => {
        const fg = foreground();
        const active = !!(engine || (radioAudio && radioStation && !radioAudio.paused));
        return {
            active,
            sourceKind: engine ? 'preset' : radioStation ? 'radio' : null,
            sourceId: engine ? engine.preset.id : radioStation ? radioStation.id : null,
            sourceLabel: engine ? engine.preset.label : radioStation ? radioStation.name : '',
            degraded: !!(engine && engine.degraded),
            ambientVolume,
            foregroundKind: fg ? fg.kind : null,
            foregroundVolume: fg ? fg.api.state().volume : null,
            foregroundIdle: !!(fg && fg.idle),
            sleep: sleep ? {
                mode: sleep.mode,
                label: L.formatMinutes(sleep.mode),
                remainingMs: sleep.mode === 'chapter' ? null : L.sleepPhase(sleep, Date.now()).remainingMs,
            } : null,
            casting: casting(),
            audioContextState: ctx ? ctx.state : 'none',
        };
    };

    const start = (ref) => {
        if (!ref) return Promise.resolve(false);
        if (ref.kind === 'radio') return startRadio(ref.station || (window.HomerRadioModel && window.HomerRadioModel.station(ref.id)));
        return startPreset(ref.id);
    };
    const stop = () => {
        stopEngine();
        stopRadio();
        setSleep(null);
        emit('change');
    };

    window.HomerAmbientModel = {
        version: VERSION,
        presets: grouped,
        radioSources,
        current,
        start,
        stop,
        setAmbientVolume,
        setForegroundVolume,
        setSleep,
        sleepOptions: () => L.SLEEP_MINUTES.slice(),
        baseUrl,
        setBaseUrl,
        lastChoice: () => store.get(LAST_KEY, null),
        onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        // tests / diagnostics: never used for real playback decisions
        _debug: () => ({
            hasContext: !!ctx,
            contextState: ctx ? ctx.state : null,
            nodeCount: engine ? engine.nodes.length : 0,
            radioSrc: radioAudio ? radioAudio.src : '',
        }),
        destroy() {
            stopEngine();
            stopRadio();
            clearInterval(sleepTimer);
            listeners.clear();
            bufferCache.clear();
            if (radioAudio) { radioAudio.remove(); radioAudio = null; }
            if (ctx) { try { ctx.close(); } catch { /* already closing */ } ctx = null; }
        },
    };
})();
