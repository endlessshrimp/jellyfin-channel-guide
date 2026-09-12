/*
 * Channel Guide: full-screen set-top-box guide for Jellyfin (prototype).
 * Runs inside a signed-in Jellyfin Web page and uses that session's API access.
 * Remote/keyboard: arrows move, Enter opens the channel, Esc closes.
 */
(() => {
    const BASE = (document.currentScript && document.currentScript.src.replace(/guide\.js.*$/, '')) || '';
    const WINDOW_MIN = 180;
    const STAGE_W = 1920;
    const GRID_W = STAGE_W - 72 * 2 - 300;
    const PX_PER_MIN = GRID_W / WINDOW_MIN;
    const ROW_H = 76;
    const VISIBLE_ROWS = 5;
    const PLACEHOLDER = /\(\w+\. \d\d:\d\d - \d\d:\d\d\)$/;

    document.getElementById('cg-root')?.remove();
    document.getElementById('cg-css')?.remove();
    const css = document.createElement('link');
    css.id = 'cg-css';
    css.rel = 'stylesheet';
    css.href = BASE + 'guide.css?t=' + Date.now();
    document.head.appendChild(css);

    const creds = JSON.parse(localStorage.getItem('jellyfin_credentials') || '{}');
    const server = (creds.Servers || [])[0];
    if (!server || !server.AccessToken) {
        console.warn('[Channel Guide] Not signed in to Jellyfin');
        return;
    }
    const headers = {
        Authorization: `MediaBrowser Client="Channel Guide", Device="Web", DeviceId="channel-guide", Version="0.1.0", Token="${server.AccessToken}"`
    };
    const api = (path) => fetch(path, { headers }).then((r) => r.json());

    const el = (tag, cls, html) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html != null) e.innerHTML = html;
        return e;
    };
    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const fmtTime = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const fmtShort = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?(AM|PM)$/i, '');

    // ---------- Shell ----------
    const root = el('div');
    root.id = 'cg-root';
    const stage = el('div');
    stage.id = 'cg-stage';
    root.appendChild(stage);
    document.body.appendChild(root);

    stage.innerHTML = `
        <div class="cg-topbar">
            <div class="cg-brand"><span class="cg-brand-mark"></span>HOMER<span class="cg-brand-sub">GUIDE</span></div>
            <div class="cg-clock"><div class="cg-clock-time"></div><div class="cg-clock-date"></div></div>
        </div>
        <div class="cg-info">
            <div class="cg-info-text">
                <div class="cg-info-channel"></div>
                <div class="cg-info-title">Loading guide…</div>
                <div class="cg-info-meta"></div>
                <div class="cg-info-desc"></div>
            </div>
            <div class="cg-preview">
                <div class="cg-preview-art"></div>
                <div class="cg-preview-logo"></div>
                <div class="cg-preview-badge"></div>
                <div class="cg-preview-bar"><span class="cg-preview-left"></span><span class="cg-preview-right"></span></div>
                <div class="cg-progress"><i></i></div>
            </div>
        </div>
        <div class="cg-grid">
            <div class="cg-timebar"><div class="cg-timebar-day"><b>TODAY</b></div></div>
            <div class="cg-rows"><div class="cg-rows-inner"></div><div class="cg-needle"></div></div>
        </div>
        <div class="cg-legend">
            <span><span class="cg-key">▲▼</span>Channels</span>
            <span><span class="cg-key">◀▶</span>Time</span>
            <span><span class="cg-key">OK</span>Watch</span>
            <span><span class="cg-key rec">●</span>Record</span>
            <span class="spacer"></span>
            <span><span class="cg-key">ESC</span>Exit guide</span>
        </div>`;

    const $ = (s) => stage.querySelector(s);

    const fit = () => {
        const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
        stage.style.transform = `translate(-50%, -50%) scale(${s})`;
    };
    fit();
    window.addEventListener('resize', fit);

    const tick = () => {
        const d = new Date();
        $('.cg-clock-time').textContent = fmtTime(d);
        $('.cg-clock-date').textContent = d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
    };
    tick();
    const clockTimer = setInterval(tick, 1000);

    // ---------- Time window ----------
    const now = new Date();
    const winStart = new Date(now);
    winStart.setMinutes(now.getMinutes() < 30 ? 0 : 30, 0, 0);
    const winEnd = new Date(winStart.getTime() + WINDOW_MIN * 60000);
    const xFor = (d) => Math.max(0, Math.min(GRID_W, ((d - winStart) / 60000) * PX_PER_MIN));

    const timebar = $('.cg-timebar');
    for (let m = 0; m < WINDOW_MIN; m += 30) {
        const slot = el('div', 'cg-slot', fmtShort(new Date(winStart.getTime() + m * 60000)));
        slot.style.left = m * PX_PER_MIN + 'px';
        timebar.appendChild(slot);
    }

    const needle = $('.cg-needle');
    const placeNeedle = () => { needle.style.left = 300 + xFor(new Date()) + 'px'; };
    placeNeedle();
    const needleTimer = setInterval(placeNeedle, 30000);

    // ---------- Helpers ----------
    const genreOf = (p) => (p.IsSports ? 'sports' : p.IsNews ? 'news' : p.IsMovie ? 'movie' : p.IsKids ? 'kids' : null);
    const genreLabel = { sports: 'Sports', news: 'News', movie: 'Movie', kids: 'Kids' };
    const logoChip = (ch) => {
        const chip = el('div', 'cg-logo-chip');
        if (ch.ImageTags && ch.ImageTags.Primary) {
            const img = new Image();
            img.src = `/Items/${ch.Id}/Images/Primary?maxHeight=120&tag=${ch.ImageTags.Primary}`;
            img.alt = '';
            img.onerror = () => { chip.innerHTML = `<div class="cg-chan-fallback">${esc(ch.Name)}</div>`; };
            chip.appendChild(img);
        } else {
            chip.innerHTML = `<div class="cg-chan-fallback">${esc(ch.Name)}</div>`;
        }
        return chip;
    };

    // ---------- Data + render ----------
    let rows = [];
    let sel = { row: 0, col: 0 };

    const render = (channels, byChannel) => {
        const inner = $('.cg-rows-inner');
        rows = channels.map((ch) => {
            const progs = (byChannel[ch.Id] || [])
                .filter((p) => new Date(p.EndDate) > winStart && new Date(p.StartDate) < winEnd)
                .sort((a, b) => a.StartDate.localeCompare(b.StartDate));
            const row = el('div', 'cg-row');
            const chan = el('div', 'cg-chan');
            chan.appendChild(el('div', 'cg-chan-num', esc(ch.Number)));
            chan.appendChild(logoChip(ch));
            row.appendChild(chan);
            const lane = el('div', 'cg-lane');
            const cells = [];
            const list = progs.length ? progs : [{ Name: '', StartDate: winStart.toISOString(), EndDate: winEnd.toISOString(), _empty: true }];
            for (const p of list) {
                const s = new Date(p.StartDate);
                const e = new Date(p.EndDate);
                const unknown = p._empty || PLACEHOLDER.test(p.Name);
                const cell = el('div', 'cg-prog' + (s <= now && e > now ? ' now' : '') + (unknown ? ' unknown' : ''));
                const left = xFor(s);
                cell.style.left = left + 4 + 'px';
                cell.style.width = Math.max(24, xFor(e) - left - 8) + 'px';
                const g = genreOf(p);
                if (g) cell.style.setProperty('--genre', `var(--${g})`);
                const title = unknown ? `${ch.Name} · listings unavailable` : p.Name;
                const sub = unknown ? '' : [p.EpisodeTitle, `${fmtShort(s)} – ${fmtShort(e)}`].filter(Boolean).join('  ·  ');
                cell.innerHTML = `<div class="cg-prog-title">${esc(title)}</div><div class="cg-prog-sub">${esc(sub)}</div>`;
                if (s <= now && e > now && !unknown) {
                    const bar = el('div', 'cg-prog-progress');
                    bar.style.width = Math.round(((now - s) / (e - s)) * 100) + '%';
                    cell.appendChild(bar);
                }
                cell.addEventListener('mouseenter', () => select(rows.indexOf(rowData), cells.indexOf(cellData)));
                cell.addEventListener('click', () => open(ch));
                const cellData = { el: cell, p, s, e, unknown };
                cells.push(cellData);
                lane.appendChild(cell);
            }
            row.appendChild(lane);
            inner.appendChild(row);
            const rowData = { el: row, ch, cells };
            return rowData;
        });

        // start on the first channel that has real listings, on what's airing now
        const first = Math.max(0, rows.findIndex((r) => r.cells.some((c) => !c.unknown)));
        const nowCol = Math.max(0, rows[first].cells.findIndex((c) => c.s <= now && c.e > now));
        select(first, nowCol);
    };

    const select = (r, c) => {
        if (r < 0 || r >= rows.length) return;
        const row = rows[r];
        c = Math.max(0, Math.min(row.cells.length - 1, c));
        const prev = rows[sel.row];
        if (prev) {
            prev.el.classList.remove('sel');
            prev.cells[sel.col]?.el.classList.remove('sel');
        }
        sel = { row: r, col: c };
        row.el.classList.add('sel');
        row.cells[c].el.classList.add('sel');
        // keep the selected row in view, TV-style (the grid pages rather than free-scrolls)
        const top = Math.max(0, Math.min(r - 1, rows.length - VISIBLE_ROWS));
        $('.cg-rows-inner').style.transform = `translateY(${-top * ROW_H}px)`;
        $('.cg-rows-inner').style.transition = 'transform 180ms ease';
        showInfo(row.ch, row.cells[c]);
    };

    const showInfo = (ch, cell) => {
        const { p, s, e, unknown } = cell;
        const live = s <= now && e > now;
        $('.cg-info-channel').innerHTML = '';
        $('.cg-info-channel').appendChild(logoChip(ch));
        $('.cg-info-channel').appendChild(el('div', 'cg-info-chname', `<b>${esc(ch.Number)}</b>${esc(ch.Name)}`));
        $('.cg-info-title').textContent = unknown ? ch.Name : p.Name;
        const meta = $('.cg-info-meta');
        meta.innerHTML = '';
        if (live) meta.appendChild(el('span', 'cg-chip live', 'Live'));
        if (!unknown) meta.appendChild(el('span', 'cg-chip', `${fmtTime(s)} – ${fmtTime(e)}`));
        const g = genreOf(p);
        if (g) {
            const chip = el('span', 'cg-chip genre', genreLabel[g]);
            chip.style.background = `var(--${g})`;
            meta.appendChild(chip);
        }
        if (p.ParentIndexNumber && p.IndexNumber) meta.appendChild(el('span', 'cg-chip', `S${p.ParentIndexNumber} E${p.IndexNumber}`));
        if (p.OfficialRating) meta.appendChild(el('span', 'cg-chip', esc(p.OfficialRating)));
        $('.cg-info-desc').textContent = unknown ? 'No listing information from this channel\'s guide.' : (p.EpisodeTitle ? p.EpisodeTitle + ' — ' : '') + (p.Overview || '');

        // preview window
        const art = $('.cg-preview-art');
        art.style.backgroundImage = p.ImageTags && p.ImageTags.Primary ? `url(/Items/${p.Id}/Images/Primary?maxWidth=700&tag=${p.ImageTags.Primary})` : 'none';
        const logo = $('.cg-preview-logo');
        logo.innerHTML = '';
        if (!(p.ImageTags && p.ImageTags.Primary)) logo.appendChild(logoChip(ch));
        $('.cg-preview-badge').innerHTML = live ? '<span class="cg-chip live">Live</span>' : '<span class="cg-chip">Upcoming</span>';
        $('.cg-preview-left').textContent = `CH ${ch.Number}`;
        $('.cg-preview-right').textContent = live && !unknown ? `${Math.round((e - now) / 60000)} min left` : unknown ? '' : `Starts ${fmtTime(s)}`;
        $('.cg-progress > i').style.width = live && !unknown ? Math.round(((now - s) / (e - s)) * 100) + '%' : '0';
    };

    const open = (ch) => {
        close();
        location.hash = `#/details?id=${ch.Id}&serverId=${server.Id}`;
    };

    const onKey = (ev) => {
        const k = ev.key;
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape', 'Backspace'].includes(k)) {
            ev.preventDefault();
            ev.stopPropagation();
        }
        if (k === 'ArrowDown') select(sel.row + 1, nearestCol(sel.row + 1));
        else if (k === 'ArrowUp') select(sel.row - 1, nearestCol(sel.row - 1));
        else if (k === 'ArrowRight') select(sel.row, sel.col + 1);
        else if (k === 'ArrowLeft') select(sel.row, sel.col - 1);
        else if (k === 'Enter') open(rows[sel.row].ch);
        else if (k === 'Escape' || k === 'Backspace') close();
    };
    // moving up/down keeps the same point in time, like a real guide
    const nearestCol = (r) => {
        if (!rows[r]) return 0;
        const cur = rows[sel.row].cells[sel.col];
        const t = cur ? Math.max(cur.s, now) : now;
        const i = rows[r].cells.findIndex((c) => c.s <= t && c.e > t);
        return i < 0 ? 0 : i;
    };
    const onWheel = (ev) => {
        ev.preventDefault();
        const r = sel.row + (ev.deltaY > 0 ? 1 : -1);
        select(r, nearestCol(r));
    };
    document.addEventListener('keydown', onKey, true);
    root.addEventListener('wheel', onWheel, { passive: false });

    const close = () => {
        document.removeEventListener('keydown', onKey, true);
        window.removeEventListener('resize', fit);
        clearInterval(clockTimer);
        clearInterval(needleTimer);
        root.remove();
    };

    (async () => {
        const [ch, progs] = await Promise.all([
            api(`/LiveTv/Channels?userId=${server.UserId}&limit=1000&EnableImages=true&ImageTypeLimit=1`),
            api(`/LiveTv/Programs?userId=${server.UserId}&MinEndDate=${winStart.toISOString()}&MaxStartDate=${winEnd.toISOString()}&limit=5000&fields=Overview&EnableImages=true&ImageTypeLimit=1`)
        ]);
        const byChannel = {};
        for (const p of progs.Items) (byChannel[p.ChannelId] = byChannel[p.ChannelId] || []).push(p);
        const channels = ch.Items.sort((a, b) => (parseFloat(a.Number) || 0) - (parseFloat(b.Number) || 0) || a.Name.localeCompare(b.Name));
        render(channels, byChannel);
    })().catch((err) => {
        console.error('[Channel Guide]', err);
        $('.cg-info-title').textContent = 'Couldn\'t load the guide';
    });
})();
