/*
 * HOMER channel logos: a dark or a light chip behind each channel logo, so
 * every logo reads in its own colors.
 *
 * Most channel logos are white or light (they're made for dark backgrounds),
 * so chips are dark. A logo that's dark itself (E!, Vice, Paramount) would
 * vanish there, so it gets a light chip instead. A logo with its own solid
 * background keeps the dark chip; only its padding shows.
 *
 * Each logo is measured once, with a canvas, when the browser is idle: the
 * pixels along the edge of its shape (where the logo meets the chip) are
 * checked for contrast against both chips. The answer is cached per channel
 * and image tag, in memory and in localStorage, so a logo seen before gets its
 * chip straight away. A first-time answer fades the chip in.
 *
 * Screens call HomerLogos.watch(img, chip) for a logo <img> (loaded or not, or
 * lazy with data-src) and style the chip with the --homer-logo-* tokens from
 * shared/tokens.css; this toggles homer-logo-light on the chip.
 *
 * window.HomerLogos = { watch, version }
 */
(() => {
    const VERSION = '0.1.0';

    // The chip colors from shared/tokens.css, as the logo sees them.
    const CHIP_DARK = [28, 41, 64]; // --homer-logo-chip
    const CHIP_LIGHT = [235, 242, 250]; // --homer-logo-chip-light
    const SIZE = 64; // measure at this width; plenty for a logo's shape
    const LOST = 2; // an edge pixel under this contrast ratio blends into the chip
    const STORE = 'homer-logo-tones';

    // ---------- Measuring ----------

    // sRGB byte -> linear light, looked up rather than worked out per pixel
    const LINEAR = Array.from({ length: 256 }, (_, c) => {
        const v = c / 255;
        return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    const luminance = (r, g, b) => 0.2126 * LINEAR[r] + 0.7152 * LINEAR[g] + 0.0722 * LINEAR[b];
    const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const DARK_L = luminance(...CHIP_DARK);
    const LIGHT_L = luminance(...CHIP_LIGHT);

    let ctx = null;
    // true: the logo needs the light chip. Throws if the image can't be read.
    const needsLight = (img) => {
        const w = Math.min(SIZE, img.naturalWidth);
        const h = Math.max(1, Math.round((img.naturalHeight * w) / img.naturalWidth));
        if (!w) return false;
        if (!ctx) ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
        ctx.canvas.width = w; // resizing also clears it
        ctx.canvas.height = h;
        ctx.drawImage(img, 0, 0, w, h);
        const px = ctx.getImageData(0, 0, w, h).data;
        const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && px[(y * w + x) * 4 + 3] >= 128;
        let opaque = 0;
        let edge = 0;
        let lostOnDark = 0;
        let lostOnLight = 0;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (!solid(x, y)) continue;
                opaque++;
                // Only the outline counts: inside a shape, the logo is its own
                // background (a white word in a black box reads on any chip).
                if (solid(x - 1, y) && solid(x + 1, y) && solid(x, y - 1) && solid(x, y + 1)) continue;
                edge++;
                const i = (y * w + x) * 4;
                const l = luminance(px[i], px[i + 1], px[i + 2]);
                if (contrast(l, DARK_L) < LOST) lostOnDark++;
                if (contrast(l, LIGHT_L) < LOST) lostOnLight++;
            }
        }
        // a logo on its own solid background: the chip is only its frame
        if (!edge || opaque / (w * h) >= 0.9) return false;
        // Light only for a logo that loses a lot on dark and little on light;
        // a logo that loses some on both (white word, black box) stays dark.
        return lostOnDark / edge >= 0.25 && lostOnLight / edge <= 0.2;
    };

    // ---------- Cache: channel id -> [image tag, 1 light / 0 dark] ----------

    const cache = new Map();
    try {
        const saved = JSON.parse(localStorage.getItem(STORE) || '{}');
        for (const id of Object.keys(saved)) cache.set(id, saved[id]);
    } catch { /* start empty */ }

    let saveTimer = 0;
    const save = () => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            try { localStorage.setItem(STORE, JSON.stringify(Object.fromEntries(cache))); } catch { /* memory only */ }
        }, 1500);
    };

    // /Items/{id}/Images/Primary?…&tag=… -> { id, tag }. Home and Search ask for
    // a program's channel logo without a tag; those trust whatever is cached.
    const keyOf = (url) => {
        const m = /\/Items\/([^/?#]+)\/Images\//.exec(url || '');
        if (!m) return null;
        const t = /[?&]tag=([^&#]*)/.exec(url);
        return { id: m[1], tag: t ? decodeURIComponent(t[1]) : '' };
    };
    const known = (key) => {
        const hit = cache.get(key.id);
        return hit && (!key.tag || hit[0] === key.tag) ? hit : null;
    };

    // ---------- Idle queue ----------

    const queue = [];
    let pending = false;
    const idle = window.requestIdleCallback
        ? (fn) => window.requestIdleCallback(fn, { timeout: 500 })
        : (fn) => setTimeout(() => fn({ timeRemaining: () => 8, didTimeout: false }), 30);

    const apply = (chip, light) => chip.classList.toggle('homer-logo-light', light);

    const measure = ({ img, key, chip }) => {
        let hit = known(key); // an earlier copy of the same logo may have answered
        if (!hit) {
            try {
                hit = [key.tag, needsLight(img) ? 1 : 0];
            } catch {
                return; // unreadable (another origin): leave the dark chip
            }
            cache.set(key.id, hit);
            save();
        }
        const el = chip || img.parentNode;
        if (!el) return;
        el.classList.add('homer-logo-fade'); // this change fades; cached ones don't
        apply(el, !!hit[1]);
    };

    const drain = (deadline) => {
        pending = false;
        // what idle time there is, or a few at a time on a page that never idles
        const most = deadline.didTimeout ? 16 : Infinity;
        let n = 0;
        do {
            measure(queue.shift());
            n++;
        } while (queue.length && n < most && (deadline.didTimeout || deadline.timeRemaining() > 2));
        if (queue.length) schedule();
    };
    const schedule = () => {
        if (pending) return;
        pending = true;
        idle(drain);
    };

    // ---------- API ----------

    // Watch a channel logo <img>. chip defaults to the image's parent.
    const watch = (img, chip) => {
        const key = keyOf(img.getAttribute('src') || img.getAttribute('data-src'));
        if (!key) return;
        const hit = cache.get(key.id);
        if (hit && (chip || img.parentNode)) apply(chip || img.parentNode, !!hit[1]); // before the first paint
        if (known(key)) return;
        const job = { img, key, chip };
        if (img.complete && img.naturalWidth) {
            queue.push(job);
            schedule();
        } else {
            img.addEventListener('load', () => { queue.push(job); schedule(); }, { once: true });
        }
    };

    // loading again replaces this copy (it keeps nothing on the page)
    window.HomerLogos = { watch, version: VERSION };
})();
