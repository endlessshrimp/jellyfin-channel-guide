/*
 * HOMER Music, phone layout: drawn instead of the TV screen when
 * shared/layout.js says phone (music/music.js decides). The same library and
 * the same player (music/music-model.js), sized for a thumb:
 *
 *   Browse     chips for Recently Added / Artists / Albums / Songs /
 *              Playlists / Genres, and the art two across under them
 *   A page     (tap a cover) a sheet: the art, Play / Shuffle / Instant Mix,
 *              and the tracks — or, for an artist or a genre, their albums
 *   Playing    (tap the bar) the big cover, the controls, and the lyrics,
 *              the line you're on lit
 *
 * A mini player sits above the tab bar whenever something is loaded. Leaving
 * Music does not stop it: music/music-strip.js takes over on other screens.
 *
 * window.HomerMusicPhone = { create, version }
 */
(() => {
    const VERSION = '0.1.0';
    const M = () => window.HomerMusicModel;

    const el = (tag, cls, html) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html != null) e.innerHTML = html;
        return e;
    };

    const TABS = [
        { id: 'recent', label: 'New', list: () => M().recent() },
        { id: 'artists', label: 'Artists', list: () => M().artists() },
        { id: 'albums', label: 'Albums', list: () => M().albums() },
        { id: 'songs', label: 'Songs', list: () => M().songs() },
        { id: 'playlists', label: 'Playlists', list: () => M().playlists() },
        { id: 'genres', label: 'Genres', list: () => M().genres() },
    ];

    const create = (ctx) => {
        const { esc, icon, artImg, metaOf, subOf } = ctx;
        const player = () => M().player;
        const f = () => M().fmt;

        const root = el('div', 'homer-screen mu-phone');
        root.id = 'mu-root';
        root.style.visibility = 'hidden';
        root.innerHTML = `
            <div class="mup-wash"></div>
            <div class="mup-scroll">
                <div class="mup-chips"></div>
                <div class="mup-grid"></div>
                <div class="mup-state"></div>
            </div>
            <button type="button" class="mup-mini"></button>
            <div class="mup-sheet mup-page"></div>
            <div class="mup-sheet mup-playing"></div>`;
        document.body.appendChild(root);
        const $ = (s) => root.querySelector(s);

        let tab = 'recent';
        let sheets = [];
        let open = null;
        let pageItem = null;
        let pageTracks = null;
        let pageAlbums = null;
        const push = (k) => { sheets = sheets.filter((x) => x !== k); sheets.push(k); open = k; };
        const closeSheet = () => {
            sheets.pop();
            open = sheets[sheets.length - 1] || null;
            syncSheets();
        };
        const syncSheets = () => {
            root.classList.toggle('mup-open-page', open === 'page');
            root.classList.toggle('mup-open-playing', open === 'playing');
        };

        const setWash = (it) => {
            const w = $('.mup-wash');
            if (!it) { w.style.setProperty('--wash', '47,140,255'); return; }
            M().color(it).then((rgb) => w.style.setProperty('--wash', (rgb || [47, 140, 255]).join(',')));
        };

        // ----- browse -----
        const drawChips = () => {
            const box = $('.mup-chips');
            box.innerHTML = '';
            TABS.forEach((t) => {
                const n = (t.list() || []).length;
                if (!n && t.id !== tab) return;
                const c = el('button', `mup-chip${t.id === tab ? ' on' : ''}`, `${esc(t.label)}${n ? ` <i>${n}</i>` : ''}`);
                c.type = 'button';
                c.onclick = () => { tab = t.id; drawChips(); drawGrid(); $('.mup-scroll').scrollTop = 0; };
                box.appendChild(c);
            });
        };
        const drawGrid = () => {
            const box = $('.mup-grid');
            const t = TABS.find((x) => x.id === tab) || TABS[0];
            const list = t.list() || [];
            box.className = `mup-grid ${tab === 'songs' ? 'list' : 'wall'}`;
            box.innerHTML = '';
            if (!list.length) { box.innerHTML = '<div class="mup-note">Nothing here yet.</div>'; return; }
            if (tab === 'songs') {
                list.slice(0, 400).forEach((s, i) => {
                    const row = el('button', 'mup-song', `
                        <span class="mup-song-art">${artImg(s, 120, 'mu-img')}</span>
                        <span class="mup-song-t"><b>${esc(s.name)}</b><i>${esc(s.artist || '')}</i></span>
                        <span class="mup-song-d">${f().clock(s.duration)}</span>`);
                    row.type = 'button';
                    row.onclick = () => {
                        player().play(list, i, { source: { kind: 'songs', name: 'Songs' } });
                        push('playing');
                        drawPlaying();
                        syncSheets();
                    };
                    box.appendChild(row);
                });
                return;
            }
            list.forEach((it) => {
                const card = el('button', `mup-card ${it.kind}`, `
                    <span class="mup-card-art">${artImg(it, 400, 'mu-img')}</span>
                    <span class="mup-card-t">${esc(it.name)}</span>
                    <span class="mup-card-s">${esc(it.kind === 'album' ? it.artist || '' : it.tracks ? f().plural(it.tracks, 'track') : '')}</span>`);
                card.type = 'button';
                card.onclick = () => showPage(it);
                box.appendChild(card);
            });
        };

        // ----- a page: album/playlist tracks, or artist/genre albums -----
        const tracksOf = (it) => {
            if (it.kind === 'album') return M().albumTracks(it.id);
            if (it.kind === 'playlist') return M().playlistTracks(it.id);
            if (it.kind === 'artist') return M().artistAllSongs(it.id);
            return M().genreSongs(it.id);
        };
        const showPage = (it) => {
            pageItem = it;
            pageTracks = null;
            pageAlbums = null;
            push('page');
            drawPage();
            syncSheets();
            const wantAlbums = it.kind === 'artist' || it.kind === 'genre';
            const job = wantAlbums
                ? (it.kind === 'artist' ? M().artistAlbums(it.id) : M().genreAlbums(it.id))
                : tracksOf(it);
            job.then((list) => {
                if (pageItem !== it) return;
                if (wantAlbums) pageAlbums = list; else pageTracks = list;
                drawPage();
            }).catch(() => { if (pageItem === it) { pageTracks = []; drawPage(); } });
        };
        const playPage = (shuffle) => {
            const it = pageItem;
            if (!it) return;
            tracksOf(it).then((list) => {
                if (!list.length) return;
                player().play(list, 0, { shuffle: !!shuffle, source: { kind: it.kind, id: it.id, name: it.name } });
                push('playing');
                drawPlaying();
                syncSheets();
            });
        };
        const mixPage = () => {
            const it = pageItem;
            if (!it) return;
            M().instantMix(it).then((list) => {
                if (!list.length) return;
                player().play(list, 0, { source: { kind: 'mix', id: it.id, name: `${it.name} radio` } });
                push('playing');
                drawPlaying();
                syncSheets();
            });
        };
        const drawPage = () => {
            const box = $('.mup-page');
            const it = pageItem;
            if (!it) { box.innerHTML = ''; return; }
            setWash(it);
            const s = player().state();
            box.innerHTML = `
                <div class="mup-bar"><button type="button" class="mup-back">${icon('arrow_back_ios_new')}</button><span>${esc(it.name)}</span></div>
                <div class="mup-sheet-scroll">
                    <div class="mup-page-head">
                        <div class="mup-page-art${it.kind === 'artist' ? ' round' : ''}">${artImg(it, 600, 'mu-img')}</div>
                        <h1>${esc(it.name)}</h1>
                        <div class="mup-page-sub">${esc(it.kind === 'album' ? it.artist || '' : subOf(it))}</div>
                        <div class="mup-page-meta">${metaOf(it).map((x) => `<span>${esc(x)}</span>`).join('')}</div>
                        <div class="mup-page-acts">
                            <button type="button" class="mup-btn primary" data-a="play">${icon('play_arrow')}Play</button>
                            <button type="button" class="mup-btn" data-a="shuffle">${icon('shuffle')}Shuffle</button>
                            <button type="button" class="mup-btn" data-a="mix">${icon('radio')}Mix</button>
                        </div>
                    </div>
                    <div class="mup-page-body"></div>
                </div>`;
            box.querySelector('.mup-back').onclick = closeSheet;
            box.querySelector('[data-a="play"]').onclick = () => playPage(false);
            box.querySelector('[data-a="shuffle"]').onclick = () => playPage(true);
            box.querySelector('[data-a="mix"]').onclick = mixPage;
            const body = box.querySelector('.mup-page-body');
            if (pageAlbums) {
                body.className = 'mup-page-body wall';
                pageAlbums.forEach((a) => {
                    const card = el('button', 'mup-card album', `
                        <span class="mup-card-art">${artImg(a, 400, 'mu-img')}</span>
                        <span class="mup-card-t">${esc(a.name)}</span>
                        <span class="mup-card-s">${esc(a.year ? String(a.year) : '')}</span>`);
                    card.type = 'button';
                    card.onclick = () => showPage(a);
                    body.appendChild(card);
                });
                return;
            }
            body.className = 'mup-page-body';
            if (!pageTracks) { body.innerHTML = '<div class="mup-note">Getting the tracks…</div>'; return; }
            if (!pageTracks.length) { body.innerHTML = '<div class="mup-note">No tracks.</div>'; return; }
            pageTracks.forEach((t, i) => {
                const here = !!(s.track && s.track.id === t.id);
                const row = el('button', `mup-track${here ? ' here' : ''}`, `
                    <span class="mup-track-n">${here ? icon('graphic_eq') : (t.no || i + 1)}</span>
                    <span class="mup-track-t"><b>${esc(t.name)}</b>${t.artist && t.artist !== it.artist ? `<i>${esc(t.artist)}</i>` : ''}</span>
                    <span class="mup-track-d">${f().clock(t.duration)}</span>`);
                row.type = 'button';
                row.onclick = () => {
                    player().play(pageTracks, i, { source: { kind: it.kind, id: it.id, name: it.name } });
                    push('playing');
                    drawPlaying();
                    syncSheets();
                };
                body.appendChild(row);
            });
        };

        // ----- Now playing -----
        const drawPlaying = () => {
            const box = $('.mup-playing');
            const s = player().state();
            if (!s.track) { box.innerHTML = '<div class="mup-note">Nothing is playing.</div>'; return; }
            setWash(s.track);
            box.innerHTML = `
                <div class="mup-bar"><button type="button" class="mup-back">${icon('expand_more')}</button><span>${esc(s.source ? s.source.name : 'Now playing')}</span></div>
                <div class="mup-np">
                    <div class="mup-np-art">${artImg(s.track, 700, 'mu-img')}</div>
                    <h1 class="mup-np-t"></h1>
                    <div class="mup-np-a"></div>
                    <div class="mup-np-seek"><span class="mup-np-track"><b></b></span><span class="mup-np-times"><i class="at"></i><i class="left"></i></span></div>
                    <div class="mup-np-ctl">
                        <button type="button" class="mup-rb" data-k="shuffle">${icon('shuffle')}</button>
                        <button type="button" class="mup-rb" data-k="prev">${icon('skip_previous')}</button>
                        <button type="button" class="mup-rb big" data-k="play">${icon('play_arrow')}</button>
                        <button type="button" class="mup-rb" data-k="next">${icon('skip_next')}</button>
                        <button type="button" class="mup-rb" data-k="repeat">${icon('repeat')}</button>
                    </div>
                    <div class="mup-np-vol">${icon('volume_down')}<input type="range" min="0" max="100" step="1"></input>${icon('volume_up')}</div>
                    <div class="mup-np-next"></div>
                    <div class="mup-lyrics"></div>
                </div>`;
            box.querySelector('.mup-back').onclick = closeSheet;
            const P = player();
            const acts = {
                shuffle: () => P.toggleShuffle(),
                prev: () => P.prev(),
                play: () => P.toggle(),
                next: () => P.next(),
                repeat: () => P.cycleRepeat(),
            };
            box.querySelectorAll('[data-k]').forEach((b) => { b.onclick = acts[b.dataset.k]; });
            const track = box.querySelector('.mup-np-track');
            track.onclick = (ev) => {
                const r = track.getBoundingClientRect();
                const st = P.state();
                const dur = st.duration || st.track.duration || 0;
                if (dur) P.seek(((ev.clientX - r.left) / r.width) * dur);
            };
            const vol = box.querySelector('.mup-np-vol input');
            vol.value = Math.round(P.state().volume * 100);
            vol.oninput = () => P.setVolume(vol.value / 100);
            drawLyrics();
            paintPlaying();
        };
        let lyricsFor = '';
        const drawLyrics = () => {
            const box = $('.mup-lyrics');
            const s = player().state();
            if (!box || !s.track) return;
            lyricsFor = s.track.id;
            box.innerHTML = '<div class="mup-note">Looking for lyrics…</div>';
            M().lyrics(s.track.id).then((ly) => {
                if (lyricsFor !== s.track.id || !$('.mup-lyrics')) return;
                const b = $('.mup-lyrics');
                if (!ly || !ly.lines.length) { b.innerHTML = '<div class="mup-note">No lyrics for this one.</div>'; return; }
                b.classList.toggle('synced', ly.synced);
                b.innerHTML = ly.lines.map((l, i) => `<div class="mup-lyr" data-i="${i}">${esc(l.text) || '&nbsp;'}</div>`).join('');
                paintLyrics(true);
            });
        };
        let lyrLine = -2;
        const paintLyrics = (force) => {
            const box = $('.mup-lyrics');
            if (!box || !box.classList.contains('synced')) return;
            const s = player().state();
            if (!s.track) return;
            M().lyrics(s.track.id).then((l) => {
                if (!l || !l.synced || !$('.mup-lyrics')) return;
                const i = M().lyricAt(l, s.position);
                if (i === lyrLine && !force) return;
                lyrLine = i;
                const lines = $('.mup-lyrics').querySelectorAll('.mup-lyr');
                lines.forEach((e, k) => {
                    e.classList.toggle('on', k === i);
                    e.classList.toggle('past', k < i);
                });
                const cur = lines[i];
                const scroller = $('.mup-np');
                if (cur && scroller) {
                    const top = cur.offsetTop - scroller.clientHeight * 0.55;
                    scroller.scrollTo({ top: Math.max(0, top), behavior: force ? 'auto' : 'smooth' });
                }
            });
        };
        const paintPlaying = () => {
            const box = $('.mup-playing');
            if (!box || !box.querySelector('.mup-np')) return;
            const s = player().state();
            if (!s.track) return;
            const q = (sel) => box.querySelector(sel);
            q('.mup-np-t').textContent = s.track.name;
            q('.mup-np-a').textContent = [s.track.artist, s.track.album].filter(Boolean).join(' · ');
            const dur = s.duration || s.track.duration || 0;
            q('.mup-np-track b').style.width = (dur ? (s.position / dur) * 100 : 0).toFixed(2) + '%';
            q('.mup-np-times .at').textContent = f().clock(s.position);
            q('.mup-np-times .left').textContent = '−' + f().clock(Math.max(0, dur - s.position));
            q('[data-k="play"]').innerHTML = icon(s.playing ? 'pause' : 'play_arrow');
            q('[data-k="shuffle"]').classList.toggle('set', s.shuffle);
            const rep = q('[data-k="repeat"]');
            rep.innerHTML = icon(s.repeat === 'one' ? 'repeat_one' : 'repeat');
            rep.classList.toggle('set', s.repeat !== 'off');
            q('.mup-np-next').textContent = s.next ? `Next · ${s.next.name}` : '';
            paintLyrics(false);
        };

        // ----- the mini player -----
        const syncMini = () => {
            const s = player().state();
            const mini = $('.mup-mini');
            const show = !!s.track && open !== 'playing';
            root.classList.toggle('mup-has-mini', show);
            if (!show) return;
            const dur = s.duration || s.track.duration || 0;
            mini.innerHTML = `
                <span class="mup-mini-art">${artImg(s.track, 120, 'mu-img')}</span>
                <span class="mup-mini-t"><b>${esc(s.track.name)}</b><i>${esc(s.track.artist || '')}</i></span>
                <span class="mup-mini-b" data-k="play">${icon(s.playing ? 'pause' : 'play_arrow')}</span>
                <span class="mup-mini-b" data-k="next">${icon('skip_next')}</span>
                <i class="mup-mini-bar" style="width:${(dur ? (s.position / dur) * 100 : 0).toFixed(1)}%"></i>`;
        };
        $('.mup-mini').onclick = (ev) => {
            const b = ev.target.closest('[data-k]');
            if (b) {
                ev.stopPropagation();
                if (b.dataset.k === 'play') player().toggle(); else player().next();
                syncMini();
                return;
            }
            push('playing');
            drawPlaying();
            syncSheets();
        };

        // ----- states -----
        const setState = (kind) => {
            const box = $('.mup-state');
            root.dataset.state = kind || '';
            box.innerHTML = kind === 'loading' ? '<b>Getting your music…</b>'
                : kind === 'error' ? '<b>Jellyfin didn\'t answer</b><button type="button" class="mup-btn">Try again</button>'
                    : kind === 'empty' ? `<b>No music yet</b><span>${M().library()
                        ? 'The Music library is empty, or Jellyfin is still scanning it. Copy your music into the Music folder on the NAS and it turns up here.'
                        : 'Jellyfin has no Music library. Add one (content type Music) in Jellyfin\'s Dashboard → Libraries.'}</span>` : '';
            const retry = box.querySelector('button');
            if (retry) retry.onclick = reload;
        };
        const render = () => {
            if (!M().loaded()) { setState(M().error() ? 'error' : 'loading'); return; }
            if (!(M().albums().length || M().songs().length || M().playlists().length)) {
                setState('empty');
                $('.mup-chips').innerHTML = '';
                $('.mup-grid').innerHTML = '';
                return;
            }
            setState(null);
            if (!(TABS.find((t) => t.id === tab) || {}).list().length) {
                tab = (TABS.find((t) => (t.list() || []).length) || TABS[0]).id;
            }
            // the room takes the colour of what's playing, or the newest cover
            if (!open) setWash(player().state().track || M().recent()[0] || M().albums()[0]);
            drawChips();
            drawGrid();
            if (open === 'page') drawPage();
            else if (open === 'playing') drawPlaying();
            syncMini();
        };
        const reload = () => {
            if (!M().albums().length) setState('loading');
            M().load(true).catch(() => { if (!M().albums().length) setState('error'); });
        };

        let lastPaint = 0;
        const off = M().onChange((what) => {
            if (what === 'player') {
                if (open === 'playing') paintPlaying();
                if (Date.now() - lastPaint > 900 || !player().state().playing) {
                    lastPaint = Date.now();
                    syncMini();
                }
                return;
            }
            if (what === 'lyrics') { if (open === 'playing') paintLyrics(true); return; }
            render();
        });

        const onKey = (ev) => {
            if (!['Escape', 'Backspace', 'GoBack', 'BrowserBack'].includes(ev.key)) return;
            const t = ev.target;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
            ev.preventDefault();
            ev.stopPropagation();
            if (open) closeSheet(); else ctx.goBack();
        };
        document.addEventListener('keydown', onKey, true);

        render();
        reload();

        return {
            phone: true,
            show() { root.style.visibility = ''; },
            sync() {},
            state() { return { tab }; },
            teardown() {
                // the music keeps playing; only the screen goes
                off();
                document.removeEventListener('keydown', onKey, true);
                root.remove();
                if (window.HomerMusicStrip) window.HomerMusicStrip.sync();
            },
        };
    };

    window.HomerMusicPhone = { version: VERSION, create };
    if (window.HomerLayout) window.HomerLayout.register('music', { phone: true });
})();
