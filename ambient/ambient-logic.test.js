#!/usr/bin/env node
/*
 * Plain-Node tests for ambient/ambient-logic.js — the pure math/state-machine
 * part of HOME-104's ambience spike. No framework (this repo has none): just
 * assert, run top to bottom, exit nonzero on the first failure.
 *
 *   node ambient/ambient-logic.test.js
 */
'use strict';
const assert = require('assert');
const L = require('./ambient-logic.js');

let pass = 0;
const test = (name, fn) => {
    try {
        fn();
        pass++;
    } catch (err) {
        console.error('FAIL:', name);
        console.error(err);
        process.exitCode = 1;
    }
};

// ---------- clamp01 ----------

test('clamp01 clamps both directions', () => {
    assert.strictEqual(L.clamp01(-1), 0);
    assert.strictEqual(L.clamp01(2), 1);
    assert.strictEqual(L.clamp01(0.42), 0.42);
});

// ---------- mulberry32 ----------

test('mulberry32 is deterministic and in [0,1)', () => {
    const a = L.mulberry32(42);
    const b = L.mulberry32(42);
    for (let i = 0; i < 20; i++) {
        const x = a();
        const y = b();
        assert.strictEqual(x, y);
        assert.ok(x >= 0 && x < 1, 'value in range: ' + x);
    }
});

test('mulberry32 different seeds diverge', () => {
    const a = L.mulberry32(1)();
    const b = L.mulberry32(2)();
    assert.notStrictEqual(a, b);
});

// ---------- randRange / pickWeighted ----------

test('randRange stays within bounds and reaches both ends with rand 0/~1', () => {
    assert.strictEqual(L.randRange([10, 20], () => 0), 10);
    assert.ok(L.randRange([10, 20], () => 0.999999) < 20);
    for (let i = 0; i < 50; i++) {
        const v = L.randRange([5, 9], Math.random);
        assert.ok(v >= 5 && v <= 9);
    }
});

test('randRange handles a reversed range', () => {
    assert.strictEqual(L.randRange([20, 10], () => 0), 10);
});

test('pickWeighted picks the only nonzero item every time', () => {
    const items = [{ weight: 0, value: 'never' }, { weight: 5, value: 'always' }];
    for (let i = 0; i < 10; i++) assert.strictEqual(L.pickWeighted(items, Math.random), 'always');
});

test('pickWeighted respects proportions over many draws', () => {
    const items = [{ weight: 1, value: 'a' }, { weight: 3, value: 'b' }];
    const rand = L.mulberry32(7);
    let a = 0, b = 0;
    for (let i = 0; i < 4000; i++) (L.pickWeighted(items, rand) === 'a' ? a++ : b++);
    const ratio = b / a;
    assert.ok(ratio > 2 && ratio < 4, 'expected ~3:1, got ' + ratio);
});

test('pickWeighted returns null for an empty or all-zero list', () => {
    assert.strictEqual(L.pickWeighted([], Math.random), null);
    assert.strictEqual(L.pickWeighted([{ weight: 0, value: 'x' }], Math.random), null);
});

// ---------- fadeMultiplier ----------

test('fadeMultiplier: 1 at start, 0 at/after end, linear between', () => {
    assert.strictEqual(L.fadeMultiplier(0, 30000), 1);
    assert.strictEqual(L.fadeMultiplier(30000, 30000), 0);
    assert.strictEqual(L.fadeMultiplier(15000, 30000), 0.5);
    assert.strictEqual(L.fadeMultiplier(60000, 30000), 0); // past the end: clamped, not negative
});

test('fadeMultiplier: a nonpositive duration is an instant cut', () => {
    assert.strictEqual(L.fadeMultiplier(0, 0), 0);
    assert.strictEqual(L.fadeMultiplier(0, -5), 0);
});

// ---------- sleepPhase ----------

test('sleepPhase: off with no state', () => {
    assert.strictEqual(L.sleepPhase(null, Date.now()).phase, 'off');
});

test('sleepPhase: counting, then fading, then done, for a 15 min / 30 s timer', () => {
    const start = 1000000;
    const state = { startedAt: start, totalMs: 15 * 60000, fadeMs: 30000 };
    const counting = L.sleepPhase(state, start + 1000);
    assert.strictEqual(counting.phase, 'counting');
    assert.strictEqual(counting.multiplier, 1);
    assert.strictEqual(counting.remainingMs, 15 * 60000 - 1000);

    const fadeStart = start + 15 * 60000 - 30000;
    const justFading = L.sleepPhase(state, fadeStart + 1);
    assert.strictEqual(justFading.phase, 'fading');
    assert.ok(justFading.multiplier > 0.98, 'barely faded yet: ' + justFading.multiplier);

    const midFade = L.sleepPhase(state, fadeStart + 15000);
    assert.strictEqual(midFade.phase, 'fading');
    assert.ok(Math.abs(midFade.multiplier - 0.5) < 0.01, 'about half faded: ' + midFade.multiplier);

    const done = L.sleepPhase(state, start + 15 * 60000);
    assert.strictEqual(done.phase, 'done');
    assert.strictEqual(done.multiplier, 0);

    const wayPast = L.sleepPhase(state, start + 999 * 60000);
    assert.strictEqual(wayPast.phase, 'done');
});

test('sleepPhase: a fade longer than the whole timer never goes negative', () => {
    const state = { startedAt: 0, totalMs: 10000, fadeMs: 30000 };
    const mid = L.sleepPhase(state, 5000);
    assert.strictEqual(mid.phase, 'fading');
    assert.ok(mid.multiplier >= 0 && mid.multiplier <= 1);
});

// ---------- formatMinutes ----------

test('formatMinutes', () => {
    assert.strictEqual(L.formatMinutes(null), 'Off');
    assert.strictEqual(L.formatMinutes('chapter'), 'End of chapter');
    assert.strictEqual(L.formatMinutes(45), '45 min');
});

test('SLEEP_MINUTES is the five options in order', () => {
    assert.deepStrictEqual(L.SLEEP_MINUTES, [15, 30, 45, 60, 90]);
});

// ---------- generateNoiseBuffer ----------

['white', 'brown', 'pink'].forEach((kind) => {
    test(`generateNoiseBuffer(${kind}): right length, in range, not silent, loops without a jump`, () => {
        const rand = L.mulberry32(123);
        const frames = 4800; // 0.1s @ 48k, plenty to check the seam
        const buf = L.generateNoiseBuffer(kind, frames, rand);
        assert.strictEqual(buf.length, frames);
        let maxAbs = 0;
        let sumSq = 0;
        for (let i = 0; i < frames; i++) {
            assert.ok(buf[i] >= -1.0001 && buf[i] <= 1.0001, `${kind}[${i}] in range: ${buf[i]}`);
            maxAbs = Math.max(maxAbs, Math.abs(buf[i]));
            sumSq += buf[i] * buf[i];
        }
        assert.ok(maxAbs > 0.05, `${kind} isn't silent: max ${maxAbs}`);
        assert.ok(Math.sqrt(sumSq / frames) > 0.01, `${kind} has real energy (RMS)`);
        // white noise has no sample-to-sample correlation, so a "seam" isn't a
        // meaningful concept for it (nothing to click). brown/pink are heavily
        // autocorrelated, so a big jump at the wrap *would* be audible —
        // that's what crossfadeSeam exists to prevent, and what's checked here.
        if (kind !== 'white') {
            const seamGap = Math.abs(buf[frames - 1] - buf[0]);
            assert.ok(seamGap < 0.5, `${kind} loop seam is close: gap ${seamGap}`);
        }
    });
});

test('generateNoiseBuffer is deterministic for the same seed', () => {
    const a = L.generateNoiseBuffer('pink', 2000, L.mulberry32(9));
    const b = L.generateNoiseBuffer('pink', 2000, L.mulberry32(9));
    assert.deepStrictEqual(Array.from(a), Array.from(b));
});

test('generateNoiseBuffer: brown noise has more low-frequency energy than white (rough spectral sanity check)', () => {
    // Cheap proxy for "brown is smoother than white": brown's sample-to-sample
    // difference should be much smaller on average than white's.
    const frames = 8000;
    const white = L.generateNoiseBuffer('white', frames, L.mulberry32(5));
    const brown = L.generateNoiseBuffer('brown', frames, L.mulberry32(5));
    const roughness = (buf) => {
        let s = 0;
        for (let i = 1; i < buf.length; i++) s += Math.abs(buf[i] - buf[i - 1]);
        return s / (buf.length - 1);
    };
    assert.ok(roughness(brown) < roughness(white) * 0.5, 'brown should be much smoother than white');
});

// ---------- distance ----------

test('pickDistance: mix=1 always distant, mix=0 always close', () => {
    for (let i = 0; i < 10; i++) {
        assert.strictEqual(L.pickDistance(1, Math.random), 'distant');
        assert.strictEqual(L.pickDistance(0, Math.random), 'close');
    }
});

test('DISTANCE_PARAMS: close is louder and brighter than distant', () => {
    assert.ok(L.DISTANCE_PARAMS.close.gain > L.DISTANCE_PARAMS.distant.gain);
    assert.ok(L.DISTANCE_PARAMS.close.lowpassHz > L.DISTANCE_PARAMS.distant.lowpassHz);
});

// ---------- catalog ----------

test('the shipped PRESETS catalog is internally consistent', () => {
    const problems = L.validateCatalog(L.PRESETS, L.ASSETS);
    assert.deepStrictEqual(problems, []);
});

test('validateCatalog actually catches a broken preset', () => {
    const bad = [{ id: 'x', label: 'X', group: 'Storms', beds: [{ id: 'nope' }] }];
    const problems = L.validateCatalog(bad, L.ASSETS);
    assert.ok(problems.length >= 1);
    assert.ok(problems[0].includes('nope'));
});

test('every preset group is one of Storms/Nature/Noise', () => {
    L.PRESETS.forEach((p) => assert.ok(['Storms', 'Nature', 'Noise'].includes(p.group), p.id));
});

// ---------- real-asset mapping (HOME-104 follow-up: real delivery files) ----------

test('catalog has the 11 real beds and 20 real thunder one-shots from the delivery README', () => {
    const beds = Object.keys(L.ASSETS).filter((id) => L.ASSETS[id].kind === 'bed');
    const shots = Object.keys(L.ASSETS).filter((id) => L.ASSETS[id].kind === 'oneshot');
    assert.strictEqual(beds.length, 11, 'bed count: ' + beds.join(','));
    assert.strictEqual(shots.length, 20, 'one-shot count: ' + shots.join(','));
});

test('every streamed bed asset declares a fallback noise kind', () => {
    Object.keys(L.ASSETS).forEach((id) => {
        const a = L.ASSETS[id];
        if (a.kind === 'bed' && a.stream) {
            assert.ok(a.fallback === 'brown' || a.fallback === 'pink', id + ' has a real fallback kind');
        }
    });
});

test('the thunder pool groups partition the 20 one-shots exactly once each', () => {
    const groups = [L.THUNDER_CLOSE, L.THUNDER_SHARP, L.THUNDER_ROLLING, L.THUNDER_DISTANT, L.THUNDER_ODD];
    const seen = new Map();
    groups.forEach((g) => g.forEach((id) => seen.set(id, (seen.get(id) || 0) + 1)));
    const shots = Object.keys(L.ASSETS).filter((id) => L.ASSETS[id].kind === 'oneshot');
    assert.strictEqual(seen.size, shots.length, 'every thunder asset appears in some group');
    shots.forEach((id) => assert.strictEqual(seen.get(id), 1, id + ' appears in exactly one group'));
});

test('a preset with a gusty bed also sets gustEverySec', () => {
    L.PRESETS.forEach((p) => {
        const hasGust = (p.beds || []).some((b) => b.gust);
        if (hasGust) assert.ok(p.gustEverySec, p.id + ': gusty bed needs gustEverySec');
    });
});

console.log(`${pass} passed${process.exitCode ? ', see FAILs above' : ''}`);
