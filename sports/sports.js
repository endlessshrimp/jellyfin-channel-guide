/*
 * HOMER Sports (#/sports): a sports hub on the shared hub screen
 * (shared/hub.js). Home's Sports item goes here.
 *
 *   TV window    ESPN (1300) when it opens, unless something's already on
 *   Guide        every sports channel, now and next: national (ESPN, FOX,
 *                CBS, the league networks), the regional networks and MLB
 *                team channels (6000s), soccer and Spanish, the UK's (3300s)
 *                and France's (5300s). OK watches one in the TV window.
 *   Tabs         My Teams (the Rangers, Cowboys, Longhorns and Arsenal:
 *                their next and last games, the tables they're in, their
 *                news), MLB, NFL, College FB, Soccer (Premier League and
 *                Champions League), NBA, NHL, College Hoops: scores with the
 *                teams' logos, standings, the AP Top 25, news with pictures
 *   Ticker       ESPN BottomLine style: every league's scores, finals and
 *                start times with the TV network (and our channel for it),
 *                the favorites' games more often, then the headlines
 *
 * A game on a channel we have shows its number; OK on it watches that
 * channel. Data: ESPN's public API (sports/sports-data.js). Keys: see
 * shared/hub.js.
 *
 * window.HomerSports = { version }
 */
(() => {
    const VERSION = '0.1.0';
    const MIN = 60000;

    const define = () => {
        const HUB = window.HomerHub;
        const D = window.HomerSportsData;
        if (!HUB || !D) return false;
        const { ui, fmt } = HUB;
        const { el, esc } = ui;
        const L = D.LEAGUES;

        // ---------- The guide: every sports channel, in groups ----------

        const SOCCER_ES = /(GOL ?TV|Soccer|beIN|Deportes|TUDN|Golazo|Univision Deportes|Telemundo Deportes|Fútbol|Futbol)/i;
        const REGIONAL = /(FanDuel|Bally|SportsNet|MASN|Altitude|Space City|Marquee|\bYES\b|NESN|\bSNY\b|Monumental|Root Sports|NBC Sports (Bay|Boston|California|Chicago|Philadelphia|Washington)|Chicago Sports Network|Rangers Sports)/i;
        const MLB_TEAM = /(Rangers|Astros|Yankees|Red Sox|Mets|Dodgers|Cubs|Cardinals|Braves|Phillies|Giants|Padres|Mariners|Tigers|Twins|Guardians|Royals|White Sox|Orioles|Blue Jays|Rays|Angels|Athletics|Brewers|Reds|Pirates|Marlins|Nationals|Rockies|Diamondbacks) (MLB|feed|TV|Network)|MLB feed|^Texas Rangers/i;
        const inRange = (n, a, b) => n >= a && n <= b;
        // the tests run in this order (a team channel mustn't land in National);
        // `order` is the order they're shown in
        const guide = {
            title: 'Sports channels',
            include: (ch, i) => i.block === 'sports'
                || inRange(i.number, 1300, 1399) || inRange(i.number, 3300, 3399) || inRange(i.number, 5300, 5399) || inRange(i.number, 6000, 6199)
                || (i.cats.has('sports') && i.number < 7000),
            groups: [
                { key: 'teams', label: 'MLB teams', order: 2, test: (ch, i) => inRange(i.number, 6100, 6199) || (i.country === 'us' && MLB_TEAM.test(i.name)) },
                { key: 'regional', label: 'Regional sports', order: 1, test: (ch, i) => inRange(i.number, 6000, 6099) || (i.country === 'us' && REGIONAL.test(i.name)) },
                { key: 'soccer', label: 'Soccer & Spanish', order: 3, test: (ch, i) => i.country === 'us' && (inRange(i.number, 1330, 1339) || SOCCER_ES.test(i.name)) },
                { key: 'national', label: 'National', order: 0, test: (ch, i) => i.country === 'us' },
                { key: 'uk', label: 'UK', order: 4, test: (ch, i) => i.country === 'uk' },
                { key: 'fr', label: 'France', order: 5, test: (ch, i) => i.country === 'fr' }
            ]
        };

        // the Rangers' own channel, when the lineup has it
        HUB.channels.alias(/^Rangers Sports Network$/i, /Rangers Sports Network|^Texas Rangers/i);
        HUB.channels.alias(/^(CW33|CW 33)$/i, /\(KDAF\)|^CW 33\b/i);

        // ---------- Pieces ----------

        const tuneGame = (hub, g) => (g && g.channel ? () => hub.watch(g.channel.ch) : null);
        const grid = (min = 330) => {
            const g = el('div', 'hb-grid sp-grid');
            g.style.gridTemplateColumns = `repeat(auto-fill, minmax(${min}px, 1fr))`;
            return g;
        };
        const sig = (games) => games.map((g) => [g.id, g.state, g.status, g.away.score, g.home.score, g.channel && g.channel.number].join(':')).join('|');
        const scoreCard = (ctx, g, opts = {}) => {
            const act = tuneGame(ctx.hub, g);
            const c = ui.scoreCard(g, Object.assign({ ok: act || (() => ctx.toast(g.network ? `On ${g.network}: not a channel we have` : 'Not on TV here')) }, opts));
            c.dataset.key = 'g' + g.id;
            if (!act) c.dataset.okLabel = '';
            return c;
        };
        const newsGrid = (ctx, items, { cols = 3, tagFor } = {}) => {
            const g = el('div', 'hb-grid sp-news');
            g.style.setProperty('--cols', cols);
            items.forEach((a) => {
                const card = ui.imageCard(Object.assign({}, a, { tag: tagFor ? tagFor(a) : a.tag }), { ok: () => ctx.toast(a.summary ? a.summary.slice(0, 120) : a.title) });
                card.dataset.key = 'n' + a.id;
                card.dataset.okLabel = '';
                g.appendChild(card);
            });
            return g;
        };
        const loading = (text = 'Loading…') => ui.empty(text);
        const failed = (what) => ui.empty(`${what} didn't load`, 'ESPN didn\'t answer. It tries again by itself.');

        // a section whose body is drawn (and redrawn) by fn(body) on a poll
        const liveSection = (ctx, title, fn, { every = MIN, note = '', cls = '' } = {}) => {
            const s = ui.section(title, { note, cls });
            s.body.appendChild(loading());
            ctx.panel.appendChild(s);
            let first = true;
            ctx.poll(async () => {
                try {
                    await fn(s.body, s);
                } catch (err) {
                    if (first) { s.body.innerHTML = ''; s.body.appendChild(failed(title)); }
                    throw err;
                } finally {
                    first = false;
                }
                ctx.refocus();
            }, { every });
            return s;
        };
        const setNote = (s, text) => {
            const n = s.querySelector('.hb-sec-note');
            if (n) n.textContent = text;
            else s.querySelector('.hb-sec-head').insertAdjacentHTML('beforeend', `<span class="hb-sec-note">${esc(text)}</span>`);
        };
        let liveAny = false;
        const pace = () => (liveAny ? 20000 : MIN);

        // ---------- Scores ----------

        // a league's games: live and today first, then the rest of the window
        const scoresSection = (ctx, league, { title = 'Scores', limit = 18, filter = null, note = '' } = {}) => {
            let last = '';
            return liveSection(ctx, title, async (body, s) => {
                let games = await D.scores(league);
                if (filter) games = games.filter(filter);
                const live = D.anyLive(games);
                if (live) liveAny = true;
                const shown = games.slice(0, limit);
                const nlive = games.filter((g) => g.state === 'in').length;
                setNote(s, [nlive ? `${nlive} live` : '', note || (games.length ? `${games.length} games` : '')].filter(Boolean).join(' · '));
                const k = sig(shown);
                if (k === last) return;
                last = k;
                body.innerHTML = '';
                if (!shown.length) { body.appendChild(ui.empty('No games right now', `${L[league].name}: nothing on the schedule around today`)); return; }
                const g = grid();
                shown.forEach((x) => g.appendChild(scoreCard(ctx, x, { league: x.conf || '' })));
                body.appendChild(g);
            }, { every: pace });
        };

        // ---------- Standings ----------

        const standingsTable = (grp, league, { title, cols, rows } = {}) => {
            const std = {
                mlb: [
                    { key: 'team', label: '', logo: true, fmt: (r) => r.name, width: 'minmax(0,1fr)' },
                    { key: 'W', label: 'W', align: 'r', fmt: (r) => r.stat('wins') },
                    { key: 'L', label: 'L', align: 'r', fmt: (r) => r.stat('losses') },
                    { key: 'GB', label: 'GB', align: 'r', fmt: (r) => r.stat('gamesBehind') },
                    { key: 'S', label: 'Strk', align: 'r', fmt: (r) => r.stat('streak') }
                ],
                nfl: [
                    { key: 'team', label: '', logo: true, fmt: (r) => r.name, width: 'minmax(0,1fr)' },
                    { key: 'W', label: 'W', align: 'r', fmt: (r) => r.stat('wins') },
                    { key: 'L', label: 'L', align: 'r', fmt: (r) => r.stat('losses') },
                    { key: 'T', label: 'T', align: 'r', fmt: (r) => r.stat('ties') },
                    { key: 'S', label: 'Strk', align: 'r', fmt: (r) => r.stat('streak') }
                ]
            };
            return ui.table({
                title: title || grp.name,
                columns: cols || std[league] || std.nfl,
                rows: rows || grp.rows,
                highlight: (r) => r.fav,
                dense: true
            });
        };
        const PL_COLS = [
            { key: 'pos', label: '#', align: 'r', fmt: (r) => r.stat('rank') || r.pos, strong: true },
            { key: 'team', label: 'Club', logo: true, fmt: (r) => r.name, width: 'minmax(0,1fr)' },
            { key: 'P', label: 'P', align: 'r', fmt: (r) => r.stat('gamesPlayed') },
            { key: 'W', label: 'W', align: 'r', fmt: (r) => r.stat('wins') },
            { key: 'D', label: 'D', align: 'r', fmt: (r) => r.stat('ties') },
            { key: 'L', label: 'L', align: 'r', fmt: (r) => r.stat('losses') },
            { key: 'GD', label: 'GD', align: 'r', fmt: (r) => r.stat('pointDifferential') },
            { key: 'Pts', label: 'Pts', align: 'r', fmt: (r) => r.stat('points'), strong: true }
        ];
        const plRows = (rows) => rows.map((r, k) => Object.assign(r, {
            pos: k + 1,
            color: r.note && r.note.color ? r.note.color : '',
            // a line under the last Champions League place and above the drop
            cut: k === 3 || k === 16
        }));

        // ---------- Rankings ----------

        const trendText = (r) => {
            if (r.prev == null || r.prev === 0 || r.prev > 25) return r.prev > 25 || r.prev === 0 ? 'New' : '';
            const d = r.prev - r.rank;
            return d > 0 ? `▲${d}` : d < 0 ? `▼${-d}` : '–';
        };
        const RANK_COLS = [
            { key: 'rank', label: '#', align: 'r', fmt: (r) => r.rank, strong: true },
            { key: 'team', label: 'Team', logo: true, fmt: (r) => r.name, width: 'minmax(0,1fr)' },
            { key: 'rec', label: 'Rec', align: 'r', fmt: (r) => r.record },
            { key: 'tr', label: '', align: 'r', fmt: trendText }
        ];
        const rankingsSection = (ctx, league, { title = 'AP Top 25', count = 25 } = {}) => liveSection(ctx, title, async (body, s) => {
            const rk = await D.rankings(league);
            body.innerHTML = '';
            if (!rk || !rk.ranks.length) { body.appendChild(ui.empty('No rankings out yet')); return; }
            setNote(s, rk.final ? `Final poll, ${rk.season}` : [rk.week, rk.season].filter(Boolean).join(' · '));
            const rows = rk.ranks.slice(0, count);
            const half = Math.ceil(rows.length / 2);
            const two = el('div', 'hb-grid sp-two');
            two.style.setProperty('--cols', 2);
            [rows.slice(0, half), rows.slice(half)].forEach((part, k) => {
                const t = ui.table({ columns: RANK_COLS, rows: part, highlight: (r) => r.fav, dense: true });
                t.dataset.key = `rank-${league}-${k}`;
                t.dataset.okLabel = '';
                two.appendChild(t);
            });
            body.appendChild(two);
        }, { every: 30 * MIN });

        // ---------- News ----------

        const newsSection = (ctx, league, { title = 'Headlines', team = null, limit = 6, cols = 3 } = {}) => liveSection(ctx, title, async (body) => {
            const items = await D.news(league, { team, limit });
            body.innerHTML = '';
            if (!items.length) { body.appendChild(ui.empty('No stories right now')); return; }
            body.appendChild(newsGrid(ctx, items, { cols }));
        }, { every: 10 * MIN });

        // ---------- My Teams: the favorites' matchups ----------

        const hex = (c) => (c ? (String(c).startsWith('#') ? c : '#' + c) : '');
        // one favorite's card: the live game, or the next one (the last one under it)
        const matchupCard = (ctx, tg) => {
            const f = tg.fav;
            const g = tg.live || tg.next || tg.last;
            const card = el('div', 'sp-match hb-focusable');
            card.dataset.key = 'fav-' + f.key;
            if (!g) {
                card.innerHTML = `<div class="sp-match-top"><span class="sp-fav">${esc(f.name)}</span></div><div class="sp-match-none">No games on the schedule</div>`;
                return card;
            }
            const mine = g.home.fav ? g.home : g.away;
            const them = g.home.fav ? g.away : g.home;
            const homeGame = g.home.fav;
            const c1 = hex((g.homeFirst ? g.home : g.away).color) || '#1a2a44';
            const c2 = hex((g.homeFirst ? g.away : g.home).color) || '#1a2a44';
            card.style.setProperty('--c1', c1);
            card.style.setProperty('--c2', c2);
            const kind = tg.live ? 'Live' : tg.next ? 'Next' : 'Last';
            const L0 = L[g.league] || L[f.league];
            const side = (t) => `
                <div class="sp-match-team${t.fav ? ' mine' : ''}">
                    <span class="sp-match-logo">${ui.img(t.logo, '', t.abbr, t.logoFb)}</span>
                    <b>${t.rank ? `<small>${t.rank}</small>` : ''}${esc(t.short || t.abbr)}</b>
                </div>`;
            let mid;
            if (g.state === 'pre') {
                const day = fmt.day(g.start);
                mid = `<div class="sp-match-day">${esc(day === 'Today' ? (g.start.getHours() >= 17 ? 'Tonight' : 'Today') : day)}</div>
                       <div class="sp-match-time">${esc(/TBD/.test(g.status) ? 'TBD' : fmt.time(g.start))}</div>`;
            } else {
                const [l, r] = g.homeFirst ? [g.home, g.away] : [g.away, g.home];
                mid = `<div class="sp-match-score"><span class="${l.winner ? 'w' : ''}">${esc(l.score)}</span><i>–</i><span class="${r.winner ? 'w' : ''}">${esc(r.score)}</span></div>
                       <div class="sp-match-status ${g.state}">${g.state === 'in' ? '<i></i>' : ''}${esc(g.status)}</div>`;
            }
            const tv = g.channel
                ? `<span class="sp-match-tv on">${ui.icon('live_tv')}${esc(g.network || g.channel.name)} <b>${esc(g.channel.number)}</b></span>`
                : g.network ? `<span class="sp-match-tv">${esc(g.network)}</span>` : '';
            // under it: the last result (when the card shows the next game)
            let lastLine = '';
            if (tg.last && g !== tg.last) {
                const lg = tg.last;
                const me = lg.home.fav ? lg.home : lg.away;
                const opp = lg.home.fav ? lg.away : lg.home;
                const res = me.winner ? 'W' : opp.winner ? 'L' : 'D';
                lastLine = `<span class="sp-match-last"><b class="${res}">${res}</b> ${esc(me.score)}–${esc(opp.score)} ${lg.home.fav ? 'vs' : 'at'} ${esc(opp.abbr || opp.short)} <small>${esc(fmt.day(lg.start))}</small></span>`;
            }
            // (soccer: the table position says it; the W-D-L doesn't fit)
            const standing = f.league === 'epl' ? tg.team.standing : [tg.team.record, tg.team.standing].filter(Boolean).join(' · ');
            card.innerHTML = `
                <div class="sp-match-bg"></div>
                <div class="sp-match-top">
                    <span class="sp-fav">${esc(f.name)}</span>
                    <span class="sp-match-kind ${kind.toLowerCase()}">${esc(kind)}${g.competition && f.league === 'epl' ? ` · ${esc(g.competition)}` : ` · ${esc(L0 ? L0.label : '')}`}</span>
                    <span class="sp-match-standing">${esc(standing)}</span>
                </div>
                <div class="sp-match-mid">
                    ${side(g.homeFirst ? g.home : g.away)}
                    <div class="sp-match-center">${mid}<div class="sp-match-at">${homeGame ? 'vs' : 'at'} ${esc(them.short || them.abbr)}</div></div>
                    ${side(g.homeFirst ? g.away : g.home)}
                </div>
                <div class="sp-match-foot">${lastLine}${tv}</div>`;
            void mine;
            const act = g.channel && g.state !== 'post' ? () => ctx.hub.watch(g.channel.ch) : () => ctx.hub.showTab(f.league === 'epl' ? 'soccer' : f.league);
            ctx.focusable(card, act, g.channel && g.state !== 'post' ? `Watch ${g.network || g.channel.name}` : `${L0 ? L0.label : ''}`);
            return card;
        };
        // most relevant first: live, then the soonest game, then the rest
        const favOrder = (a, b) => (!!b.live - !!a.live)
            || ((a.next ? a.next.start : Infinity) - (b.next ? b.next.start : Infinity));

        const renderMyTeams = (ctx) => {
            // the four matchups
            let lastSig = '';
            liveSection(ctx, 'My teams', async (body) => {
                const all = await Promise.all(D.FAVS.map((f) => D.teamGames(f).catch(() => ({ fav: f, last: null, next: null, live: null, team: {} }))));
                all.sort(favOrder);
                if (all.some((t) => t.live)) liveAny = true;
                const k = all.map((t) => [t.fav.key, sig([t.live, t.next, t.last].filter(Boolean))].join('=')).join('#');
                if (k === lastSig) return;
                lastSig = k;
                body.innerHTML = '';
                const g = el('div', 'hb-grid sp-matches');
                g.style.setProperty('--cols', 2);
                all.forEach((t) => g.appendChild(matchupCard(ctx, t)));
                body.appendChild(g);
            }, { every: pace, cls: 'sp-my' });

            // where they stand: the AL West, the Premier League's top, the AP top 10
            liveSection(ctx, 'Where they stand', async (body) => {
                const [mlb, epl, ap] = await Promise.all([
                    D.standings('mlb').catch(() => []),
                    D.standings('epl').catch(() => []),
                    D.rankings('cfb').catch(() => null)
                ]);
                body.innerHTML = '';
                const g = el('div', 'hb-grid sp-stand3');
                g.style.gridTemplateColumns = 'repeat(auto-fill, minmax(340px, 1fr))';
                const alw = mlb.find((x) => x.rows.some((r) => r.fav));
                if (alw) {
                    const t = standingsTable(alw, 'mlb', { title: alw.name.replace('American League', 'AL').replace('National League', 'NL') });
                    t.dataset.key = 'st-alw';
                    t._hbOk = () => ctx.hub.showTab('mlb');
                    t.dataset.okLabel = 'MLB standings';
                    g.appendChild(t);
                }
                const pl = epl[0];
                if (pl) {
                    const rows = plRows(pl.rows.slice());
                    const at = rows.findIndex((r) => r.fav);
                    const from = Math.max(0, Math.min(rows.length - 5, at - 2));
                    const t = ui.table({
                        title: 'Premier League',
                        columns: [PL_COLS[0], PL_COLS[1], PL_COLS[2], PL_COLS[6], PL_COLS[7]],
                        rows: rows.slice(from, from + 5).map((r) => Object.assign({}, r, { cut: false })),
                        highlight: (r) => r.fav,
                        dense: true
                    });
                    t.dataset.key = 'st-pl';
                    t._hbOk = () => ctx.hub.showTab('soccer');
                    t.dataset.okLabel = 'The table';
                    g.appendChild(t);
                }
                if (ap && ap.ranks.length) {
                    const t = ui.table({ title: `AP Top 25${ap.week ? ' · ' + ap.week : ''}`, columns: RANK_COLS, rows: ap.ranks.slice(0, 5), highlight: (r) => r.fav, dense: true });
                    t.dataset.key = 'st-ap';
                    t._hbOk = () => ctx.hub.showTab('cfb');
                    t.dataset.okLabel = 'All 25';
                    g.appendChild(t);
                }
                body.appendChild(g);
            }, { every: 30 * MIN });

            // their news: the Longhorns first, then the rest
            liveSection(ctx, 'In the news', async (body) => {
                const lists = await Promise.all([
                    D.news('cfb', { team: '251', limit: 4 }).then((l) => l.map((a) => Object.assign(a, { tag: 'Longhorns' }))).catch(() => []),
                    D.news('mlb', { team: '13', limit: 3 }).then((l) => l.map((a) => Object.assign(a, { tag: 'Rangers' }))).catch(() => []),
                    D.news('nfl', { team: '6', limit: 3 }).then((l) => l.map((a) => Object.assign(a, { tag: 'Cowboys' }))).catch(() => []),
                    D.news('epl', { team: '359', limit: 3 }).then((l) => l.map((a) => Object.assign(a, { tag: 'Arsenal' }))).catch(() => [])
                ]);
                // two Longhorns stories, then one from each of the others, then the rest
                const out = [];
                const seen = new Set();
                const take = (a) => { if (a && !seen.has(a.title)) { seen.add(a.title); out.push(a); } };
                lists[0].slice(0, 2).forEach(take);
                lists.slice(1).forEach((l) => take(l[0]));
                lists.forEach((l) => l.forEach(take));
                body.innerHTML = '';
                if (!out.length) { body.appendChild(ui.empty('No stories right now')); return; }
                body.appendChild(newsGrid(ctx, out.slice(0, 9)));
            }, { every: 10 * MIN });
        };

        // ---------- League tabs ----------

        const renderMLB = (ctx) => {
            scoresSection(ctx, 'mlb', { title: 'Scores · yesterday and today', limit: 30 });
            liveSection(ctx, 'Standings', async (body) => {
                const groups = await D.standings('mlb');
                body.innerHTML = '';
                // the Rangers' division first, then the AL, then the NL
                const order = (x) => (x.rows.some((r) => r.fav) ? 0 : /American/.test(x.name) ? 1 : 2);
                const g = el('div', 'hb-grid sp-stand');
                g.style.gridTemplateColumns = 'repeat(auto-fill, minmax(340px, 1fr))';
                [...groups].sort((a, b) => order(a) - order(b)).forEach((grp, k) => {
                    const t = standingsTable(grp, 'mlb', { title: grp.name.replace('American League', 'AL').replace('National League', 'NL') });
                    t.dataset.key = 'mlb-div-' + k;
                    t.dataset.okLabel = '';
                    g.appendChild(t);
                });
                body.appendChild(g);
            }, { every: 30 * MIN });
            liveSection(ctx, 'Wild card races', async (body) => {
                const lgs = await D.wildCard();
                body.innerHTML = '';
                const g = el('div', 'hb-grid sp-two');
                g.style.setProperty('--cols', 2);
                lgs.forEach((lg, k) => {
                    const rows = lg.rows.filter((r) => r.seed <= 9);
                    const t = ui.table({
                        title: lg.name.replace('American League', 'AL').replace('National League', 'NL'),
                        note: 'Top 6 make it',
                        columns: [
                            { key: 'seed', label: '#', align: 'r', fmt: (r) => r.seed, strong: true },
                            { key: 'team', label: '', logo: true, fmt: (r) => r.name, width: 'minmax(0,1fr)' },
                            { key: 'rec', label: 'W-L', align: 'r', fmt: (r) => `${r.stat('wins')}-${r.stat('losses')}` },
                            { key: 'gb', label: 'GB', align: 'r', fmt: (r) => r.stat('gamesBehind') },
                            { key: 'l10', label: 'L10', align: 'r', fmt: (r) => r.stat('Last Ten Games') }
                        ],
                        rows: rows.map((r, i) => Object.assign(r, { cut: i === 5 })),
                        highlight: (r) => r.fav,
                        dense: true
                    });
                    t.dataset.key = 'wc-' + k;
                    t.dataset.okLabel = '';
                    g.appendChild(t);
                });
                body.appendChild(g);
            }, { every: 30 * MIN });
            newsSection(ctx, 'mlb', { title: 'MLB headlines' });
        };

        const renderNFL = (ctx) => {
            scoresSection(ctx, 'nfl', { title: 'This week', limit: 20 });
            liveSection(ctx, 'Standings', async (body) => {
                const groups = await D.standings('nfl');
                body.innerHTML = '';
                const conf = (x) => (/^NFC/.test(x.name) ? 'NFC' : 'AFC');
                const order = (x) => (x.rows.some((r) => r.fav) ? 0 : conf(x) === 'NFC' ? 1 : 2);
                const g = el('div', 'hb-grid sp-stand');
                g.style.gridTemplateColumns = 'repeat(auto-fill, minmax(340px, 1fr))';
                [...groups].sort((a, b) => order(a) - order(b)).forEach((grp, k) => {
                    const t = standingsTable(grp, 'nfl', { title: grp.name });
                    t.dataset.key = 'nfl-div-' + k;
                    t.dataset.okLabel = '';
                    g.appendChild(t);
                });
                body.appendChild(g);
            }, { every: 30 * MIN });
            newsSection(ctx, 'nfl', { title: 'NFL headlines' });
        };

        const renderCFB = (ctx) => {
            rankingsSection(ctx, 'cfb');
            scoresSection(ctx, 'cfb', { title: 'Top 25, SEC and Big 12', limit: 30 });
            newsSection(ctx, 'cfb', { title: 'Longhorns', team: '251', limit: 3 });
            newsSection(ctx, 'cfb', { title: 'College football headlines' });
        };

        const renderSoccer = (ctx) => {
            scoresSection(ctx, 'epl', { title: 'Premier League', limit: 12 });
            liveSection(ctx, 'Premier League table', async (body, s) => {
                const groups = await D.standings('epl');
                body.innerHTML = '';
                const tbl = groups[0];
                if (!tbl) { body.appendChild(ui.empty('No table yet')); return; }
                setNote(s, tbl.name.replace(/English /, ''));
                const rows = plRows(tbl.rows.slice());
                const two = el('div', 'hb-grid sp-two');
                two.style.setProperty('--cols', 2);
                [rows.slice(0, 10), rows.slice(10)].forEach((part, k) => {
                    const t = ui.table({ columns: PL_COLS, rows: part, highlight: (r) => r.fav, dense: true });
                    t.dataset.key = 'pl-' + k;
                    t.dataset.okLabel = '';
                    two.appendChild(t);
                });
                body.appendChild(two);
            }, { every: 30 * MIN });
            scoresSection(ctx, 'ucl', { title: 'Champions League', limit: 18 });
            newsSection(ctx, 'epl', { title: 'Premier League headlines' });
        };

        const renderSimple = (league, { rankings = false } = {}) => (ctx) => {
            if (rankings) rankingsSection(ctx, league);
            scoresSection(ctx, league, { title: 'Scores', limit: 18 });
            newsSection(ctx, league, { title: `${L[league].name} headlines` });
        };

        // ---------- Ticker ----------

        const tickerSource = async (hub) => {
            const leagues = ['mlb', 'nfl', 'cfb', 'epl', 'ucl', 'nba', 'nhl'];
            const res = await Promise.all(leagues.map((k) => D.scores(k).catch(() => [])));
            const now = Date.now();
            const segs = [];
            let live = false;
            res.forEach((games, i) => {
                const k = leagues[i];
                if (D.anyLive(games)) live = true;
                // what's worth a ticker: live, finals from the last day and a half,
                // and games in the next two days (soccer: the next four)
                const ahead = (k === 'epl' || k === 'ucl') ? 4 : (k === 'nfl' || k === 'cfb') ? 6 : 2;
                const pick = games.filter((g) => g.state === 'in'
                    || (g.state === 'post' && now - g.start < 36 * 3600000)
                    || (g.state === 'pre' && g.start - now < ahead * 86400000));
                // NBA and NHL only when they're playing
                if ((k === 'nba' || k === 'nhl') && !pick.some((g) => g.start - now < 86400000)) return;
                if (!pick.length) return;
                const Lg = L[k];
                segs.push({
                    label: Lg.label === 'College FB' ? 'NCAAF' : Lg.label === 'Premier League' ? 'Prem' : Lg.label === 'Champions League' ? 'UCL' : Lg.label,
                    logo: Lg.logo,
                    items: pick.slice(0, 40).map((g) => HomerTicker.score(g, { act: g.channel && g.state !== 'post' ? () => hub.watch(g.channel.ch) : null }))
                });
            });
            // the favorites' own next (or live) game and last result, wherever
            // they are (a cup game, next week's NFL game): into My Teams
            const seen = new Set(segs.flatMap((sg) => sg.items.map((i) => i.key)));
            const tgs = await Promise.all(D.FAVS.map((f) => D.teamGames(f).catch(() => null)));
            const extra = [];
            tgs.filter(Boolean).forEach((tg) => {
                [tg.live, tg.next, tg.last].filter(Boolean).forEach((g) => {
                    if (seen.has(g.id)) return;
                    if (g === tg.last && now - g.start > 4 * 86400000) return; // an old result
                    seen.add(g.id);
                    if (g.state === 'in') live = true;
                    extra.push(HomerTicker.score(g, { priority: true, act: g.channel && g.state !== 'post' ? () => hub.watch(g.channel.ch) : null }));
                });
            });
            if (extra.length) segs.push({ label: 'My Teams', hidden: true, items: extra });
            D.noteLive(live);
            liveAny = live;
            // the headlines, as a crawl
            const heads = await Promise.all([['mlb', 'MLB'], ['nfl', 'NFL'], ['cfb', 'NCAAF'], ['epl', 'Soccer']].map(([k, tag]) => D.news(k, { limit: 4 }).then((l) => l.map((a) => ({ a, tag }))).catch(() => [])));
            const lh = await D.news('cfb', { team: '251', limit: 2 }).catch(() => []);
            const items = [];
            lh.forEach((a) => items.push(HomerTicker.text(a.title, { tag: 'Longhorns', priority: false, key: 'n' + a.id })));
            for (let r = 0; r < 4; r++) heads.forEach((l) => { if (l[r]) items.push(HomerTicker.text(l[r].a.title, { tag: l[r].tag, key: 'n' + l[r].a.id })); });
            if (items.length) segs.push({ label: 'Headlines', mode: 'crawl', items });
            return segs;
        };

        // ---------- The hub ----------

        HUB.define({
            id: 'sports',
            route: 'sports',
            title: 'Sports',
            css: 'sports/sports.css',
            tv: { channel: '1300' }, // ESPN
            guide,
            tabs: [
                { key: 'my', label: 'My Teams', render: renderMyTeams },
                { key: 'mlb', label: 'MLB', render: renderMLB },
                { key: 'nfl', label: 'NFL', render: renderNFL },
                { key: 'cfb', label: 'College FB', render: renderCFB },
                { key: 'soccer', label: 'Soccer', render: renderSoccer },
                { key: 'nba', label: 'NBA', render: renderSimple('nba') },
                { key: 'nhl', label: 'NHL', render: renderSimple('nhl') },
                { key: 'cbb', label: 'College Hoops', render: renderSimple('cbb', { rankings: true }) }
            ],
            ticker: {
                source: tickerSource,
                refreshMs: 60000,
                pageMs: 6000,
                priorityLabel: 'My Teams',
                stepLabel: 'Scores',
                okLabel: 'Watch',
                priorityEvery: 2
            }
        });
        return true;
    };

    // hub.js and the data can load in either order (or be reloaded alone)
    if (window.HomerSports && window.HomerSports._off) window.HomerSports._off();
    const onReady = () => define();
    window.addEventListener('homer-hub-ready', onReady);
    if (!define()) {
        setTimeout(define, 500);
        setTimeout(define, 3000);
    }

    window.HomerSports = { version: VERSION, _off: () => window.removeEventListener('homer-hub-ready', onReady) };
})();
