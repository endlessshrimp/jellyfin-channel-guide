/*
 * HOMER Music, the now-playing strip: the small bar that follows the music
 * around HOMER. Music doesn't stop when you leave #/music — the player lives
 * in music/music-model.js, not in a screen — so every other screen gets this
 * strip in the corner: the cover, the track, the artist, a hairline of
 * progress and ◀◀ ▶ ▶▶.
 *
 * It hides itself where it would be in the way: on the Music screen (which
 * shows all of this much bigger), while the guide is open, and in full-screen
 * video. On a phone it sits above the tab bar.
 *
 * A radio station (music/radio-model.js) rides in the same strip: the same
 * cover, name and play button, with ◀◀ ▶▶ gone — there's nothing either side
 * of it — and no hairline of progress, because it has no length.
 *
 * The media keys work from anywhere while something is loaded: Play/Pause,
 * Next, Previous. HOMER's own screens keep their letters; the strip only
 * claims keys nothing else wants. It also registers a Music action, so the
 * Apple TV remote reaches play/pause by holding OK.
 *
 * window.HomerMusicStrip = { el, sync, destroy, version }
 */
(() => {
    const VERSION = '0.1.0';

    if (window.HomerMusicStrip && typeof window.HomerMusicStrip.destroy === 'function') {
        window.HomerMusicStrip.destroy();
    }

    const M = () => window.HomerMusicModel;
    const HP = () => window.HomerPlayer || null;
    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const icon = (name) => `<span class="material-icons" aria-hidden="true">${name}</span>`;

    const route = () => {
        const p = HP();
        if (p && typeof p.route === 'function') {
            try {
                const r = p.route();
                if (typeof r === 'string') return r;
            } catch { /* fall through */ }
        }
        return location.hash || '';
    };
    const onMusic = () => /^#!?\/music(\?|$)/i.test(route());
    const fullscreenVideo = () => {
        const p = HP();
        try {
            return !!(p && p.nowPlaying && p.nowPlaying() && p.docked && !p.docked());
        } catch {
            return false;
        }
    };

    const root = document.createElement('div');
    root.id = 'mu-strip';
    root.innerHTML = `
        <div class="mu-strip-art"></div>
        <div class="mu-strip-text">
            <b class="mu-strip-t"></b>
            <span class="mu-strip-a"></span>
        </div>
        <div class="mu-strip-btns">
            <button type="button" class="mu-strip-b" data-k="prev" title="Previous">${icon('skip_previous')}</button>
            <button type="button" class="mu-strip-b play" data-k="play" title="Play / pause">${icon('play_arrow')}</button>
            <button type="button" class="mu-strip-b" data-k="next" title="Next">${icon('skip_next')}</button>
        </div>
        <i class="mu-strip-bar"></i>`;

    let mounted = false;
    const mount = () => {
        if (mounted || !document.body) return;
        document.body.appendChild(root);
        mounted = true;
    };

    let lastKey = '';
    const sync = () => {
        if (!M()) return;
        mount();
        const s = M().player.state();
        const show = !!s.track && !onMusic() && !document.getElementById('cg-root') && !fullscreenVideo();
        root.classList.toggle('on', show);
        document.documentElement.classList.toggle('homer-music-strip', show);
        if (!show) return;
        const t = s.track;
        const key = t.id + '|' + s.playing + '|' + Math.floor(s.position);
        // a radio station has nothing before or after it (music/radio-model.js)
        root.classList.toggle('live', !!t.live);
        if (key === lastKey) return;
        lastKey = key;
        const art = M().art(t, 120);
        const box = root.querySelector('.mu-strip-art');
        if (box.dataset.id !== t.id) {
            box.dataset.id = t.id;
            box.innerHTML = art ? `<img src="${esc(art)}" alt="" draggable="false">` : icon('music_note');
        }
        root.querySelector('.mu-strip-t').textContent = t.name;
        root.querySelector('.mu-strip-a').textContent = [t.artist, t.album].filter(Boolean).join(' · ');
        const play = root.querySelector('[data-k="play"]');
        play.innerHTML = icon(s.playing ? 'pause' : 'play_arrow');
        root.classList.toggle('playing', s.playing);
        const pc = s.duration ? Math.max(0, Math.min(1, s.position / s.duration)) : 0;
        root.querySelector('.mu-strip-bar').style.width = (pc * 100).toFixed(2) + '%';
    };

    root.addEventListener('click', (ev) => {
        const b = ev.target.closest('.mu-strip-b');
        const P = M() && M().player;
        if (!P) return;
        if (b) {
            ev.stopPropagation();
            if (b.dataset.k === 'play') P.toggle();
            else if (b.dataset.k === 'next') P.next();
            else P.prev();
            lastKey = '';
            sync();
            return;
        }
        // anywhere else on the strip: the Music screen, on Now playing
        const p = HP();
        if (p && typeof p.go === 'function') p.go('#/music?np=1');
        else location.hash = '#/music?np=1';
    });

    // ---------- Keys that work anywhere ----------

    const isTyping = (t) => {
        if (!t || !t.tagName) return false;
        if (t.isContentEditable) return true;
        if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
        if (t.tagName !== 'INPUT') return false;
        return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'image', 'color', 'file'].includes((t.type || '').toLowerCase());
    };
    const onKey = (ev) => {
        const P = M() && M().player;
        if (!P || !P.state().track) return;
        if (onMusic()) return; // the Music screen has its own keys
        if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
        if (isTyping(ev.target)) return;
        const k = ev.key;
        if (k === 'MediaPlayPause' || k === 'MediaPlay' || k === 'MediaPause') { ev.preventDefault(); P.toggle(); return; }
        if (k === 'MediaTrackNext') { ev.preventDefault(); P.next(); return; }
        if (k === 'MediaTrackPrevious') { ev.preventDefault(); P.prev(); return; }
        if (k === 'MediaStop') { ev.preventDefault(); P.pause(); }
    };
    window.addEventListener('keydown', onKey, true);

    // ---------- The Actions strip (shared/actions.js) ----------

    const offActions = window.HomerActions ? window.HomerActions.provide(() => {
        const P = M() && M().player;
        const s = P && P.state();
        if (!s || !s.track || onMusic()) return [];
        return [
            {
                id: 'music-play',
                icon: s.playing ? 'pause' : 'play_arrow',
                label: s.playing ? 'Pause music' : 'Play music',
                sub: s.track.name,
                run: () => P.toggle(),
            },
            {
                id: 'music-next',
                icon: 'skip_next',
                label: 'Next track',
                sub: s.next ? s.next.name : '',
                disabled: !s.next,
                run: () => P.next(),
            },
            {
                id: 'music-screen',
                icon: 'library_music',
                label: 'Music',
                run: () => {
                    const p = HP();
                    if (p && typeof p.go === 'function') p.go('#/music?np=1');
                    else location.hash = '#/music?np=1';
                },
            },
        ];
    }, { global: true, id: 'music', title: 'Music' }) : () => {};

    // ---------- Keeping up ----------

    let offModel = null;
    const attach = () => {
        if (offModel || !M()) return;
        offModel = M().onChange(() => sync());
        sync();
    };
    attach();
    const poll = setInterval(() => { attach(); sync(); }, 1000);
    const offPlayer = HP() && HP().onChange ? HP().onChange(() => sync()) : null;
    window.addEventListener('hashchange', sync);

    if (document.body) mount();
    else document.addEventListener('DOMContentLoaded', mount, { once: true });

    window.HomerMusicStrip = {
        version: VERSION,
        el: root,
        sync,
        destroy() {
            clearInterval(poll);
            offActions();
            if (offModel) offModel();
            if (typeof offPlayer === 'function') offPlayer();
            window.removeEventListener('keydown', onKey, true);
            window.removeEventListener('hashchange', sync);
            document.removeEventListener('DOMContentLoaded', mount);
            document.documentElement.classList.remove('homer-music-strip');
            root.remove();
        },
    };
})();
