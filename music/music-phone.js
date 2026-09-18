/*
 * HOMER Music, phone layout: drawn instead of the TV screen when
 * shared/layout.js says phone (music/music.js decides). The same library and
 * the same player (music/music-model.js), sized for a thumb:
 *
 *   Radio      the first chip: internet radio, which isn't in Jellyfin at all
 *              — SomaFM, the local Dallas stations, a search box across Radio
 *              Browser, and the stations starred on this device. Tap one to
 *              play it here; its sheet also offers a speaker (music/playon.js
 *              in its radio mode, which goes through Music Assistant).
 *   Browse     chips for Recently Added / Artists / Albums / Songs /
 *              Playlists / Genres, and the art two across under them
 *   A page     (tap a cover) a sheet: the art, Play / Shuffle / Play on… /
 *              Instant Mix,
 *              and the tracks — or, for an artist or a genre, their albums
 *   Playing    (tap the player) the big cover, the controls, a device button
 *              of its own, and the lyrics, the line you're on lit
 *
 * A star sits on every track row, on an album's header and on Now playing. It
 * is Jellyfin's favourite, not HOMER's, and the **Favorites** chip is the
 * tracks that have one.
 *
 * The player (.mup-inline-player) is the first thing in .mup-scroll whenever
 * something is loaded — not a screen you go find. It's a full-size card at
 * rest and a single sticky row once you scroll past it (music-phone.css). Its
 * own cast icon opens music/playon.js for whatever's playing; when nothing is
 * loaded here but HOMER remembers sending something to a speaker that's still
 * going, the player says so instead of looking idle. Leaving Music does not
 * stop the music: music/music-strip.js takes over on other screens.
 *
 * window.HomerMusicPhone = { create, version }
 */
(() => {
    const VERSION = '0.2.0';
    const M = () => window.HomerMusicModel;
    const RM = () => window.HomerRadioModel || null;
    const AR = () => window.HomerArr || null;

    const el = (tag, cls, html) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html != null) e.innerHTML = html;
        return e;
    };

    // Same list as the TV layout's: #/music draws everything but Radio, and
    // #/radio draws Radio on its own screen (ctx.radio says which).
    const ALL_TABS = [
        { id: 'radio', label: 'Radio', radio: true, list: () => (RM() ? RM().soma().concat(RM().local()) : []) },
        { id: 'recent', label: 'New', list: () => M().recent() },
        { id: 'artists', label: 'Artists', list: () => M().artists() },
        { id: 'albums', label: 'Albums', list: () => M().albums() },
        { id: 'songs', label: 'Songs', list: () => M().songs() },
        { id: 'favorites', label: 'Favorites', list: () => M().favorites() },
        { id: 'playlists', label: 'Playlists', list: () => M().playlists() },
        { id: 'genres', label: 'Genres', list: () => M().genres() },
    ];

    const create = (ctx) => {
        const { esc, icon, artImg, metaOf, subOf } = ctx;
        const onRadio = !!ctx.radio;
        const TABS = ALL_TABS.filter((t) => !!t.radio === onRadio);
        const player = () => M().player;
        const f = () => M().fmt;

        // Jellyfin's star: a real button beside the row, so a thumb on it
        // doesn't also start the track.
        const starBtn = (it) => {
            const on = M().isFavorite(it);
            const b = el('button', `mup-star${on ? ' on' : ''}`, icon(on ? 'star' : 'star_border'));
            b.type = 'button';
            b.setAttribute('aria-label', on ? 'Remove from Favorites' : 'Add to Favorites');
            b._item = it;
            b.onclick = (ev) => {
                ev.stopPropagation();
                ev.preventDefault();
                M().setFavorite(it, !M().isFavorite(it)).catch(() => {});
            };
            return b;
        };

        const paintStars = () => {
            document.querySelectorAll('.mu-phone .mup-star').forEach((b) => {
                const on = M().isFavorite(b._item);
                b.classList.toggle('on', on);
                b.innerHTML = icon(on ? 'star' : 'star_border');
                b.setAttribute('aria-label', on ? 'Remove from Favorites' : 'Add to Favorites');
            });
        };

        const root = el('div', 'homer-screen mu-phone' + (onRadio ? ' mu-radio-only' : ''));
        root.id = 'mu-root';
        root.style.visibility = 'hidden';
        root.innerHTML = `
            <div class="mup-wash"></div>
            <div class="mup-scroll">
                <div class="mup-inline-player"></div>
                <div class="mup-chips"></div>
                <div class="mup-grid"></div>
                <div class="mup-state"></div>
            </div>
            <div class="mup-sheet mup-page"></div>
            <div class="mup-sheet mup-playing"></div>`;
        document.body.appendChild(root);
        const $ = (s) => root.querySelector(s);

        let tab = onRadio ? 'radio' : 'recent';
        let radioQuery = '';
        let radioResults = null;
        let radioSaid = '';
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
            syncPlayer();
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
                if (!n && t.id !== tab && !t.radio) return; // Radio's chip is there before its stations are
                const c = el('button', `mup-chip${t.id === tab ? ' on' : ''}`, `${esc(t.label)}${n ? ` <i>${n}</i>` : ''}`);
                c.type = 'button';
                c.onclick = () => { tab = t.id; drawChips(); drawGrid(); $('.mup-scroll').scrollTop = 0; };
                box.appendChild(c);
            });
        };
        // ----- Radio -----
        const stationTile = (st) => `<span class="mu-img mu-noart mu-st-tile" data-kind="station"
            style="--st-h:${RM() ? RM().hue(st) : 210}"><span>${esc(RM() ? RM().initials(st) : '?')}</span></span>`;
        const stationArt = (st, h) => {
            const url = RM() ? RM().art(st, h) : '';
            if (url) return `<img class="mu-img mu-st-img" src="${esc(url)}" alt="" draggable="false" loading="lazy">`;
            return stationTile(st);
        };
        // A Radio Browser favicon is as likely to 404 as not, and when it does
        // load it is often a 32px .ico blown up to fill a card. Either way the
        // letter tile is the better picture, so measure it (off to one side,
        // out of the same cache) and swap the tile back in when it's a crumb.
        const MIN_ART = 64;
        const bindStationArt = (host, st) => {
            const img = host && host.querySelector('.mu-st-img');
            if (!img) return host;
            const tile = () => { if (img.parentNode) img.outerHTML = stationTile(st); };
            img.onerror = tile;
            if (st.source === 'soma') return host; // SomaFM draws its own, properly
            const probe = new Image();
            probe.onload = () => { if (probe.naturalWidth < MIN_ART) tile(); };
            probe.onerror = tile;
            probe.src = img.src;
            return host;
        };
        const playStation = (st) => {
            const R = RM();
            if (!R) return;
            if (!R.playable(st)) { showStation(st); return; } // it can't play here; the sheet says where it can
            R.tune(st).then((t) => {
                if (!t) { showStation(st); return; }
                player().play([t], 0, { source: { kind: 'station', id: st.id, name: st.name } });
                push('playing');
                drawPlaying();
                syncSheets();
            }).catch(() => showStation(st));
        };
        const playOnStation = (st) => {
            const p = PO();
            if (!p || !st) return;
            p.open(document.body, {
                tv: false,
                station: st,
                onHere: () => playStation(st),
                onNowPlaying: () => { push('playing'); drawPlaying(); syncSheets(); },
            });
        };
        const stationCard = (st) => {
            const can = RM() ? RM().playable(st) : false;
            const card = el('button', `mup-card station${can ? '' : ' off'}`, `
                <span class="mup-card-art">${stationArt(st, 320)}</span>
                ${st.source === 'soma' ? '<span class="mup-st-badge">SomaFM</span>' : ''}
                <span class="mup-card-t">${esc(st.name)}</span>
                <span class="mup-card-s">${esc(st.sub || '')}</span>`);
            card.type = 'button';
            card.onclick = () => showStation(st);
            bindStationArt(card, st);
            return card;
        };
        const drawRadio = (box) => {
            const R = RM();
            box.className = 'mup-grid mup-radio';
            box.innerHTML = '';
            if (!R) { box.innerHTML = '<div class="mup-note">Radio didn\u2019t load.</div>'; return; }
            const search = el('div', 'mup-radio-search', `
                ${icon('search')}
                <input class="mup-radio-input" type="search" enterkeyhint="search" autocomplete="off"
                    spellcheck="false" placeholder="Search Radio Browser" value="${esc(radioQuery)}">
                <button type="button" class="mup-radio-go">Search</button>`);
            const input = search.querySelector('.mup-radio-input');
            const go = () => {
                const term = (input.value || '').trim();
                radioQuery = term;
                if (term.length < 2) { radioResults = null; radioSaid = ''; drawGrid(); return; }
                radioSaid = 'Searching…';
                R.search(term).then((list) => {
                    radioResults = list;
                    radioSaid = list.length ? `${list.length} found` : 'Nothing found';
                    if (tab === 'radio') drawGrid();
                }).catch((err) => { radioSaid = err.message; if (tab === 'radio') drawGrid(); });
                drawGrid();
            };
            input.oninput = () => { radioQuery = input.value; };
            input.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); go(); } };
            search.querySelector('.mup-radio-go').onclick = go;
            box.appendChild(search);

            const section = (title, note, list) => {
                if (!list || !list.length) return;
                box.appendChild(el('div', 'mup-radio-head', `<h3>${esc(title)}</h3>${note ? `<span>${esc(note)}</span>` : ''}`));
                const wall = el('div', 'mup-radio-wall');
                list.forEach((st) => wall.appendChild(stationCard(st)));
                box.appendChild(wall);
            };
            if (radioResults) section(radioResults.length ? 'Found' : 'Nothing found', radioSaid, radioResults);
            section('Favorites', 'Kept on this phone', R.favorites());
            section('Local', 'Dallas–Fort Worth', R.local());
            section('SomaFM', 'Listener-supported', R.soma());
            if (!box.querySelector('.mup-card')) {
                box.appendChild(el('div', 'mup-note', R.loaded() ? 'No stations. Search above.' : 'Finding stations…'));
            }
        };

        // a station's sheet: play here, send it to a speaker, or star it
        let stationItem = null;
        const showStation = (st) => {
            stationItem = st;
            pageItem = null;
            push('page');
            drawStation();
            syncSheets();
        };
        const drawStation = () => {
            const box = $('.mup-page');
            const st = stationItem;
            const R = RM();
            if (!st || !R) { box.innerHTML = ''; return; }
            const p = R.playUrl(st);
            const canHere = R.playable(st);
            const np = liveNow[st.id];
            box.innerHTML = `
                <div class="mup-bar"><button type="button" class="mup-back">${icon('arrow_back_ios_new')}</button><span>${esc(st.name)}</span></div>
                <div class="mup-sheet-scroll">
                    <div class="mup-page-head">
                        <div class="mup-page-art">${stationArt(st, 600)}</div>
                        <h1>${esc(st.name)}</h1>
                        <div class="mup-page-sub">${esc(st.sub || '')}</div>
                        <div class="mup-page-meta">${[st.codec && (st.bitrate ? `${st.codec} ${st.bitrate}k` : st.codec),
                            st.source === 'soma' ? 'SomaFM' : st.local ? 'Local' : 'Radio Browser'].filter(Boolean)
                            .map((x) => `<span>${esc(x)}</span>`).join('')}</div>
                        <div class="mup-page-star"></div>
                        <div class="mup-page-acts">
                            ${canHere ? `<button type="button" class="mup-btn primary" data-a="play">${icon('play_arrow')}Play</button>` : ''}
                            <button type="button" class="mup-btn${canHere ? '' : ' primary'}" data-a="on">${icon('speaker')}Play on…</button>
                        </div>
                    </div>
                    <div class="mup-page-body">
                        ${np && (np.title || np.artist) ? `<div class="mup-st-note"><span class="mup-live-pill">On now</span> ${esc([np.artist, np.title].filter(Boolean).join(' — '))}</div>` : ''}
                        ${st.overview ? `<div class="mup-st-note">${esc(st.overview)}</div>` : ''}
                        <div class="mup-st-note">${esc(p.url || p.pending
                            ? (p.proxied ? 'Plain http, so HOMER plays it through the NAS helper.' : 'Plays here and on a speaker.')
                            : (p.why || ''))}</div>
                        <div class="mup-st-note">${esc(st.source === 'soma'
                            ? 'SomaFM publishes what it\u2019s playing, so the track shows up on Now playing.'
                            : 'Track information depends on the station: HOMER asks the NAS helper for the stream\u2019s own metadata, and many talk and sports stations send none.')}</div>
                    </div>
                </div>`;
            box.querySelector('.mup-back').onclick = closeSheet;
            bindStationArt(box, st);
            const star = el('button', `mup-star${R.isFavorite(st) ? ' on' : ''}`, icon(R.isFavorite(st) ? 'star' : 'star_border'));
            star.type = 'button';
            star.onclick = () => { R.toggleFavorite(st); drawStation(); if (tab === 'radio') drawGrid(); };
            box.querySelector('.mup-page-star').appendChild(star);
            const playBtn = box.querySelector('[data-a="play"]');
            if (playBtn) playBtn.onclick = () => playStation(st);
            box.querySelector('[data-a="on"]').onclick = () => playOnStation(st);
        };

        const drawGrid = () => {
            const box = $('.mup-grid');
            const t = TABS.find((x) => x.id === tab) || TABS[0];
            if (t.radio) { drawRadio(box); return; }
            const list = t.list() || [];
            const rows = tab === 'songs' || tab === 'favorites';
            box.className = `mup-grid ${rows ? 'list' : 'wall'}`;
            box.innerHTML = '';
            if (!list.length) {
                box.innerHTML = `<div class="mup-note">${tab === 'favorites'
                    ? 'No favorites yet. Tap the star beside a track.' : 'Nothing here yet.'}</div>`;
                return;
            }
            if (rows) {
                const name = tab === 'favorites' ? 'Favorites' : 'Songs';
                list.slice(0, 400).forEach((s, i) => {
                    const row = el('div', 'mup-song-row');
                    const btn = el('button', 'mup-song', `
                        <span class="mup-song-art">${artImg(s, 120, 'mu-img')}</span>
                        <span class="mup-song-t"><b>${esc(s.name)}</b><i>${esc(s.artist || '')}</i></span>
                        <span class="mup-song-d">${f().clock(s.duration)}</span>`);
                    btn.type = 'button';
                    btn.onclick = () => {
                        player().play(list, i, { source: { kind: tab, name } });
                        push('playing');
                        drawPlaying();
                        syncSheets();
                    };
                    row.appendChild(btn);
                    row.appendChild(starBtn(s));
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
            stationItem = null;
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
        // Play on…: the same picker the TV screen uses (music/playon.js), as a
        // sheet from the bottom. Only there when Home Assistant is connected.
        const PO = () => window.HomerPlayOn || null;
        const canPlayOn = () => {
            const p = PO();
            const h = window.HomerHA;
            if (!p || !h || !h.isSetUp || !h.isSetUp()) return false;
            try { return p.devices().length > 0; } catch { return false; }
        };
        const playOnPage = () => {
            const it = pageItem;
            const p = PO();
            if (!it || !p) return;
            tracksOf(it).then((list) => {
                if (!list.length) return;
                p.open(document.body, {
                    tv: false,
                    item: it,
                    tracks: list,
                    onHere: () => playPage(false),
                    onNowPlaying: () => { push('playing'); drawPlaying(); syncSheets(); },
                });
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
        // The device button is only offered when Home Assistant has speakers to
        // offer, and on a phone Home Assistant usually finishes connecting
        // AFTER this page has been drawn — so whether the row carries it is
        // kept in step rather than decided once, when the answer was still no.
        const syncPageActs = () => {
            const acts = $('.mup-page-acts');
            if (!acts) return;
            const have = acts.querySelector('[data-a="on"]');
            if (pageItem && canPlayOn()) {
                if (!have) {
                    const b = el('button', 'mup-btn', `${icon('speaker')}Play on…`);
                    b.type = 'button';
                    b.dataset.a = 'on';
                    acts.insertBefore(b, acts.querySelector('[data-a="mix"]'));
                    b.onclick = playOnPage;
                } else if (!have.onclick) have.onclick = playOnPage;
            } else if (have) have.remove();
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
                        <div class="mup-page-star"></div>
                        <div class="mup-page-acts">
                            <button type="button" class="mup-btn primary" data-a="play">${icon('play_arrow')}Play</button>
                            <button type="button" class="mup-btn" data-a="shuffle">${icon('shuffle')}Shuffle</button>
                            ${canPlayOn() ? `<button type="button" class="mup-btn" data-a="on">${icon('speaker')}Play on…</button>` : ''}
                            <button type="button" class="mup-btn" data-a="mix">${icon('radio')}Mix</button>
                        </div>
                    </div>
                    <div class="mup-page-body"></div>
                </div>`;
            box.querySelector('.mup-back').onclick = closeSheet;
            box.querySelector('.mup-page-star').appendChild(starBtn(it));
            box.querySelector('[data-a="play"]').onclick = () => playPage(false);
            box.querySelector('[data-a="shuffle"]').onclick = () => playPage(true);
            box.querySelector('[data-a="mix"]').onclick = mixPage;
            syncPageActs();
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
                const line = el('div', 'mup-track-row');
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
                line.appendChild(row);
                line.appendChild(starBtn(t));
                body.appendChild(line);
            });
        };

        // ----- Now playing -----
        const drawPlaying = () => {
            const box = $('.mup-playing');
            const s = player().state();
            if (!s.track) { box.innerHTML = '<div class="mup-note">Nothing is playing.</div>'; return; }
            setWash(s.track);
            box.innerHTML = `
                <div class="mup-bar"><button type="button" class="mup-back">${icon('expand_more')}</button><span>${esc(s.source ? s.source.name : 'Now playing')}</span><button type="button" class="mup-back mup-cast-top" data-a="cast" aria-label="Play on…">${icon('cast')}</button></div>
                <div class="mup-np">
                    <div class="mup-np-art">${artImg(s.track, 700, 'mu-img')}</div>
                    <h1 class="mup-np-t"></h1>
                    <div class="mup-np-a"></div>
                    <div class="mup-np-lidarr"></div>
                    <div class="mup-np-seek"><span class="mup-np-track"><b></b></span><span class="mup-np-times"><i class="at"></i><i class="left"></i></span></div>
                    <div class="mup-np-ctl">
                        <button type="button" class="mup-rb" data-k="fav">${icon('star_border')}</button>
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
            box.querySelector('.mup-cast-top').onclick = playOnHere;
            syncCastTop();
            const P = player();
            const acts = {
                fav: () => { const t = P.state().track; if (t) M().setFavorite(t, !M().isFavorite(t)).catch(() => {}); },
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
        // What a live station is playing, where anyone says: SomaFM publishes
        // it, and for everyone else the NAS helper reads the stream's own ICY
        // metadata (a browser can't).
        const liveNow = {};
        const pollLive = () => {
            const s = player().state();
            const t = s.track;
            if (!t || !t.live || !RM()) return;
            const st = RM().station(t.stationId);
            if (!st) return;
            RM().nowPlaying(st).then((np) => {
                const was = liveNow[t.stationId];
                const same = (was && np && was.title === np.title && was.artist === np.artist) || (!was && !np);
                liveNow[t.stationId] = np;
                if (!same) { paintPlaying(); drawLyrics(); }
            });
        };
        const liveTimer = setInterval(pollLive, 20000);

        // ----- "Get this album" from a radio track (shared/arr.js + Lidarr) -----
        // Same idea as the TV screen (music/music.js): artist+title (or
        // artist+album) goes to Lidarr, shared/arr.js ranks what comes back
        // so the real album beats a tribute, and nothing is added without a
        // tap — the same two-press confirm as every other Get it button.
        let lidarrAsked = '';
        let lidarrState = null; // null | {status, candidates, top}
        let lidarrShowMore = false;
        let lidarrRunner = null;
        const arrRunner = () => {
            if (!lidarrRunner && AR()) {
                lidarrRunner = AR().runner({
                    hint: () => 'Tap again',
                    // The button's own label already says "Get it? / Tap
                    // again" while armed; only an error needs saying at all,
                    // as a note under the row (there's no toast on the phone).
                    toast: (tt) => {
                        if (tt.kind !== 'err') return;
                        const box = $('.mup-np-lidarr');
                        if (!box) return;
                        box.querySelectorAll('.mup-lidarr-err').forEach((e) => e.remove());
                        const note = document.createElement('div');
                        note.className = 'mup-note small mup-lidarr-err';
                        note.textContent = tt.text;
                        box.appendChild(note);
                        setTimeout(() => note.remove(), 4000);
                    },
                    update: (v) => {
                        if (lidarrState && lidarrState.candidates) {
                            const k = AR().key(v);
                            lidarrState.candidates = lidarrState.candidates.map((c) => (AR().key(c) === k ? v : c));
                            if (lidarrState.top && AR().key(lidarrState.top) === k) lidarrState.top = v;
                        }
                        paintLidarrSection();
                    },
                });
            }
            return lidarrRunner;
        };
        const lidarrKnown = (t) => {
            const np = t && t.live && liveNow[t.stationId];
            if (!np || !np.title || !np.artist) return null;
            return { artist: np.artist, title: np.title, album: np.album || '' };
        };
        const checkLidarr = (t) => {
            const known = lidarrKnown(t);
            const ask = known ? [t.stationId, known.artist, known.title, known.album].join('|') : '';
            if (ask === lidarrAsked) return;
            lidarrAsked = ask;
            lidarrShowMore = false;
            if (!known || !AR()) { lidarrState = null; return; }
            lidarrState = { status: 'looking' };
            const q = known.album ? { artist: known.artist, album: known.album } : { artist: known.artist, title: known.title };
            AR().lookupAlbum(q).then((res) => {
                if (ask !== lidarrAsked) return;
                if (res.error || !res.albums || !res.albums.length) lidarrState = { status: 'none' };
                else {
                    const ranked = AR().rankAlbums(res.albums, known).slice(0, 5);
                    lidarrState = { status: 'found', candidates: ranked, top: ranked[0] };
                }
                paintLidarrSection();
            }).catch(() => {
                if (ask === lidarrAsked) { lidarrState = { status: 'error' }; paintLidarrSection(); }
            });
        };
        const lidarrRow = (v, { main = false } = {}) => {
            const a = AR().actions(v)[0];
            const runner = arrRunner();
            const armed = !!(a && runner && runner.armed(a, v));
            const btn = a
                ? `<button type="button" class="mup-lidarr-get${armed ? ' armed' : ''}" data-lidarr-k="${esc(AR().key(v))}">${esc(runner.label(a, v))}</button>`
                : '';
            return `<div class="mup-lidarr-row${main ? ' main' : ''}">
                ${v.poster ? `<img class="mup-lidarr-art" src="${esc(v.poster)}" alt="">` : `<span class="mup-lidarr-art mup-lidarr-noart">${icon('album')}</span>`}
                <div class="mup-lidarr-text"><b>${esc(v.title)}</b><span>${esc(v.artist || '')}${v.year ? ' · ' + v.year : ''}</span>${AR().chipHtml(v)}</div>
                ${btn}
            </div>`;
        };
        const paintLidarrSection = () => {
            const box = $('.mup-np-lidarr');
            if (!box) return;
            if (!lidarrState) { box.innerHTML = ''; return; }
            if (lidarrState.status === 'looking') { box.innerHTML = `<div class="mup-note small">Looking for this album in Lidarr…</div>`; return; }
            if (lidarrState.status === 'error') { box.innerHTML = `<div class="mup-note small">Couldn’t reach Lidarr just now.</div>`; return; }
            if (lidarrState.status === 'none') { box.innerHTML = `<div class="mup-note small">Couldn’t find an album for this in Lidarr.</div>`; return; }
            const [top, ...rest] = lidarrState.candidates;
            const ambiguous = rest.length > 0;
            box.innerHTML = lidarrRow(top, { main: true })
                + (ambiguous ? `<button type="button" class="mup-lidarr-more">${lidarrShowMore ? 'Hide other matches' : `Not this one? ${rest.length} more match${rest.length === 1 ? '' : 'es'}`}</button>` : '')
                + (ambiguous && lidarrShowMore ? rest.map((v) => lidarrRow(v)).join('') : '');
            box.querySelectorAll('[data-lidarr-k]').forEach((b) => {
                const v = lidarrState.candidates.find((c) => AR().key(c) === b.dataset.lidarrK);
                const a = v && AR().actions(v)[0];
                if (v && a) b.onclick = () => arrRunner().press(a, v);
            });
            const moreBtn = box.querySelector('.mup-lidarr-more');
            if (moreBtn) moreBtn.onclick = () => { lidarrShowMore = !lidarrShowMore; paintLidarrSection(); };
        };

        let lyricsFor = '';
        const drawLyrics = () => {
            const box = $('.mup-lyrics');
            const s = player().state();
            if (!box || !s.track) return;
            if (s.track.live) {
                const st = RM() && RM().station(s.track.stationId);
                const np = liveNow[s.track.stationId];
                box.innerHTML = `<div class="mup-note">${np && (np.title || np.artist)
                    ? esc([np.artist, np.title].filter(Boolean).join(' — '))
                    : 'No track information from this station.'}</div>
                    <div class="mup-note">${esc(st && st.source === 'soma'
                        ? 'SomaFM publishes what it\u2019s playing.'
                        : 'A browser can\u2019t read a stream\u2019s metadata, so HOMER asks the NAS helper; talk and sports stations usually send none.')}</div>`;
                pollLive();
                return;
            }
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
        let lastCastPaintAt = 0;
        const paintPlaying = () => {
            const box = $('.mup-playing');
            if (!box || !box.querySelector('.mup-np')) return;
            const s = player().state();
            if (!s.track) return;
            const q = (sel) => box.querySelector(sel);
            const live = s.track.live;
            const np = live ? liveNow[s.track.stationId] : null;
            q('.mup-np-t').textContent = s.track.name;
            q('.mup-np-a').textContent = live
                ? (np && (np.title || np.artist) ? [np.artist, np.title].filter(Boolean).join(' — ') : (s.track.artist || ''))
                : [s.track.artist, s.track.album].filter(Boolean).join(' · ');
            if (live) checkLidarr(s.track); else { lidarrAsked = ''; lidarrState = null; }
            paintLidarrSection();
            const dur = s.duration || (live ? 0 : s.track.duration) || 0;
            box.classList.toggle('mup-live', !!live);
            q('.mup-np-track b').style.width = (live ? 100 : dur ? (s.position / dur) * 100 : 0).toFixed(2) + '%';
            q('.mup-np-times .at').textContent = live ? 'Live' : f().clock(s.position);
            q('.mup-np-times .left').textContent = live ? f().clock(s.position) + ' in' : '−' + f().clock(Math.max(0, dur - s.position));
            q('[data-k="play"]').innerHTML = icon(s.playing ? 'pause' : 'play_arrow');
            const fav = q('[data-k="fav"]');
            if (fav) {
                fav._item = s.track;
                const on = M().isFavorite(s.track);
                fav.innerHTML = icon(on ? 'star' : 'star_border');
                fav.classList.toggle('star-set', on);
            }
            q('[data-k="shuffle"]').classList.toggle('set', s.shuffle);
            const rep = q('[data-k="repeat"]');
            rep.innerHTML = icon(s.repeat === 'one' ? 'repeat_one' : 'repeat');
            rep.classList.toggle('set', s.repeat !== 'off');
            q('.mup-np-next').textContent = s.next ? `Next · ${s.next.name}` : '';
            // devices() walks every Home Assistant room, so this checks in
            // once a second, not four times, while the seek bar ticks. Home
            // Assistant's own events (below) call syncCastTop() directly and
            // aren't subject to this.
            if (Date.now() - lastCastPaintAt > 1000) {
                lastCastPaintAt = Date.now();
                syncCastTop();
            }
            paintLyrics(false);
        };

        // ----- the inline player: the first thing in the list -----
        //
        // Not a floating bar and not a screen you go find — it's the top row
        // of .mup-scroll, so it scrolls with everything else until it hits
        // the top of the screen, then (music-phone.css) sticks there and
        // music-phone.css shrinks it to a single row as more of the list
        // slides underneath. This only builds what's inside it and flips the
        // "past the fold" class at a scroll threshold with a little
        // hysteresis so it can't flicker right at the edge.
        const COMPACT_AT = 46;
        const EXPAND_AT = 16;
        let compact = false;
        const activeCast = () => {
            const p = PO();
            return p && p.current ? p.current() : null;
        };
        // The big Now Playing sheet's own cast button (top bar): it can't
        // rely on paintPlaying()'s own tick — that only runs when HOMER's
        // local audio moves, and casting away is exactly the case where it
        // might not be. Home Assistant's own events (below) call this
        // straight through, unthrottled; paintPlaying() throttles it itself.
        const syncCastTop = () => {
            const box = $('.mup-playing');
            const castTop = box && box.querySelector('.mup-cast-top');
            if (!castTop) return;
            const on = !!activeCast();
            castTop.classList.toggle('set', on);
            castTop.innerHTML = icon(on ? 'cast_connected' : 'cast');
        };
        // The device button, for whatever HOMER itself is playing right now
        // — the same picker the album sheet and the Radio sheet use. A
        // station goes through Radio's own speakers (Music Assistant); a
        // track goes through the album picker in its single-track shape,
        // since resending "the album" from partway through it would restart
        // it, not follow where you are.
        const playOnHere = () => {
            const s = player().state();
            const t = s.track;
            const p = PO();
            if (!p || !t) return;
            if (t.live && RM()) {
                const st = RM().station(t.stationId);
                if (st) { playOnStation(st); return; }
            }
            p.open(document.body, {
                tv: false,
                item: t,
                tracks: [t],
                onHere: () => {}, // it's already playing here
                onNowPlaying: () => { push('playing'); drawPlaying(); syncSheets(); },
            });
        };
        let ipFor = ''; // what the row's markup was last built for
        const syncPlayer = () => {
            const box = $('.mup-inline-player');
            const s = player().state();
            const cur = !s.track ? activeCast() : null;
            const show = (!!s.track || !!cur) && open !== 'playing';
            root.classList.toggle('mup-has-player', show);
            if (!show) { ipFor = ''; return; }
            box.classList.toggle('cast-only', !s.track);
            if (s.track) {
                const dur = s.duration || s.track.duration || 0;
                const key = 'p:' + s.track.id + '|' + s.playing;
                if (ipFor !== key) {
                    ipFor = key;
                    box.innerHTML = `
                        <div class="mup-ip-row">
                            <button type="button" class="mup-ip-open" data-a="open">
                                <span class="mup-ip-art">${artImg(s.track, 160, 'mu-img')}</span>
                                <span class="mup-ip-body">
                                    <b class="mup-ip-t">${esc(s.track.name)}</b>
                                    <i class="mup-ip-a">${esc(s.track.artist || '')}</i>
                                </span>
                            </button>
                            <button type="button" class="mup-ip-b mup-ip-cast" data-a="cast" aria-label="Play on…">${icon('cast')}</button>
                            <button type="button" class="mup-ip-b mup-ip-play" data-a="play" aria-label="Play / pause">${icon(s.playing ? 'pause' : 'play_arrow')}</button>
                            <button type="button" class="mup-ip-b mup-ip-next" data-a="next" aria-label="Next">${icon('skip_next')}</button>
                        </div>
                        <i class="mup-ip-bar"></i>`;
                }
                box.querySelector('.mup-ip-bar').style.width = (dur ? (s.position / dur) * 100 : 0).toFixed(1) + '%';
                const castBtn = box.querySelector('.mup-ip-cast');
                if (castBtn) {
                    const on = !!activeCast();
                    castBtn.classList.toggle('set', on);
                    castBtn.innerHTML = icon(on ? 'cast_connected' : 'cast');
                }
            } else if (cur) {
                const key = 'c:' + cur.device.id + '|' + (cur.info.name || '');
                if (ipFor !== key) {
                    ipFor = key;
                    box.innerHTML = `
                        <div class="mup-ip-row">
                            <span class="mup-ip-open mup-ip-status">
                                <span class="mup-ip-art">${cur.info.art ? `<img class="mu-img" src="${esc(cur.info.art)}" alt="" draggable="false">` : icon('cast_connected')}</span>
                                <span class="mup-ip-body">
                                    <b class="mup-ip-t">${esc(cur.info.name || 'Playing')}</b>
                                    <i class="mup-ip-a">${icon('cast_connected')}On ${esc(cur.device.label || cur.device.name)}</i>
                                </span>
                            </span>
                        </div>`;
                }
            }
        };
        $('.mup-inline-player').onclick = (ev) => {
            const a = ev.target.closest('[data-a]');
            if (!a) return;
            ev.stopPropagation();
            const k = a.dataset.a;
            if (k === 'play') { player().toggle(); syncPlayer(); }
            else if (k === 'next') { player().next(); syncPlayer(); }
            else if (k === 'cast') playOnHere();
            else if (k === 'open') { push('playing'); drawPlaying(); syncSheets(); }
        };
        const onScroll = () => {
            const y = $('.mup-scroll').scrollTop;
            if (!compact && y > COMPACT_AT) { compact = true; root.classList.add('mup-player-compact'); }
            else if (compact && y < EXPAND_AT) { compact = false; root.classList.remove('mup-player-compact'); }
        };
        $('.mup-scroll').addEventListener('scroll', onScroll, { passive: true });

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
            if (open === 'page') { if (stationItem) drawStation(); else drawPage(); }
            else if (open === 'playing') drawPlaying();
            syncPlayer();
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
                    syncPlayer();
                }
                return;
            }
            if (what === 'lyrics') { if (open === 'playing') paintLyrics(true); return; }
            if (what === 'favorite') {
                // repaint the stars where they are rather than rebuild the
                // lists: a thumb is usually still on one
                paintStars();
                if (open === 'playing') paintPlaying();
                drawChips();
                if (tab === 'favorites' && !open) drawGrid();
                return;
            }
            render();
        });

        // Radio is its own model, loaded beside the library
        const offRadio = RM() ? RM().onChange(() => {
            drawChips();
            if (tab === 'radio' && !open) drawGrid();
            if (open === 'page' && stationItem) drawStation();
        }) : () => {};
        if (RM()) RM().load().catch(() => {});
        // A speaker starting, stopping, or being taken by someone else's
        // remote changes the inline player's own state — the cast-only row,
        // and the device button's highlight — independent of anything HOMER
        // itself is doing.
        const offHA = window.HomerHA && window.HomerHA.onChange
            ? window.HomerHA.onChange(() => { syncPlayer(); syncPageActs(); if (open === 'playing') syncCastTop(); })
            : () => {};

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

        // the top bar's screen name (MUSIC) comes back here: close any open
        // sheet, in order, until browse is what's left
        const offScreenHome = window.HomerLayout && window.HomerLayout.setScreenHome
            ? window.HomerLayout.setScreenHome(() => {
                if (!open) return false;
                while (sheets.length) closeSheet();
                return true;
            }, { atTop: () => !open })
            : () => {};

        return {
            phone: true,
            radio: onRadio,
            show() { root.style.visibility = ''; },
            sync() {},
            state() { return { tab }; },
            teardown() {
                // the music keeps playing; only the screen goes
                if (PO()) PO().close();
                offScreenHome();
                off();
                offRadio();
                offHA();
                $('.mup-scroll').removeEventListener('scroll', onScroll);
                clearInterval(liveTimer);
                if (lidarrRunner) lidarrRunner.dispose();
                document.removeEventListener('keydown', onKey, true);
                root.remove();
                if (window.HomerMusicStrip) window.HomerMusicStrip.sync();
            },
        };
    };

    window.HomerMusicPhone = { version: VERSION, create };
    if (window.HomerLayout) window.HomerLayout.register('music', { phone: true });
})();
