/*
 * HOMER commercial skip: while a recording (or anything else with a
 * timeline) plays full screen, S, the remote's fast-forward and the Skip
 * button in the player's bar jump ahead 30 seconds, one ad at a time.
 * Presses add up ("+1:30") and the video jumps once they stop, so a whole
 * break is one jump. Jellyfin's ◀ (back 10 seconds) takes back an overshoot.
 * Live TV has no timeline, so there's nothing to skip there.
 *
 * The jump goes through Jellyfin's own player (the Seek command its server
 * sends), so its position, progress and transcoding stay right.
 *
 * window.HomerSkip = { skip(count), destroy, version }
 */
(() => {
    const VERSION = '0.1.0';

    if (window.HomerSkip && typeof window.HomerSkip.destroy === 'function') {
        window.HomerSkip.destroy();
    }

    const STEP = 30; // seconds: most US commercials
    const SETTLE_MS = 800; // how long after the last press the jump waits
    const KEYS = ['s', 'S', 'MediaFastForward'];

    const isVideoRoute = () => /^#\/video/.test(location.hash);
    const player = () => window.HomerPlayer;
    const video = () => document.querySelector('video.htmlvideoplayer');
    const message = (msg) => {
        const ac = window.ApiClient;
        if (ac && typeof ac.handleMessageReceived === 'function') ac.handleMessageReceived(msg);
    };
    const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

    // ---------- What's playing ----------

    // A timeline to skip along: a finite video. Live TV streams have no end
    // (their duration is Infinity), so the button and S stay out of them.
    // The video's clock is the item's own (direct play, and Jellyfin's
    // full-length HLS), so its position is where the jump starts from.
    // Jellyfin hides its own fast-forward when it can't seek, too.
    const seekable = () => {
        const v = video();
        if (!v || !isVideoRoute()) return false;
        const ff = document.querySelector('.videoOsdBottom .btnFastForward');
        if (ff && ff.classList.contains('hide')) return false;
        return Number.isFinite(v.duration) && v.duration > 60;
    };
    // full screen, with nothing of HOMER's on top
    const inPlayer = () => isVideoRoute() && !(player() && player().docked()) && !document.querySelector('#hm-root, #hl-root, #cg-root, .homer-screen');

    // ---------- Skipping ----------

    let pending = 0;
    let settleTimer = 0;
    const skip = (count = 1) => {
        if (!seekable()) return false;
        pending += count;
        showHud(`+${fmt(pending * STEP)}`, 'pending');
        clearTimeout(settleTimer);
        settleTimer = setTimeout(jump, SETTLE_MS);
        return true;
    };
    const jump = () => {
        const n = pending;
        pending = 0;
        const v = video();
        if (!n || !v || !seekable()) return hideHud();
        const from = v.currentTime;
        const target = Math.min(from + n * STEP, v.duration - 3);
        if (target <= from + 1) return showHud('At the end', 'done');
        message({ MessageType: 'Playstate', Data: { Command: 'Seek', SeekPositionTicks: Math.round(target * 1e7) } });
        showHud(`Skipped ${fmt(target - from)}`, 'done');
    };

    // ---------- The count, over the picture ----------

    let hud = null;
    let hudTimer = 0;
    const showHud = (text, state) => {
        if (!hud) {
            hud = document.createElement('div');
            hud.className = 'homer-skip-hud';
            hud.setAttribute('role', 'status');
            hud.innerHTML = '<span class="material-icons" aria-hidden="true">fast_forward</span><b></b>';
            document.body.appendChild(hud);
        }
        hud.querySelector('b').textContent = text;
        hud.dataset.state = state;
        hud.classList.add('show');
        clearTimeout(hudTimer);
        if (state === 'done') hudTimer = setTimeout(hideHud, 1400);
    };
    const hideHud = () => {
        clearTimeout(hudTimer);
        if (hud) hud.classList.remove('show');
    };

    // ---------- Keys ----------

    const isTyping = (t) => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''));
    const onKey = (ev) => {
        if (!KEYS.includes(ev.key) || ev.ctrlKey || ev.metaKey || ev.altKey) return;
        if (!inPlayer() || isTyping(ev.target) || isTyping(document.activeElement)) return;
        if (!seekable()) return;
        ev.preventDefault();
        ev.stopImmediatePropagation(); // Jellyfin's fast-forward key would jump on its own
        skip(1);
    };
    document.addEventListener('keydown', onKey, true);

    // ---------- A Skip button in the player's control bar ----------

    const BTN_CLASS = 'homerSkipButton';
    const syncButton = () => {
        const bottom = document.querySelector('.videoOsdBottom');
        const bar = bottom && bottom.querySelector('.buttons');
        if (!bar) return;
        const on = seekable() && inPlayer();
        let btn = bar.querySelector('.' + BTN_CLASS);
        if (on && !btn) {
            btn = document.createElement('button');
            btn.type = 'button';
            btn.setAttribute('is', 'paper-icon-button-light');
            btn.className = `paper-icon-button-light ${BTN_CLASS}`;
            btn.title = 'Skip a commercial: 30 seconds (S)';
            btn.setAttribute('aria-label', 'Skip 30 seconds');
            btn.innerHTML = '<span class="material-icons" aria-hidden="true">fast_forward</span><span class="homerSkipLabel">Skip 30s</span>';
            btn.addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                skip(1);
            });
            // where Jellyfin's own fast-forward sits, which this replaces
            const ff = bar.querySelector('.btnFastForward');
            if (ff) ff.parentNode.insertBefore(btn, ff.nextSibling);
            else bar.insertBefore(btn, bar.firstChild);
        } else if (!on && btn) {
            btn.remove();
        }
        bottom.classList.toggle('homer-skip-on', on);
    };
    const btnTimer = setInterval(syncButton, 500);

    // ---------- Styles ----------

    const style = document.createElement('style');
    style.id = 'homer-skip-css';
    style.textContent = `
        .videoOsdBottom.homer-skip-on .btnFastForward { display: none !important; }
        .videoOsdBottom .${BTN_CLASS} {
            display: inline-flex;
            align-items: center;
            gap: 0.35em;
            width: auto;
            padding: 0.35em 0.9em 0.35em 0.6em;
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.1);
            box-shadow: inset 0 0 0 1px var(--homer-line-strong, rgba(160, 190, 230, 0.24));
            color: #fff;
            font-family: var(--homer-font-cond, "Barlow Semi Condensed", sans-serif);
            font-size: 1em;
            font-weight: 700;
            letter-spacing: 0.02em;
        }
        .videoOsdBottom .${BTN_CLASS}:hover,
        .videoOsdBottom .${BTN_CLASS}:focus-visible { background: var(--homer-focus-fill, #2f8cff); }
        .videoOsdBottom .${BTN_CLASS} .material-icons { font-size: 1.5em; }
        .homer-skip-hud {
            position: fixed;
            top: 9vh;
            left: 50%;
            translate: -50% 0;
            z-index: 100000;
            display: flex;
            align-items: center;
            gap: 0.4em;
            padding: 0.45em 0.95em 0.45em 0.7em;
            border-radius: 999px;
            background: rgba(9, 20, 38, 0.86);
            box-shadow: 0 0 0 1px var(--homer-line-strong, rgba(160, 190, 230, 0.24)), 0 18px 50px rgba(0, 0, 0, 0.55);
            color: #fff;
            font-family: var(--homer-font-cond, "Barlow Semi Condensed", sans-serif);
            font-size: clamp(22px, 2.4vw, 40px);
            font-weight: 700;
            font-variant-numeric: tabular-nums;
            pointer-events: none;
            opacity: 0;
            transform: translateY(-8px);
            transition: opacity 160ms ease, transform 160ms ease;
        }
        .homer-skip-hud.show { opacity: 1; transform: none; }
        .homer-skip-hud .material-icons { font-size: 1.15em; color: var(--homer-accent-2, #6fd3ff); }
        .homer-skip-hud[data-state="done"] .material-icons { color: #fff; }
        @media (prefers-reduced-motion: reduce) { .homer-skip-hud { transition: none; } }
    `;
    document.head.appendChild(style);

    window.HomerSkip = {
        version: VERSION,
        skip,
        destroy() {
            clearInterval(btnTimer);
            clearTimeout(settleTimer);
            clearTimeout(hudTimer);
            document.removeEventListener('keydown', onKey, true);
            document.querySelectorAll('.' + BTN_CLASS).forEach((b) => b.remove());
            document.querySelectorAll('.homer-skip-on').forEach((b) => b.classList.remove('homer-skip-on'));
            if (hud) hud.remove();
            style.remove();
        }
    };
})();
