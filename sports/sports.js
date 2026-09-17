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
 * Baseball gets more than a score and an inning, because MLB's own StatsAPI
 * gives more (sports/sports-data.js):
 *
 *   Live now     at the top of the MLB tab: the club colors, who's batting,
 *                the bases, the count, the outs, the pitcher and the hitter,
 *                the line score inning by inning, and the last four plays.
 *                One game's feed at a time — the one on screen (a chip per
 *                live game picks it) and the Rangers'. 12 seconds while the
 *                ball's in play, slower when it isn't, nothing at all while
 *                the tab is hidden.
 *   Score cards  a live game's card carries the diamond, the count, the outs
 *                and who's at the plate under the score.
 *   My Teams     the Rangers' card shows that same detail while they're
 *                playing and the two probable starters before they are.
 *   Ticker       the same scores it always carried, with the outs and the
 *                runners on the line, and the real state of a game
 *                (POSTPONED · RAIN, DELAYED, FINAL/10).
 *
 * A game on a channel we have shows its number; OK on it watches that
 * channel. Data: ESPN's public API, and MLB's StatsAPI for baseball
 * (sports/sports-data.js). Keys: see shared/hub.js.
 *
 * window.HomerSports = { version }
 */
(() => {
    const VERSION = '0.3.0';
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

        // the Rangers' own channel, when the lineup has it. Not `^Texas
        // Rangers` alone — his lineup also carries a "Texas Rangers (MLB
        // feed)" channel with identical listings (down to the same "Next
        // game" placeholder), which the plural regional lookup below would
        // otherwise treat as a second, equally-plausible candidate and call
        // every Rangers game ambiguous.
        HUB.channels.alias(/^Rangers Sports Network$/i, /Rangers Sports Network/i);
        HUB.channels.alias(/^(CW33|CW 33)$/i, /\(KDAF\)|^CW 33\b/i);

        // ---------- Pieces ----------

        // Only a *live* game tunes on click — an upcoming one just names its
        // channel (when the guide's confirmed one), a finished one routes to
        // its box score instead (see gameRoute). g.channel only ever exists
        // when resolveChannels() found exactly one guide-confirmed match.
        const tuneGame = (hub, g) => (g && g.channel && g.state === 'in' ? () => hub.watch(g.channel.ch) : null);
        // A finished game's card routes to a box-score page (box scores,
        // stats) that doesn't exist yet — Jason's building it separately.
        // gameRoute is the address it'll read (?game=<id>) once it does.
        // Tried actually setting location.hash to it first: harmless-looking,
        // but shared/hub.js's route watcher and shared/loading.js's "moving
        // between screens" splash both fire on any hash change, and since a
        // query-string-only change never tears down or recreates this hub's
        // screen, loading.js's splash never sees a new screen "settle" —
        // after LATE_MS it gives up and shows "Couldn't open Sports" over a
        // perfectly fine, already-open screen. So this stays off
        // location.hash for now: it calls a future detail view's own hook if
        // one's registered, and otherwise is a genuine no-op but for a toast
        // (consistent with every other "OK, nothing to do yet" card here).
        const gameRoute = (g) => `#/sports?game=${encodeURIComponent(g.id)}`;
        const openGame = (ctx, g) => {
            const detail = window.HomerSportsGameDetail;
            if (detail && typeof detail.open === 'function') { detail.open(g, gameRoute(g)); return; }
            ctx.toast('Box score isn’t built yet');
        };
        // what OK says when there's nothing to tune
        const offMsg = (g) => (g.network ? `${g.network} · not tunable` : 'Not on TV here');
        const grid = (min = 330) => {
            const g = el('div', 'hb-grid sp-grid');
            g.style.gridTemplateColumns = `repeat(auto-fill, minmax(${min}px, 1fr))`;
            return g;
        };
        const mlbSig = (g) => (g.mlb && g.state === 'in' ? [g.mlb.outs, g.mlb.balls, g.mlb.strikes, g.mlb.bases.join('')].join(',') : '');
        const sig = (games) => games.map((g) => [g.id, g.state, g.status, g.away.score, g.home.score, g.channel && g.channel.number, mlbSig(g)].join(':')).join('|');
        // small: a finished game — its card routes to the box score instead
        // of tuning anything
        const scoreCard = (ctx, g, opts = {}) => {
            const finished = g.state === 'post';
            const act = finished ? () => openGame(ctx, g) : tuneGame(ctx.hub, g);
            const c = ui.scoreCard(g, Object.assign({ ok: act || (() => ctx.toast(offMsg(g))), small: finished }, opts));
            c.dataset.key = 'g' + g.id;
            if (finished) c.dataset.okLabel = 'Box score';
            else if (!act) c.dataset.okLabel = '';
            // baseball: who's on and how many out, which is the half of a
            // score ESPN never gave us (mlbCardLine is below)
            if (g.mlb && !finished) mlbCardLine(c, g);
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
        const failed = (what) => ui.empty(`${what} didn't load`, 'The scores didn\'t answer. It tries again by itself.');

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

        // a league's games: live and today first, then the rest of the window.
        // Split into what's on or coming up (the pick) and what's already
        // over (smaller cards, below — this is a scores section for those,
        // not a what-to-watch one).
        const scoresSection = (ctx, league, { title = 'Scores', limit = 18, filter = null, note = '' } = {}) => {
            let last = '';
            return liveSection(ctx, title, async (body, s) => {
                let games = await D.scores(league);
                if (filter) games = games.filter(filter);
                const live = D.anyLive(games);
                if (live) liveAny = true;
                const shown = games.slice(0, limit);
                await D.resolveChannels(shown.filter((g) => g.state !== 'post')).catch(() => null);
                const nlive = games.filter((g) => g.state === 'in').length;
                setNote(s, [nlive ? `${nlive} live` : '', note || (games.length ? `${games.length} game${games.length === 1 ? '' : 's'}` : '')].filter(Boolean).join(' · '));
                const k = sig(shown);
                if (k === last) return;
                last = k;
                body.innerHTML = '';
                if (!shown.length) { body.appendChild(ui.empty('No games right now', `${L[league].name}: nothing on the schedule around today`)); return; }
                const upcoming = shown.filter((g) => g.state !== 'post');
                const finished = shown.filter((g) => g.state === 'post');
                if (upcoming.length) {
                    const g = grid();
                    upcoming.forEach((x) => g.appendChild(scoreCard(ctx, x, { league: x.conf || '' })));
                    body.appendChild(g);
                }
                if (finished.length) {
                    body.appendChild(el('div', 'sp-fin-head', `Final${upcoming.length ? '' : ` · ${L[league].name}`}`));
                    const g = grid(220);
                    finished.forEach((x) => g.appendChild(scoreCard(ctx, x, { league: x.conf || '' })));
                    body.appendChild(g);
                }
            }, { every: pace });
        };

        // ---------- Baseball ----------
        //
        // What MLB's StatsAPI gives that ESPN's scoreboard didn't, drawn so
        // it reads from the couch: the bases, the count and the outs, who's
        // pitching to whom, the line score inning by inning, and the last
        // few things that happened.

        // The infield, with a base lit for each runner. `on` is [1st, 2nd, 3rd].
        const diamond = (on, cls = '') => {
            const b = (k, cx, cy) => `<rect class="sp-base${on && on[k] ? ' on' : ''}" x="${cx - 7}" y="${cy - 7}" width="14" height="14" rx="2" transform="rotate(45 ${cx} ${cy})"/>`;
            return `<svg class="sp-diamond ${cls}" viewBox="0 0 64 64" aria-hidden="true">
                ${b(1, 32, 15)}${b(0, 49, 32)}${b(2, 15, 32)}
                <path class="sp-plate" d="M26 47h12l0 5-6 5-6-5z"/>
            </svg>`;
        };
        const outsDots = (n) => `<span class="sp-outs">${[0, 1, 2].map((k) => `<i class="${k < (n || 0) ? 'on' : ''}"></i>`).join('')}</span>`;
        const basesText = (on) => {
            const [a, b, c] = on || [];
            const n = [a, b, c].filter(Boolean).length;
            if (!n) return 'Bases empty';
            if (n === 3) return 'Bases loaded';
            const names = [a && '1st', b && '2nd', c && '3rd'].filter(Boolean);
            return names.length === 2 ? `${names[0]} and ${names[1]}` : `Runner on ${names[0]}`;
        };
        // A live game's score card gets a line under it: the count, the outs
        // and who's on. Between innings there's no count, so it says so.
        const mlbCardLine = (card, g) => {
            const m = g.mlb;
            if (g.state !== 'in' || m.dead) return;
            const mid = /^(Mid|End)/i.test(m.half || '');
            const count = mid || m.balls == null ? '' : `<b>${m.balls}-${m.strikes}</b>`;
            const line = el('div', 'sp-cardline');
            line.innerHTML = mid
                ? `<span class="sp-cardline-txt">${esc(/^Mid/i.test(m.half) ? 'Middle of the inning' : 'End of the inning')}</span>`
                : `${diamond(m.bases, 'sm')}${count}${outsDots(m.outs)}<span class="sp-cardline-txt">${esc(`${m.outs === 1 ? '1 out' : `${m.outs || 0} out`}`)}</span>${m.batter ? `<span class="sp-cardline-ab">${esc(surname(m.batter))}</span>` : ''}`;
            card.appendChild(line);
        };

        // The line score: the innings across, R H E at the end. Innings that
        // haven't been played are dashes; a home team that didn't bat in the
        // ninth gets an X, the way a scoreboard writes it.
        const lineScore = (lv) => {
            const cols = Math.max(9, lv.innings.length, lv.inning || 0);
            const head = [];
            for (let i = 1; i <= cols; i++) head.push(`<span class="sp-ls-i">${i}</span>`);
            const row = (ha, team) => {
                const cells = [];
                for (let i = 1; i <= cols; i++) {
                    const inn = lv.innings[i - 1];
                    const v = inn && inn[ha] ? inn[ha].r : undefined;
                    const played = v != null;
                    const skipped = !played && ha === 'home' && lv.state === 'post' && i <= (lv.inning || 0);
                    cells.push(`<span class="sp-ls-n${played ? '' : ' off'}">${played ? v : skipped ? 'X' : '·'}</span>`);
                }
                const t = lv.totals[ha] || {};
                return `<div class="sp-ls-row">
                    <span class="sp-ls-team">${ui.img(team.logo, '', team.abbr, team.logoFb)}<b>${esc(team.abbr || team.short)}</b></span>
                    ${cells.join('')}
                    <span class="sp-ls-t r">${t.r ?? 0}</span><span class="sp-ls-t">${t.h ?? 0}</span><span class="sp-ls-t">${t.e ?? 0}</span>
                </div>`;
            };
            const box = el('div', 'sp-ls');
            box.style.setProperty('--innings', cols);
            box.innerHTML = `
                <div class="sp-ls-row head"><span class="sp-ls-team"></span>${head.join('')}<span class="sp-ls-t">R</span><span class="sp-ls-t">H</span><span class="sp-ls-t">E</span></div>
                ${row('away', lv.away)}${row('home', lv.home)}`;
            return box;
        };

        // The whole live view for one game: the header, the two teams, the
        // at-bat, the line score and what just happened.
        const liveView = (ctx, g, lv) => {
            const box = el('div', 'sp-live');
            const m = (g && g.mlb) || {};
            const live = lv.live;
            const mid = /^(Mid|End)/i.test(lv.half || '');
            const battingHome = lv.battingTeam === 'home';
            const c1 = hex(lv.away.color) || '#16243c';
            const c2 = hex(lv.home.color) || '#16243c';
            box.style.setProperty('--c1', c1);
            box.style.setProperty('--c2', c2);
            const tv = g && g.channel
                ? `<span class="sp-live-tv on">${ui.icon('live_tv')}${esc(g.network || g.channel.name)} <b>${esc(g.channel.number)}</b></span>`
                : g && g.network ? `<span class="sp-live-tv">${esc(g.network)}</span>` : '';
            const team = (ha) => {
                const t = lv[ha];
                const bat = live && !mid && ((ha === 'home') === battingHome);
                // nobody's scored before first pitch, so don't write a nought
                const runs = lv.state === 'pre' ? '' : (lv.totals[ha] || {}).r ?? '';
                const won = lv.state === 'post' && (lv.totals[ha] || {}).r > (lv.totals[ha === 'home' ? 'away' : 'home'] || {}).r;
                return `<div class="sp-live-team${bat ? ' bat' : ''}${lv.state === 'post' && !won ? ' lose' : ''}" style="--team:${hex(t.color) || 'transparent'}">
                    <span class="sp-live-logo">${ui.img(t.logo, '', t.abbr, t.logoFb)}</span>
                    <span class="sp-live-nm">${esc(t.short || t.abbr)}</span>
                    ${bat ? '<span class="sp-live-atbat">at bat</span>' : ''}
                    <span class="sp-live-runs">${esc(String(runs ?? ''))}</span>
                </div>`;
            };
            // the middle: the at-bat while it's live, the probables before,
            // the decisions after
            let centre;
            if (live && !mid) {
                centre = `
                    <div class="sp-live-state">
                        ${diamond(lv.bases)}
                        <div class="sp-live-count">
                            <span class="sp-live-bs">${lv.balls}<i>-</i>${lv.strikes}</span>
                            <span class="sp-live-lbl">count</span>
                        </div>
                        <div class="sp-live-count">
                            ${outsDots(lv.outs)}
                            <span class="sp-live-lbl">${lv.outs === 1 ? '1 out' : `${lv.outs} out`}</span>
                        </div>
                    </div>
                    <div class="sp-live-matchup">
                        <div class="sp-live-who"><span class="sp-live-lbl">Pitching</span><b>${esc(lv.pitcher.name || '—')}</b>${lv.pitcher.hand ? `<small>${esc(lv.pitcher.hand)}HP</small>` : ''}</div>
                        <div class="sp-live-who"><span class="sp-live-lbl">At bat</span><b>${esc(lv.batter.name || '—')}</b>${lv.batter.hand ? `<small>${esc(lv.batter.hand)}HB</small>` : ''}</div>
                        ${lv.onDeck ? `<div class="sp-live-who dim"><span class="sp-live-lbl">On deck</span><b>${esc(lv.onDeck)}</b></div>` : ''}
                    </div>
                    <div class="sp-live-runners">${esc(basesText(lv.bases))}${lv.pitches.length ? `<span class="sp-pitches">${lv.pitches.slice(-6).map((p) => `<i class="${p.kind}" title="${esc(p.desc)}"></i>`).join('')}</span>` : ''}</div>`;
            } else if (live && mid) {
                centre = `<div class="sp-live-between">${esc(/^Mid/i.test(lv.half) ? 'Middle of the ' + lv.ord : 'End of the ' + lv.ord)}</div>`;
            } else if (lv.state === 'pre') {
                const when = g ? fmt.when(g.start) : '';
                centre = `<div class="sp-live-pre">
                    <div class="sp-live-first">${esc(lv.status === 'Warmup' || /delay/i.test(lv.status) ? lv.status : when)}</div>
                    <div class="sp-live-probs">
                        <span><small>${esc(lv.away.abbr)}</small>${esc(lv.probables.away || 'TBD')}</span>
                        <i>vs</i>
                        <span><small>${esc(lv.home.abbr)}</small>${esc(lv.probables.home || 'TBD')}</span>
                    </div>
                </div>`;
            } else {
                const d = lv.decisions;
                const bits = [d.winner ? `W ${d.winner}` : '', d.loser ? `L ${d.loser}` : '', d.save ? `S ${d.save}` : ''].filter(Boolean);
                centre = `<div class="sp-live-pre">
                    <div class="sp-live-first">${esc(lv.status)}</div>
                    ${bits.length ? `<div class="sp-live-probs">${bits.map((b) => `<span>${esc(b)}</span>`).join('')}</div>` : ''}
                </div>`;
            }
            const flag = lv.perfectGame ? 'Perfect game' : lv.noHitter ? 'No-hitter' : '';
            box.innerHTML = `
                <div class="sp-live-bg"></div>
                <div class="sp-live-head">
                    <span class="sp-live-status ${lv.state}">${lv.state === 'in' ? '<i></i>' : ''}${esc(lv.status)}</span>
                    ${flag ? `<span class="sp-live-flag">${esc(flag)}</span>` : ''}
                    ${m.description ? `<span class="sp-live-note">${esc(m.description)}</span>` : ''}
                    ${tv}
                </div>
                <div class="sp-live-body">
                    <div class="sp-live-teams">${team('away')}${team('home')}</div>
                    <div class="sp-live-centre">${centre}</div>
                </div>`;
            if (lv.innings.length) box.appendChild(lineScore(lv));
            if (lv.plays.length) {
                const p = el('div', 'sp-plays');
                p.innerHTML = lv.plays.map((x, i) => `
                    <div class="sp-play${i ? '' : ' first'}${x.scoring ? ' score' : ''}">
                        <span class="sp-play-inn">${esc(`${/^top$/i.test(x.half) ? '▲' : '▼'}${x.inning}`)}</span>
                        <span class="sp-play-txt">${esc(x.desc)}</span>
                    </div>`).join('');
                box.appendChild(p);
            }
            const act = g && g.channel && g.state === 'in' ? () => ctx.hub.watch(g.channel.ch) : null;
            ctx.focusable(box, act || (() => ctx.toast(g ? offMsg(g) : 'Not on TV here')),
                act ? `Watch ${(g.network || g.channel.name)}` : '');
            box.dataset.key = 'live' + lv.pk;
            return box;
        };

        // Which game the live view shows: the one the viewer picked while
        // it's still on, else the Rangers, else the closest game late on.
        const pickGame = (games, want) => {
            const live = games.filter((g) => g.state === 'in' && !g.mlb.dead);
            const chosen = want && live.find((g) => g.id === want);
            if (chosen) return chosen;
            const mine = live.find((g) => g.priority);
            if (mine) return mine;
            const margin = (g) => Math.abs((+g.away.score || 0) - (+g.home.score || 0));
            const worth = (g) => (g.mlb.inning >= 7 && margin(g) <= 2 ? 0 : 1);
            const late = live.slice().sort((a, b) => worth(a) - worth(b) || b.mlb.inning - a.mlb.inning || margin(a) - margin(b));
            if (late[0]) return late[0];
            // nothing on: the Rangers' next game today, else the last final
            const soon = games.filter((g) => g.state === 'pre' && !g.mlb.dead).sort((a, b) => (b.priority - a.priority) || (a.start - b.start));
            const done = games.filter((g) => g.state === 'post' && !g.mlb.dead).sort((a, b) => (b.priority - a.priority) || (b.start - a.start));
            return (want && games.find((g) => g.id === want)) || soon[0] || done[0] || null;
        };

        // The live view as a section of its own, with a chip per live game
        // when there's more than one, so the viewer picks which one it shows.
        // Only this game's feed is fetched (and the Rangers', on My Teams) —
        // never one per game on the slate.
        const mlbLiveSection = (ctx) => {
            let want = null;
            let lastKey = '';
            // how long until the next ask: the game on screen sets it (12s
            // while the ball's in play, slower when it isn't, 5 minutes once
            // it's over), and a hidden tab asks for nothing at all
            let every = 30000;
            const s = ui.section('Live now', { cls: 'sp-livesec' });
            s.body.appendChild(loading());
            ctx.panel.appendChild(s);
            const chipsEl = el('div', 'sp-chips');
            let first = true;
            let poller = null;
            poller = ctx.poll(async () => {
                if (document.hidden) return; // a hidden tab asks nothing of MLB
                let games;
                try {
                    games = await D.scores('mlb');
                } catch (err) {
                    if (first) { s.body.innerHTML = ''; s.body.appendChild(failed('The game')); }
                    first = false;
                    throw err;
                }
                const live = games.filter((g) => g.state === 'in' && !g.mlb.dead);
                if (live.length) liveAny = true;
                const g = pickGame(games, want);
                every = g ? D.mlbLivePace(g) : 5 * MIN;
                if (!g) {
                    s.style.display = 'none';
                    first = false;
                    return;
                }
                if (g.state !== 'post') await D.resolveChannels([g]).catch(() => null);
                s.style.display = '';
                s.querySelector('h2').textContent = g.state === 'in' ? 'Live now' : g.state === 'pre' ? 'Coming up' : 'Last time out';
                setNote(s, live.length ? `${live.length} game${live.length === 1 ? '' : 's'} live` : `${games.filter((x) => x.state === 'pre').length} to come`);
                const lv = await D.mlbLive(g.mlb.pk, { ttl: D.mlbLivePace(g) });
                if (!lv) return;
                const key = [lv.pk, lv.status, lv.balls, lv.strikes, lv.outs, lv.bases.join(''), lv.batter.name, lv.pitcher.name,
                    lv.totals.away.r, lv.totals.home.r, lv.innings.length, (lv.plays[0] || {}).key, g.channel && g.channel.number,
                    live.map((x) => x.id).join(',')].join('|');
                if (key === lastKey) return;
                lastKey = key;
                first = false;
                // the chips: every live game, the one on screen lit
                chipsEl.innerHTML = '';
                if (live.length > 1) {
                    live.forEach((x) => {
                        const on = x.id === g.id;
                        const chip = el('div', 'sp-chip hb-focusable' + (on ? ' on' : ''),
                            `${ui.img(x.away.logo, '', x.away.abbr, x.away.logoFb)}<small>${esc(x.away.abbr)}</small><b>${esc(x.away.score)}</b>
                             <em>${esc(x.mlb.ord ? (x.mlb.isTop ? '▲' : '▼') + x.mlb.inning : '')}</em>
                             ${ui.img(x.home.logo, '', x.home.abbr, x.home.logoFb)}<small>${esc(x.home.abbr)}</small><b>${esc(x.home.score)}</b>`);
                        chip.dataset.key = 'chip' + x.id;
                        ctx.focusable(chip, () => { want = x.id; lastKey = ''; poller.now(); }, 'Show this game');
                        chipsEl.appendChild(chip);
                    });
                }
                s.body.innerHTML = '';
                if (chipsEl.childElementCount) s.body.appendChild(chipsEl);
                s.body.appendChild(liveView(ctx, g, lv));
                ctx.refocus();
            }, { every: () => (document.hidden ? 30000 : every) });
            // when the screen comes back, ask straight away rather than
            // waiting out the interval with a frozen game on screen
            const wake = () => { if (!document.hidden && poller) poller.now(); };
            document.addEventListener('visibilitychange', wake);
            ctx.onCleanup(() => document.removeEventListener('visibilitychange', wake));
            return s;
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
        // The Rangers' card says more than the others can, because baseball
        // tells us more: while they're playing, the bases, the count, the
        // outs and the matchup; before they play, who's starting for each
        // side. `lv` is the live feed when we have it (mlbLive).
        // a scoreboard's way with a name where there's no room for both:
        // "Jacob deGrom" -> "deGrom", "Nacho Alvarez Jr." -> "Alvarez Jr."
        const surname = (n) => {
            const parts = String(n || '').trim().split(/\s+/);
            if (parts.length < 2) return parts[0] || '';
            const tail = /^(Jr\.?|Sr\.?|II|III|IV)$/i.test(parts[parts.length - 1]) ? parts.slice(-2) : parts.slice(-1);
            return tail.join(' ');
        };
        const mlbMatchRow = (g, lv) => {
            if (!g || !g.mlb) return '';
            const m = g.mlb;
            if (g.state === 'in' && !m.dead) {
                const mid = /^(Mid|End)/i.test(m.half || '');
                if (mid) return `<div class="sp-match-mlb"><span class="dim">${esc(/^Mid/i.test(m.half) ? 'Middle of the ' + m.ord : 'End of the ' + m.ord)}</span></div>`;
                const p = lv && lv.pitcher.name ? `<span class="sp-match-who"><i>P</i>${esc(surname(lv.pitcher.name))}</span>` : '';
                const b = (lv && lv.batter.name) || m.batter;
                return `<div class="sp-match-mlb">
                    ${diamond(m.bases, 'sm')}
                    <b>${m.balls ?? 0}-${m.strikes ?? 0}</b>
                    ${outsDots(m.outs)}<span class="dim">${m.outs === 1 ? '1 out' : `${m.outs || 0} out`}</span>
                    ${p}${b ? `<span class="sp-match-who"><i>AB</i>${esc(surname(b))}</span>` : ''}
                </div>`;
            }
            if (g.state === 'pre' && !m.dead && (m.probables.away || m.probables.home)) {
                const one = (t, name) => `<span class="sp-match-who"><i>${esc(t.abbr)}</i>${esc(surname(name) || 'TBD')}</span>`;
                return `<div class="sp-match-mlb"><span class="dim">Probables</span>${one(g.away, m.probables.away)}${one(g.home, m.probables.home)}</div>`;
            }
            return '';
        };
        // one favorite's card: the live game, or the next one (the last one under it)
        const matchupCard = (ctx, tg, lv = null) => {
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
                    <b>${t.rank ? `<small>${t.rank}</small>` : ''}<span class="nm">${esc(t.short || t.abbr)}</span><span class="ab">${esc(t.abbr || t.short)}</span></b>
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
                ? `<span class="sp-match-tv on">${ui.icon('live_tv')}<span class="net">${esc(g.network || g.channel.name)}</span> <b>${esc(g.channel.number)}</b></span>`
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
            // baseball says more: the bases and the count while they're on,
            // the probables before, and the last play in place of the result
            const mlbRow = mlbMatchRow(g, lv);
            if (mlbRow && lv && lv.plays[0] && g.state === 'in') {
                lastLine = `<span class="sp-match-last play">${esc(lv.plays[0].desc)}</span>`;
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
                ${mlbRow}
                <div class="sp-match-foot">${lastLine}${tv}</div>`;
            if (mlbRow) card.classList.add('has-mlb');
            void mine;
            const live = g.channel && g.state === 'in';
            const act = live ? () => ctx.hub.watch(g.channel.ch) : () => ctx.hub.showTab(f.league === 'epl' ? 'soccer' : f.league);
            ctx.focusable(card, act, live ? `Watch ${g.network || g.channel.name}` : `${L0 ? L0.label : ''}`);
            return card;
        };
        // most relevant first: live, then the soonest game, then the rest
        const favOrder = (a, b) => (!!b.live - !!a.live)
            || ((a.next ? a.next.start : Infinity) - (b.next ? b.next.start : Infinity));

        const renderMyTeams = (ctx) => {
            // the four matchups
            let lastSig = '';
            // the Rangers' card is the one that can show a game pitch by
            // pitch, so this tab polls at the baseball's pace while they're
            // playing and at the usual one when they're not
            let every = MIN;
            liveSection(ctx, 'My teams', async (body) => {
                if (document.hidden) return;
                const all = await Promise.all(D.FAVS.map((f) => D.teamGames(f).catch(() => ({ fav: f, last: null, next: null, live: null, team: {} }))));
                all.sort(favOrder);
                if (all.some((t) => t.live)) liveAny = true;
                // just the four cards' games, not a favorite's whole schedule
                await D.resolveChannels(all.map((t) => t.live || t.next || t.last).filter(Boolean)).catch(() => null);
                // one extra request, for one game: the Rangers'
                const tex = all.find((t) => t.fav.league === 'mlb');
                const texGame = tex ? (tex.live || tex.next || tex.last) : null;
                every = texGame && (tex.live || (texGame.state === 'pre' && /warmup|pre-?game/i.test(texGame.mlb.detailed))) ? D.mlbLivePace(texGame) : pace();
                const lv = tex && tex.live ? await D.mlbLive(tex.live.mlb.pk, { ttl: D.mlbLivePace(tex.live) }).catch(() => null) : null;
                const k = all.map((t) => [t.fav.key, sig([t.live, t.next, t.last].filter(Boolean))].join('=')).join('#')
                    + (lv ? `|${lv.balls}-${lv.strikes}|${lv.outs}|${lv.bases.join('')}|${lv.batter.name}|${lv.pitcher.name}|${(lv.plays[0] || {}).key || ''}` : '');
                if (k === lastSig) return;
                lastSig = k;
                body.innerHTML = '';
                const g = el('div', 'hb-grid sp-matches');
                g.style.setProperty('--cols', 2);
                all.forEach((t) => g.appendChild(matchupCard(ctx, t, t === tex ? lv : null)));
                body.appendChild(g);
            }, { every: () => (document.hidden ? 30000 : every), cls: 'sp-my' });

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
            mlbLiveSection(ctx);
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

        // The ticker already carries every league's scores, so baseball
        // doesn't get a strip of its own — its line just says more than it
        // could before: "TEX 5 BOS 3  BOT 7TH · 2 OUT, CORNERS", and
        // "POSTPONED · RAIN" where ESPN only ever said the game was over.
        const tickerGame = (g) => {
            const m = g.mlb;
            if (!m || g.state !== 'in' || m.dead || /^(Mid|End)/i.test(m.half || '')) return g;
            const on = m.bases.filter(Boolean).length;
            const who = on === 3 ? 'loaded' : on === 2 && m.bases[0] && m.bases[2] ? 'corners' : on ? `on ${[m.bases[0] && '1st', m.bases[1] && '2nd', m.bases[2] && '3rd'].filter(Boolean).join(' & ')}` : '';
            const bits = [`${m.outs || 0} out`, who].filter(Boolean).join(', ');
            return Object.assign({}, g, { status: bits ? `${g.status} · ${bits}` : g.status });
        };
        const tickerSource = async (hub) => {
            const leagues = ['mlb', 'nfl', 'cfb', 'epl', 'ucl', 'nba', 'nhl'];
            const res = await Promise.all(leagues.map((k) => D.scores(k).catch(() => [])));
            const now = Date.now();
            let live = false;
            // narrow to what the ticker actually shows *before* asking the
            // guide about any of it — one batched resolve for everything on
            // the ticker, not a fetch for the whole slate of every league
            const picks = leagues.map((k, i) => {
                const games = res[i];
                if (D.anyLive(games)) live = true;
                // what's worth a ticker: live, finals from the last day and a half,
                // and games in the next two days (soccer: the next four)
                const ahead = (k === 'epl' || k === 'ucl') ? 4 : (k === 'nfl' || k === 'cfb') ? 6 : 2;
                const pick = games.filter((g) => g.state === 'in'
                    || (g.state === 'post' && now - g.start < 36 * 3600000)
                    || (g.state === 'pre' && g.start - now < ahead * 86400000));
                // NBA and NHL only when they're playing
                if ((k === 'nba' || k === 'nhl') && !pick.some((g) => g.start - now < 86400000)) return null;
                return pick.length ? { k, pick: pick.slice(0, 40) } : null;
            }).filter(Boolean);
            await D.resolveChannels(picks.flatMap((p) => p.pick)).catch(() => null);
            const segs = picks.map(({ k, pick }) => {
                const Lg = L[k];
                return {
                    label: Lg.label === 'College FB' ? 'NCAAF' : Lg.label === 'Premier League' ? 'Prem' : Lg.label === 'Champions League' ? 'UCL' : Lg.label,
                    logo: Lg.logo,
                    items: pick.map((g) => HomerTicker.score(tickerGame(g), { act: g.channel && g.state === 'in' ? () => hub.watch(g.channel.ch) : null }))
                };
            });
            // the favorites' own next (or live) game and last result, wherever
            // they are (a cup game, next week's NFL game): into My Teams
            const seen = new Set(segs.flatMap((sg) => sg.items.map((i) => i.key)));
            const tgs = await Promise.all(D.FAVS.map((f) => D.teamGames(f).catch(() => null)));
            const extraGames = [];
            tgs.filter(Boolean).forEach((tg) => {
                [tg.live, tg.next, tg.last].filter(Boolean).forEach((g) => {
                    if (seen.has(g.id)) return;
                    if (g === tg.last && now - g.start > 4 * 86400000) return; // an old result
                    seen.add(g.id);
                    extraGames.push(g);
                });
            });
            await D.resolveChannels(extraGames).catch(() => null);
            const extra = extraGames.map((g) => {
                if (g.state === 'in') live = true;
                return HomerTicker.score(tickerGame(g), { priority: true, act: g.channel && g.state === 'in' ? () => hub.watch(g.channel.ch) : null });
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
            phone: true, // its phone layout (shared/hub.js)
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
