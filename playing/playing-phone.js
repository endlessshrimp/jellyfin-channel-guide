/*
 * HOMER Now Playing, phone layout. playing/playing.js draws this instead of
 * the TV stage when shared/layout.js says this screen is on a phone; both draw
 * from the same playing/playing-model.js.
 *
 * One card a thing, down the page, biggest thing first: the cover, what's on,
 * where it's playing, a progress bar that keeps moving, and the controls as
 * buttons big enough for a thumb. A grouped pair of speakers is one card
 * naming the rooms; an Apple TV card has Remote. The players that are on but
 * idle are a line at the bottom.
 *
 * There's no menu here: the phone's tab bar and top bar already have the
 * screens (shared/layout.js), so this is just the cards.
 *
 * window.HomerPlayingPhone = { create, version }
 */
(() => {
    const VERSION = '0.1.0';

    const TICK_MS = 500;

    const el = (tag, cls, html) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html != null) e.innerHTML = html;
        return e;
    };

    const create = (ctx) => {
        const { esc, icon, clock, positionNow, rooms, STATE_TEXT, btnIcon, btnLabel, BUTTONS, go } = ctx;
        const Model = () => window.HomerPlayingModel || null;

        const root = el('div', 'hn-phone homer-screen');
        root.id = 'hn-root';
        root.style.visibility = 'hidden'; // until the stylesheet is in
        root.innerHTML = `
            <div class="hnp-scroll">
                <div class="hnp-head"><h1>Playing</h1><span class="hnp-count"></span></div>
                <div class="hnp-cards"></div>
                <div class="hnp-empty" hidden>
                    <span class="material-icons" aria-hidden="true">graphic_eq</span>
                    <b>Nothing is playing</b>
                    <span>Start something on a TV, a speaker or in HOMER and it shows up here.</span>
                </div>
                <div class="hnp-idle" hidden></div>
            </div>`;
        document.body.appendChild(root);
        const cardsBox = root.querySelector('.hnp-cards');

        const nodes = new Map();
        let list = [];
        let byKey = new Map();

        const cardHtml = (c) => `
            <div class="hnp-top">
                <div class="hnp-art"><div class="hnp-art-img"></div><div class="hnp-art-none">${icon(c.icon || 'movie')}</div></div>
                <div class="hnp-text">
                    <div class="hnp-tags"></div>
                    <div class="hnp-title"></div>
                    <div class="hnp-sub"></div>
                    <div class="hnp-where"></div>
                </div>
            </div>
            <div class="hnp-bar"><b></b></div>
            <div class="hnp-times"><span class="hnp-at"></span><span class="hnp-of"></span></div>
            <div class="hnp-ctl"></div>`;

        const paintControls = (node, c) => {
            const box = node.querySelector('.hnp-ctl');
            const want = BUTTONS.filter((b) => c[b.can]).map((b) => b.k)
                .concat(c.canVolume || c.canStep ? ['vdown', 'vup'] : [], c.remote ? ['remote'] : []);
            // (the phone's row is a thumb's order: transport, volume, Remote)
            const sig = want.join(',');
            if (box.dataset.sig !== sig) {
                box.dataset.sig = sig;
                box.innerHTML = want.map((k) => {
                    if (k === 'vdown') return `<button type="button" class="hnp-b" data-k="vdown" aria-label="Volume down">${icon('remove')}</button>`;
                    if (k === 'vup') return `<button type="button" class="hnp-b" data-k="vup" aria-label="Volume up">${icon('add')}</button>`;
                    if (k === 'remote') return `<button type="button" class="hnp-b hnp-wide" data-k="remote">${icon('settings_remote')}Remote</button>`;
                    return `<button type="button" class="hnp-b${k === 'play' ? ' hnp-big' : ''}" data-k="${k}" aria-label="${esc(btnLabel(c, k))}">${icon(btnIcon(c, k))}</button>`;
                }).join('');
            }
            box.querySelectorAll('.hnp-b').forEach((b) => {
                const k = b.dataset.k;
                if (k === 'play' || k === 'mute') {
                    b.querySelector('.material-icons').textContent = btnIcon(c, k);
                    b.setAttribute('aria-label', btnLabel(c, k));
                    b.classList.toggle('hnp-off', k === 'mute' && c.muted);
                }
            });
        };

        const paintProgress = (node, c) => {
            const at = positionNow(c);
            const bar = node.querySelector('.hnp-bar');
            if (c.live || !c.duration) {
                bar.classList.add('hnp-none');
                bar.querySelector('b').style.width = '0%';
                node.querySelector('.hnp-at').textContent = c.live ? 'Live' : at > 1 ? clock(at) : '';
                node.querySelector('.hnp-of').textContent = '';
            } else {
                bar.classList.remove('hnp-none');
                bar.querySelector('b').style.width = Math.max(0, Math.min(100, (at / c.duration) * 100)) + '%';
                node.querySelector('.hnp-at').textContent = clock(at);
                node.querySelector('.hnp-of').textContent = '−' + clock(Math.max(0, c.duration - at));
            }
        };

        // the picture goes in once it has loaded, so a player whose artwork
        // isn't really there leaves its icon rather than a blank square
        const artFor = new Map();
        const setArt = (node, c) => {
            const box = node.querySelector('.hnp-art');
            const img = node.querySelector('.hnp-art-img');
            box.classList.add('hnp-art-empty');
            img.style.backgroundImage = '';
            if (!c.art) return;
            const want = c.art;
            const probe = new Image();
            probe.onload = () => {
                if (artFor.get(c.key) !== want || !node.isConnected) return;
                img.style.backgroundImage = `url("${want.replace(/"/g, '%22')}")`;
                box.classList.remove('hnp-art-empty');
            };
            probe.src = want;
        };
        const paintCard = (node, c) => {
            node.classList.toggle('hnp-paused', c.state === 'paused');
            if (artFor.get(c.key) !== c.art) {
                artFor.set(c.key, c.art);
                setArt(node, c);
            }
            const tags = [
                `<span class="hnp-tag hnp-${c.state}">${esc(STATE_TEXT[c.state] || c.state)}</span>`,
                c.badge ? `<span class="hnp-tag">${esc(c.badge)}</span>` : '',
                c.grouped ? `<span class="hnp-tag hnp-group">${esc(rooms(c))}</span>` : ''
            ].filter(Boolean).join('');
            const tagBox = node.querySelector('.hnp-tags');
            if (tagBox.dataset.sig !== tags) { tagBox.dataset.sig = tags; tagBox.innerHTML = tags; }
            node.querySelector('.hnp-title').textContent = c.title || c.where;
            node.querySelector('.hnp-sub').textContent = c.sub || '';
            node.querySelector('.hnp-sub').hidden = !c.sub;
            node.querySelector('.hnp-where').textContent = [c.grouped ? rooms(c) : c.where, c.room, c.who].filter(Boolean).join(' · ');
            paintControls(node, c);
            paintProgress(node, c);
        };

        const paint = () => {
            const m = Model();
            list = m ? m.cards() : [];
            byKey = new Map(list.map((c) => [c.key, c]));
            const sig = list.map((c) => c.key).join('|');
            if (cardsBox.dataset.sig !== sig) {
                cardsBox.dataset.sig = sig;
                cardsBox.innerHTML = '';
                nodes.clear();
                for (const c of list) {
                    const node = el('div', 'hnp-card', cardHtml(c));
                    node.dataset.key = c.key;
                    nodes.set(c.key, node);
                    cardsBox.appendChild(node);
                }
            }
            for (const c of list) {
                const node = nodes.get(c.key);
                if (node) paintCard(node, c);
            }
            root.querySelector('.hnp-empty').hidden = list.length > 0;
            const n = list.length;
            root.querySelector('.hnp-count').textContent = n ? `${n} ${n === 1 ? 'thing' : 'things'}` : '';
            const rest = m ? m.idle() : [];
            const idle = root.querySelector('.hnp-idle');
            idle.hidden = !rest.length;
            if (rest.length) {
                const ready = rest.filter((r) => !r.away);
                const away = rest.length - ready.length;
                idle.hidden = !ready.length && !away;
                idle.innerHTML = `<b>Ready</b><span>${ready.map((r) => esc(r.label)).join(' · ') || 'Nothing else is switched on'}</span>`
                    + (away ? `<em>${away} not responding</em>` : '');
            }
        };

        const onTap = (ev) => {
            const b = ev.target.closest('.hnp-b');
            if (!b) return;
            const card = b.closest('.hnp-card');
            const c = card && byKey.get(card.dataset.key);
            const m = Model();
            if (!c || !m) return;
            const k = b.dataset.k;
            if (k === 'remote') { go(`#/rooms?remote=${encodeURIComponent(c.remote)}`); return; }
            if (k === 'vdown' || k === 'vup') {
                const now = c.volume == null ? 50 : c.volume;
                const next = Math.max(0, Math.min(100, now + (k === 'vup' ? 5 : -5)));
                c.volume = next;
                paintControls(card, c);
                m.act(c, 'volume', next).catch(() => {});
                return;
            }
            m.act(c, k).then(paint).catch(() => paint());
        };
        cardsBox.addEventListener('click', onTap);

        const progressTimer = setInterval(() => {
            for (const c of list) {
                const node = nodes.get(c.key);
                if (node && c.state === 'playing') paintProgress(node, c);
            }
        }, TICK_MS);

        const m = Model();
        if (m) m.start();
        const offModel = m ? m.onChange(paint) : () => {};
        paint();

        return {
            phone: true,
            show() { root.style.visibility = ''; },
            sync: paint,
            teardown() {
                offModel();
                if (Model()) Model().stop();
                cardsBox.removeEventListener('click', onTap);
                clearInterval(progressTimer);
                root.remove();
            }
        };
    };

    window.HomerPlayingPhone = { version: VERSION, create };
    // tell the layout Now Playing has a phone layout
    if (window.HomerLayout) window.HomerLayout.register('playing', { phone: true });
})();
