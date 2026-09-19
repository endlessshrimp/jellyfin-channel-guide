/*
 * HOMER Ambience — pure logic: nothing here touches the DOM, WebAudio or
 * localStorage, so it runs identically in a browser (as window.HomerAmbientLogic)
 * and under plain Node (ambient/ambient-logic.test.js requires this file
 * directly). ambient-model.js is the only thing that talks to real audio; it
 * requires this module for its math and its preset/asset catalog.
 *
 * What lives here:
 *   - small math: clamp01, a seedable RNG, linear fade, weighted pick
 *   - the sleep timer's state machine (countdown -> fade -> done)
 *   - procedural noise generation (brown/pink/wind), buffers only — no nodes
 *   - the preset catalog (storms, nature, noise) and its asset ids, plus a
 *     validator so a broken catalog fails a test instead of failing quietly
 *     at 1am when Jason is trying to fall asleep
 *
 * window.HomerAmbientLogic = { clamp01, mulberry32, fadeMultiplier, sleepPhase,
 *   randRange, pickWeighted, generateNoiseBuffer, formatMinutes,
 *   SLEEP_MINUTES, DISTANCE_PARAMS, PRESETS, ASSETS, validateCatalog }
 */
(function (root, factory) {
    var mod = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = mod;
    else root.HomerAmbientLogic = mod;
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // ---------- Small math ----------

    var clamp01 = function (v) { return Math.max(0, Math.min(1, v)); };
    var clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };

    // A tiny seedable RNG (mulberry32) so noise generation and scheduling are
    // reproducible in tests. Real playback seeds it from Date.now().
    var mulberry32 = function (seed) {
        var a = seed >>> 0;
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            var t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    };

    var randRange = function (range, rand) {
        if (!range) return 0;
        var lo = range[0], hi = range[1];
        if (hi < lo) { var tmp = lo; lo = hi; hi = tmp; }
        return lo + (rand ? rand() : Math.random()) * (hi - lo);
    };

    // items: [{ weight, value }, ...]. Returns null for an empty/all-zero list.
    var pickWeighted = function (items, rand) {
        var list = (items || []).filter(function (i) { return i && i.weight > 0; });
        if (!list.length) return null;
        var total = list.reduce(function (s, i) { return s + i.weight; }, 0);
        var r = (rand ? rand() : Math.random()) * total;
        for (var i = 0; i < list.length; i++) {
            r -= list[i].weight;
            if (r <= 0) return list[i].value;
        }
        return list[list.length - 1].value;
    };

    // ---------- Fades ----------

    // 1 at elapsed<=0, 0 at elapsed>=total, linear between. total<=0 -> 0
    // (an instant cut rather than a divide-by-zero).
    var fadeMultiplier = function (elapsedMs, totalMs) {
        if (!(totalMs > 0)) return 0;
        return clamp01(1 - elapsedMs / totalMs);
    };

    // The sleep timer: a plain countdown, then a fade over the last `fadeMs`,
    // then done. `state` = { startedAt, totalMs, fadeMs } (ms epoch / ms
    // durations); `now` = ms epoch. Pure function of (state, now) so a test
    // can walk it through time without setTimeout.
    var sleepPhase = function (state, now) {
        if (!state) return { phase: 'off', multiplier: 1, remainingMs: 0 };
        var elapsed = now - state.startedAt;
        var fadeStart = state.totalMs - state.fadeMs;
        if (elapsed < fadeStart) {
            return { phase: 'counting', multiplier: 1, remainingMs: state.totalMs - elapsed };
        }
        if (elapsed < state.totalMs) {
            return {
                phase: 'fading',
                multiplier: fadeMultiplier(elapsed - fadeStart, state.fadeMs),
                remainingMs: state.totalMs - elapsed,
            };
        }
        return { phase: 'done', multiplier: 0, remainingMs: 0 };
    };

    var SLEEP_MINUTES = [15, 30, 45, 60, 90];

    var formatMinutes = function (min) {
        if (min == null) return 'Off';
        if (min === 'chapter') return 'End of chapter';
        return min + ' min';
    };

    // ---------- Procedural noise ----------
    //
    // Each generator fills `frames` samples in [-1, 1], then blends the tail
    // into the head over `seam` samples so an AudioBufferSourceNode with
    // loop=true doesn't click at the wrap. Deterministic given `rand`.

    var crossfadeSeam = function (buf, seam) {
        var frames = buf.length;
        var n = Math.min(seam, Math.floor(frames / 4));
        for (var i = 0; i < n; i++) {
            var t = i / n;
            buf[i] = buf[i] * t + buf[frames - n + i] * (1 - t);
        }
        return buf;
    };

    var genWhite = function (frames, rand) {
        var out = new Float32Array(frames);
        for (var i = 0; i < frames; i++) out[i] = rand() * 2 - 1;
        return out;
    };

    // A leaky integrator over white noise, normalized afterward. Sounds like
    // a fan / distant engine drone (also the base of the "brown noise" preset).
    var genBrown = function (frames, rand) {
        var out = new Float32Array(frames);
        var last = 0;
        var maxAbs = 0.00001;
        for (var i = 0; i < frames; i++) {
            var white = rand() * 2 - 1;
            last = (last + 0.02 * white) / 1.02;
            out[i] = last;
            if (Math.abs(last) > maxAbs) maxAbs = Math.abs(last);
        }
        var scale = 0.9 / maxAbs;
        for (var j = 0; j < frames; j++) out[j] *= scale;
        return out;
    };

    // Paul Kellet's "refined" pink noise filter.
    var genPink = function (frames, rand) {
        var out = new Float32Array(frames);
        var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        var maxAbs = 0.00001;
        for (var i = 0; i < frames; i++) {
            var white = rand() * 2 - 1;
            b0 = 0.99886 * b0 + white * 0.0555179;
            b1 = 0.99332 * b1 + white * 0.0750759;
            b2 = 0.96900 * b2 + white * 0.1538520;
            b3 = 0.86650 * b3 + white * 0.3104856;
            b4 = 0.55000 * b4 + white * 0.5329522;
            b5 = -0.7616 * b5 - white * 0.0168980;
            var pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
            b6 = white * 0.115926;
            out[i] = pink * 0.11;
            if (Math.abs(out[i]) > maxAbs) maxAbs = Math.abs(out[i]);
        }
        var scale = 0.9 / maxAbs;
        for (var j = 0; j < frames; j++) out[j] *= scale;
        return out;
    };

    // frames: buffer length; seam: crossfade length (both in samples).
    var generateNoiseBuffer = function (kind, frames, rand, seam) {
        rand = rand || Math.random;
        seam = seam == null ? Math.round(frames * 0.02) : seam;
        var raw;
        if (kind === 'brown') raw = genBrown(frames, rand);
        else if (kind === 'pink') raw = genPink(frames, rand);
        else raw = genWhite(frames, rand);
        return crossfadeSeam(raw, seam);
    };

    // ---------- Thunder distance ----------
    //
    // A preset's `distanceMix` is the chance a strike lands "distant" rather
    // than "close" (1 = always distant, 0 = always close). The two ends have
    // fixed gain/lowpass/pan-spread so a strike's character is consistent;
    // playback-rate jitter is applied per strike by the caller.

    var DISTANCE_PARAMS = {
        distant: { gain: 0.32, lowpassHz: 900, panSpread: 0.5 },
        close: { gain: 0.85, lowpassHz: 9000, panSpread: 0.25 },
    };
    var pickDistance = function (distanceMix, rand) {
        var mix = clamp01(distanceMix == null ? 0.7 : distanceMix);
        return (rand ? rand() : Math.random()) < mix ? 'distant' : 'close';
    };

    // ---------- Catalog ----------
    //
    // Pure data: which bed(s) and one-shot pool a preset uses, and how often
    // it strikes. Real URLs, licenses and decoded buffers live in
    // ambient-model.js's ASSET_MANIFEST (id -> { file, license, source }) —
    // this file only knows asset *ids*, so it stays testable without ever
    // fetching anything.

    // Real beds (`stream: true`) are several-minutes-long CC0 recordings
    // (256kbps Opus, ~8-17MB each) sourced for HOME-104's follow-up pass —
    // see ~/Media-staging/homer-ambience/README.md for the source table and
    // ~/.claude/projects/-Users-jason/memory/homer-ambience-poc.md. They're
    // *streamed* by ambient-model.js (an <audio> element + createMediaElement
    // Source), never decodeAudioData'd whole into memory: a 9-minute stereo
    // bed decoded to Float32 PCM is ~200MB, and Apple TV's WKWebView budget
    // does not have room for several of those alive at once. `fallback`
    // names the procedural noise kind ambient-model.js should synthesize
    // instead if the real file 404s or the network stalls, so a preset never
    // goes fully silent. One-shots (thunder) stay on decodeAudioData — each
    // is only ~10-25s (a few hundred KB to ~2MB decoded), small enough that
    // decoding is the simpler, correct choice: one-shots need per-strike
    // gain/lowpass/pan processing that only makes sense as a fresh
    // BufferSourceNode per fire.
    var ASSETS = {
        'light-rain': { kind: 'bed', stream: true, fallback: 'pink' },
        'steady-rain': { kind: 'bed', stream: true, fallback: 'pink' },
        'heavy-downpour': { kind: 'bed', stream: true, fallback: 'pink' },
        'rain-on-roof': { kind: 'bed', stream: true, fallback: 'pink' },
        'rain-on-tent': { kind: 'bed', stream: true, fallback: 'pink' },
        'wind-strong': { kind: 'bed', stream: true, fallback: 'brown' },
        'wind-gusty': { kind: 'bed', stream: true, fallback: 'brown' },
        'ocean-gentle': { kind: 'bed', stream: true, fallback: 'brown' },
        'ocean-rough': { kind: 'bed', stream: true, fallback: 'brown' },
        'creek-stream': { kind: 'bed', stream: true, fallback: 'pink' },
        'full-storm': { kind: 'bed', stream: true, fallback: 'pink' },
        'thunder-672776': { kind: 'oneshot' },
        'thunder-338093': { kind: 'oneshot' },
        'thunder-338089': { kind: 'oneshot' },
        'thunder-338088': { kind: 'oneshot' },
        'thunder-338091': { kind: 'oneshot' },
        'thunder-338090': { kind: 'oneshot' },
        'thunder-534023': { kind: 'oneshot' },
        'thunder-458015': { kind: 'oneshot' },
        'thunder-17059': { kind: 'oneshot' },
        'thunder-613276': { kind: 'oneshot' },
        'thunder-581125': { kind: 'oneshot' },
        'thunder-200990': { kind: 'oneshot' },
        'thunder-729539': { kind: 'oneshot' },
        'thunder-347853': { kind: 'oneshot' },
        'thunder-347854': { kind: 'oneshot' },
        'thunder-840628': { kind: 'oneshot' },
        'thunder-328391': { kind: 'oneshot' },
        'thunder-243780': { kind: 'oneshot' },
        'thunder-486557': { kind: 'oneshot' },
        'thunder-393634': { kind: 'oneshot' },
    };

    // The 20-clip thunder pool, grouped by character (per the README's QC
    // pass) so presets can weight "mostly distant rumbles" vs. "mostly close
    // cracks" instead of alternating between two clips like the POC did.
    var THUNDER_CLOSE = ['thunder-672776', 'thunder-338093', 'thunder-338089', 'thunder-338088',
        'thunder-338091', 'thunder-338090', 'thunder-534023', 'thunder-458015', 'thunder-613276', 'thunder-840628'];
    var THUNDER_SHARP = ['thunder-200990', 'thunder-729539', 'thunder-347853', 'thunder-347854'];
    var THUNDER_ROLLING = ['thunder-328391', 'thunder-243780'];
    var THUNDER_DISTANT = ['thunder-581125', 'thunder-486557', 'thunder-393634'];
    var THUNDER_ODD = ['thunder-17059']; // "weird_thunder_clap" — used sparingly, for character

    var poolShots = function (ids, weight) {
        return ids.map(function (id) { return { id: id, weight: weight }; });
    };

    var PRESETS = [
        {
            id: 'summer-distant', label: 'Distant summer storm', group: 'Storms',
            beds: [{ id: 'light-rain', gain: 0.5 }],
            oneShots: poolShots(THUNDER_DISTANT, 3).concat(poolShots(THUNDER_ROLLING, 1)),
            strikeEverySec: [25, 70], distanceMix: 0.9,
        },
        {
            id: 'steady-far', label: 'Steady rain, far rumble', group: 'Storms',
            beds: [{ id: 'steady-rain', gain: 0.8 }],
            oneShots: poolShots(THUNDER_DISTANT, 2).concat(poolShots(THUNDER_ROLLING, 1)),
            strikeEverySec: [45, 100], distanceMix: 1,
        },
        {
            id: 'heavy-close', label: 'Heavy downpour, close strikes', group: 'Storms',
            beds: [{ id: 'heavy-downpour', gain: 1 }],
            oneShots: poolShots(THUNDER_CLOSE, 2).concat(poolShots(THUNDER_SHARP, 2)),
            strikeEverySec: [15, 40], distanceMix: 0.35,
        },
        {
            id: 'roof', label: 'Rain on a roof', group: 'Storms',
            beds: [{ id: 'rain-on-roof', gain: 0.9 }],
            oneShots: poolShots(THUNDER_DISTANT, 2).concat(poolShots(THUNDER_SHARP, 1)),
            strikeEverySec: [60, 130], distanceMix: 1,
        },
        {
            id: 'squall', label: 'Windy squall', group: 'Storms',
            beds: [{ id: 'light-rain', gain: 0.4 }, { id: 'wind-gusty', gain: 0.7, gust: true }],
            oneShots: poolShots(THUNDER_CLOSE, 1).concat(poolShots(THUNDER_SHARP, 2)),
            strikeEverySec: [40, 90], distanceMix: 0.55,
            gustEverySec: [18, 45],
        },
        {
            id: 'real-storm', label: 'Real storm', group: 'Storms',
            beds: [{ id: 'full-storm', gain: 1 }],
            // this take already has real thunder baked in; the pool one-shots
            // fire sparingly here, just to punctuate, not carry the rhythm.
            oneShots: poolShots(THUNDER_CLOSE, 1).concat(poolShots(THUNDER_ODD, 1)),
            strikeEverySec: [100, 210], distanceMix: 0.4,
        },
        { id: 'light-rain', label: 'Light rain', group: 'Nature', beds: [{ id: 'light-rain', gain: 0.6 }] },
        { id: 'tent', label: 'Rain on a tent', group: 'Nature', beds: [{ id: 'rain-on-tent', gain: 0.8 }] },
        { id: 'creek', label: 'Creek / stream', group: 'Nature', beds: [{ id: 'creek-stream', gain: 0.9 }] },
        { id: 'wind-strong', label: 'Strong wind', group: 'Nature', beds: [{ id: 'wind-strong', gain: 0.65 }] },
        { id: 'ocean-gentle', label: 'Ocean waves, gentle', group: 'Nature', beds: [{ id: 'ocean-gentle', gain: 1 }] },
        { id: 'ocean-rough', label: 'Ocean waves, rough', group: 'Nature', beds: [{ id: 'ocean-rough', gain: 1 }] },
        { id: 'brown', label: 'Fan / brown noise', group: 'Noise', noise: 'brown' },
        { id: 'pink', label: 'Pink noise', group: 'Noise', noise: 'pink' },
    ];

    // For a test (and a sanity check at load time in the browser): every
    // asset id a preset references actually exists, storm timing ranges make
    // sense, distanceMix (when present) is 0..1.
    var validateCatalog = function (presets, assets) {
        var problems = [];
        (presets || []).forEach(function (p) {
            if (!p.id || !p.label || !p.group) problems.push('preset missing id/label/group: ' + JSON.stringify(p));
            (p.beds || []).forEach(function (b) {
                if (!assets[b.id]) problems.push(p.id + ': unknown bed asset "' + b.id + '"');
            });
            (p.oneShots || []).forEach(function (o) {
                if (!assets[o.id]) problems.push(p.id + ': unknown one-shot asset "' + o.id + '"');
            });
            if (p.strikeEverySec) {
                var lo = p.strikeEverySec[0], hi = p.strikeEverySec[1];
                if (!(lo > 0) || !(hi >= lo)) problems.push(p.id + ': bad strikeEverySec ' + JSON.stringify(p.strikeEverySec));
            }
            if (p.distanceMix != null && (p.distanceMix < 0 || p.distanceMix > 1)) {
                problems.push(p.id + ': distanceMix out of range ' + p.distanceMix);
            }
            if (!p.beds && !p.noise) problems.push(p.id + ': neither beds nor noise (nothing to play)');
        });
        return problems;
    };

    return {
        clamp01: clamp01,
        clamp: clamp,
        mulberry32: mulberry32,
        randRange: randRange,
        pickWeighted: pickWeighted,
        fadeMultiplier: fadeMultiplier,
        sleepPhase: sleepPhase,
        SLEEP_MINUTES: SLEEP_MINUTES,
        formatMinutes: formatMinutes,
        generateNoiseBuffer: generateNoiseBuffer,
        DISTANCE_PARAMS: DISTANCE_PARAMS,
        pickDistance: pickDistance,
        ASSETS: ASSETS,
        PRESETS: PRESETS,
        validateCatalog: validateCatalog,
        THUNDER_CLOSE: THUNDER_CLOSE,
        THUNDER_SHARP: THUNDER_SHARP,
        THUNDER_ROLLING: THUNDER_ROLLING,
        THUNDER_DISTANT: THUNDER_DISTANT,
        THUNDER_ODD: THUNDER_ODD,
    };
}));
