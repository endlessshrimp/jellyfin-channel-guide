/*
 * HOMER Sports data: ESPN's public site API (it answers any page: CORS *),
 * turned into the shapes the Sports hub draws. No key, no account.
 *
 *   scores(league)          the league's games around now, as HomerHub games
 *   standings(league)       groups (divisions, the table) of team rows
 *   rankings(league)        the AP Top 25 (college football and basketball)
 *   news(league, { team })  articles with pictures
 *   teamGames(fav)          a favorite team's last game and next game
 *
 * Every call goes through HomerHub.data (a cache per URL, one request at a
 * time, timeouts), so the ticker and the tabs share what's been fetched.
 * Scores are fresh for 30 seconds (15 while a game is live), standings and
 * rankings for 30 minutes, news for 10.
 *
 * Favorites (Jason's): the Rangers (MLB), the Cowboys (NFL), the Texas
 * Longhorns (college football) and Arsenal (soccer). Their games lead every
 * list and the ticker's MY TEAMS segment.
 *
 * window.HomerSportsData = { LEAGUES, FAVS, scores, standings, rankings, news,
 *                            teamGames, game, isFav, anyLive, version }
 */
(() => {
    const VERSION = '0.1.0';

    const SITE = 'https://site.api.espn.com/apis/site/v2/sports/';
    const V2 = 'https://site.api.espn.com/apis/v2/sports/';
    const MIN = 60000;
    const H = () => window.HomerHub;

    // ---------- Leagues ----------

    const LEAGUES = {
        mlb: { key: 'mlb', label: 'MLB', name: 'MLB', path: 'baseball/mlb', color: '#0a3a7e', logo: 'https://a.espncdn.com/i/teamlogos/leagues/500/mlb.png' },
        nfl: { key: 'nfl', label: 'NFL', name: 'NFL', path: 'football/nfl', color: '#013369', logo: 'https://a.espncdn.com/i/teamlogos/leagues/500/nfl.png' },
        cfb: { key: 'cfb', label: 'College FB', name: 'College Football', path: 'football/college-football', color: '#7a2a12', logo: 'https://a.espncdn.com/i/teamlogos/leagues/500/ncaa.png' },
        epl: { key: 'epl', label: 'Premier League', name: 'Premier League', path: 'soccer/eng.1', color: '#3d195b', logo: 'https://a.espncdn.com/i/leaguelogos/soccer/500/23.png' },
        ucl: { key: 'ucl', label: 'Champions League', name: 'Champions League', path: 'soccer/uefa.champions', color: '#0b1e5b', logo: 'https://a.espncdn.com/i/leaguelogos/soccer/500/2.png' },
        nba: { key: 'nba', label: 'NBA', name: 'NBA', path: 'basketball/nba', color: '#1d428a', logo: 'https://a.espncdn.com/i/teamlogos/leagues/500/nba.png' },
        nhl: { key: 'nhl', label: 'NHL', name: 'NHL', path: 'hockey/nhl', color: '#111111', logo: 'https://a.espncdn.com/i/teamlogos/leagues/500/nhl.png' },
        cbb: { key: 'cbb', label: 'College Hoops', name: 'College Basketball', path: 'basketball/mens-college-basketball', color: '#1a3b73', logo: 'https://a.espncdn.com/i/teamlogos/leagues/500/ncaa.png' }
    };

    // the favorites, by league: ESPN's team id (and its abbreviation there)
    const FAVS = [
        { key: 'rangers', league: 'mlb', id: '13', abbr: 'TEX', name: 'Rangers', full: 'Texas Rangers', color: '#003278' },
        { key: 'cowboys', league: 'nfl', id: '6', abbr: 'DAL', name: 'Cowboys', full: 'Dallas Cowboys', color: '#002a5c' },
        { key: 'texas', league: 'cfb', id: '251', abbr: 'TEX', name: 'Longhorns', full: 'Texas Longhorns', color: '#bf5700' },
        { key: 'arsenal', league: 'epl', id: '359', abbr: 'ARS', name: 'Arsenal', full: 'Arsenal', color: '#db0007' }
    ];
    const favFor = (league, teamId) => FAVS.find((f) => (f.league === league || (f.league === 'epl' && league === 'ucl')) && String(f.id) === String(teamId)) || null;
    const isFav = (league, teamId) => !!favFor(league, teamId);

    // ---------- Dates ----------

    const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const dayOffset = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };

    // ---------- Logos ----------
    // ESPN draws its logos for a light page; most have a version for a dark
    // one (500-dark), which reads better on HOMER's navy. The light one is the
    // fallback when there isn't.
    const darkLogo = (url) => (url && /\/i\/teamlogos\/[^/]+\/500\//.test(url) ? url.replace('/500/', '/500-dark/') : url);
    const teamLogo = (team) => {
        if (!team) return '';
        if (team.logo) return team.logo;
        const ls = team.logos || [];
        const dark = ls.find((l) => (l.rel || []).includes('dark') && !(l.rel || []).includes('scoreboard'));
        return (dark || ls[0] || {}).href || '';
    };

    // ---------- Team colors ----------
    // ESPN's scoreboards carry each team's color; a team's schedule doesn't.
    // Colors seen anywhere are kept (by sport and team), and the leagues with
    // a small team list fetch it once a day.
    const colors = new Map();
    const colorKey = (league, id) => `${/^soccer\//.test((LEAGUES[league] || {}).path || '') ? 'soccer' : league}:${id}`;
    const teamColors = async (league) => {
        if (!['mlb', 'nfl', 'nba', 'nhl', 'epl'].includes(league)) return;
        const r = await get(`${SITE}${LEAGUES[league].path}/teams`, 24 * 60 * MIN).catch(() => null);
        const teams = (r && r.sports && r.sports[0] && r.sports[0].leagues && r.sports[0].leagues[0].teams) || [];
        teams.forEach((x) => { if (x.team && x.team.color) colors.set(colorKey(league, x.team.id), x.team.color); });
    };

    // ---------- Games ----------

    const scoreOf = (x) => {
        const s = x && x.score;
        if (s == null) return '';
        if (typeof s === 'object') return s.displayValue ?? (s.value != null ? String(Math.round(s.value)) : '');
        return String(s);
    };
    // The TV networks for a game: { national, local, all }. National TV
    // first, then the teams' own (regional) networks, then streaming.
    const networksOf = (c) => {
        const national = [];
        const local = [];
        const all = [];
        const push = (list, n) => { if (n && !list.includes(n)) list.push(n); };
        const geo = c.geoBroadcasts || [];
        geo.filter((b) => b.market && /national/i.test(b.market.type || '')).forEach((b) => push(national, b.media && b.media.shortName));
        (c.broadcasts || []).filter((b) => b.market === 'national').forEach((b) => (b.names || []).forEach((n) => push(national, n)));
        geo.filter((b) => b.market && !/national/i.test(b.market.type || '')).forEach((b) => push(local, b.media && b.media.shortName));
        (c.broadcasts || []).filter((b) => b.market === 'home' || b.market === 'away').forEach((b) => (b.names || []).forEach((n) => push(local, n)));
        // a team's schedule writes them as { media: { shortName } } with no market
        (c.broadcasts || []).forEach((b) => {
            if (!b.media || !b.media.shortName) return;
            const mk = typeof b.market === 'object' && b.market ? b.market.type : b.market;
            push(!mk || /national/i.test(mk) ? national : local, b.media.shortName);
        });
        national.concat(local).forEach((n) => push(all, n));
        return { national, local, all };
    };
    const STREAMING = /^(MLB\.TV|ESPN\+|ESPN Unlmtd|Peacock|Paramount\+|Prime Video|Netflix|Apple TV|DAZN|Fubo|NBA League Pass|NHL Power Play|YouTube|Max|SECN\+|ACCNX|B1G\+|Victory\+)$/i;

    // An ESPN event -> a HomerHub game (see HomerHub.ui.scoreCard)
    const game = (e, league) => {
        const c = (e.competitions || [])[0] || {};
        const st = (c.status || e.status || {}).type || {};
        const comps = c.competitors || [];
        const side = (ha) => {
            const x = comps.find((y) => y.homeAway === ha) || {};
            const t = x.team || {};
            const light = teamLogo(t);
            const rank = x.curatedRank && x.curatedRank.current;
            const rec = (x.records || x.record || [])[0];
            const tid = t.id || x.id;
            if (t.color && tid) colors.set(colorKey(league, tid), t.color);
            return {
                id: String(t.id || x.id || ''),
                abbr: t.abbreviation || '',
                name: t.displayName || t.name || '',
                short: t.shortDisplayName || t.nickname || t.name || t.abbreviation || '',
                logo: darkLogo(light),
                logoFb: light,
                score: scoreOf(x),
                rank: rank && rank <= 25 ? rank : null,
                record: rec ? (rec.summary || rec.displayValue || '') : '',
                winner: !!x.winner,
                color: t.color || colors.get(colorKey(league, tid)) || '',
                fav: isFav(league, tid)
            };
        };
        const away = side('away');
        const home = side('home');
        const start = new Date(e.date || c.date);
        const state = st.state || 'pre';
        const F = H() && H().fmt;
        let status;
        if (state === 'pre') {
            if (/postponed|canceled|cancelled|suspended|delayed/i.test(st.name || '')) status = st.shortDetail || st.description;
            else if (c.timeValid === false || e.timeValid === false || /TBD/.test(st.shortDetail || '')) status = F ? `${F.day(start)} · TBD` : 'TBD';
            else status = F ? F.when(start) : start.toLocaleTimeString();
        } else if (state === 'in') status = st.shortDetail || st.detail || 'Live';
        else status = /postponed|canceled|cancelled/i.test(st.name || '') ? (st.shortDetail || 'Postponed') : (st.shortDetail || 'Final');
        const nets = networksOf(c);
        const isTv = (n) => !STREAMING.test(n);
        // our channel for it, if one of its networks is in the lineup
        const hit = H() ? H().channels.forNetworkNow(nets.all.filter(isTv).concat(nets.all)) : null;
        const favGame = away.fav || home.fav;
        // the network to name: ours, else national TV, else (for a favorite) the local one
        const network = hit ? hit.name : (nets.national.filter(isTv)[0] || (favGame ? nets.local.filter(isTv)[0] || nets.all[0] : '') || '');
        const short = state === 'pre' && F && !/TBD|postponed|canceled|cancelled|delayed/i.test(status)
            ? (F.day(start) === 'Today' ? F.time(start) : `${start.toLocaleDateString([], { weekday: 'short' })} ${F.time(start)}`)
            : status;
        const note = (c.notes && c.notes[0] && c.notes[0].headline) || (e.season && e.season.slug === 'post-season' ? '' : '');
        return {
            id: String(e.id),
            league,
            state,
            status,
            start,
            away,
            home,
            network,
            networks: nets.all,
            short,
            channel: hit ? { number: hit.ch.Number, name: hit.ch.Name, ch: hit.ch } : null,
            note,
            name: e.shortName || e.name || '',
            priority: away.fav || home.fav,
            round: (e.week && e.week.number) || null,
            competition: (e.league && e.league.abbreviation) || (e.seasonType && e.seasonType.name) || ''
        };
    };
    // favorites first, then live, then finals from the last 18 hours (newest
    // first), then what's coming (soonest first), then older finals
    const bucket = (g) => {
        if (g.state === 'in') return 0;
        if (g.state === 'post') return Date.now() - g.start < 18 * 3600000 ? 1 : 3;
        return 2;
    };
    const byInterest = (a, b) => (b.priority - a.priority)
        || (bucket(a) - bucket(b))
        || (a.state === 'post' ? b.start - a.start : a.start - b.start)
        || (Math.min(a.away.rank || 99, a.home.rank || 99) - Math.min(b.away.rank || 99, b.home.rank || 99));

    const get = (url, ttl) => H().data.fetchSoft(url, { ttl, timeout: 15000 });

    // ---------- Scores ----------

    let lastLive = false;
    // The games worth showing now, per league:
    //   MLB, NBA, NHL   yesterday and today
    //   NFL             ESPN's current week
    //   college FB      ESPN's current week: the Top 25, the SEC and the Big 12
    //   soccer          the last 4 days and the next 10
    const scores = async (league) => {
        const L = LEAGUES[league];
        if (!L) return [];
        await H().channels.lineup().catch(() => null); // so games can name our channels
        const ttl = lastLive ? 15000 : 30000;
        let events = [];
        if (league === 'mlb' || league === 'nba' || league === 'nhl') {
            const r = await get(`${SITE}${L.path}/scoreboard?dates=${ymd(dayOffset(-1))}-${ymd(dayOffset(0))}`, ttl);
            events = (r && r.events) || [];
            // nothing yesterday or today (the off season, a break): whatever ESPN has next
            if (!events.length) {
                const n = await get(`${SITE}${L.path}/scoreboard`, 10 * MIN);
                events = (n && n.events) || [];
            }
        } else if (league === 'nfl') {
            const r = await get(`${SITE}${L.path}/scoreboard`, ttl);
            events = (r && r.events) || [];
        } else if (league === 'cfb') {
            const rs = await Promise.all([
                get(`${SITE}${L.path}/scoreboard`, ttl), // the Top 25
                get(`${SITE}${L.path}/scoreboard?groups=8`, ttl).catch(() => null), // SEC
                get(`${SITE}${L.path}/scoreboard?groups=4`, ttl).catch(() => null) // Big 12
            ]);
            const seen = new Set();
            rs.forEach((r, k) => ((r && r.events) || []).forEach((e) => {
                if (seen.has(e.id)) return;
                seen.add(e.id);
                e._conf = ['', 'SEC', 'Big 12'][k];
                events.push(e);
            }));
        } else if (league === 'cbb') {
            const r = await get(`${SITE}${L.path}/scoreboard`, ttl);
            events = (r && r.events) || [];
        } else {
            const r = await get(`${SITE}${L.path}/scoreboard?dates=${ymd(dayOffset(-4))}-${ymd(dayOffset(10))}`, ttl);
            events = (r && r.events) || [];
        }
        const games = events.map((e) => {
            const g = game(e, league);
            if (e._conf) g.conf = e._conf;
            return g;
        });
        games.sort(byInterest);
        return games;
    };
    const anyLive = (games) => games.some((g) => g.state === 'in');
    const noteLive = (live) => { lastLive = live; };

    // ---------- Standings ----------

    const stat = (entry, name) => {
        const s = (entry.stats || []).find((x) => x.name === name || x.abbreviation === name || x.type === name);
        return s ? (s.displayValue ?? s.summary ?? s.value) : '';
    };
    // [{ name, short, rows: [{ id, abbr, name, logo, stats(name), note, fav }] }]
    const standings = async (league) => {
        const L = LEAGUES[league];
        const q = league === 'mlb' || league === 'nfl' || league === 'nba' || league === 'nhl' ? '?level=3' : '';
        const r = await get(`${V2}${L.path}/standings${q}`, 30 * MIN);
        const groups = [];
        const walk = (n) => {
            if (n.standings && n.standings.entries && n.standings.entries.length) {
                const byPct = ['mlb', 'nfl', 'nba'].includes(league);
                groups.push({
                    sorted: byPct,
                    name: n.name || '',
                    short: n.abbreviation || n.shortName || n.name || '',
                    rows: n.standings.entries.map((e) => {
                        const t = e.team || {};
                        const light = teamLogo(t);
                        return {
                            id: String(t.id || ''),
                            abbr: t.abbreviation || '',
                            name: t.shortDisplayName || t.displayName || t.name || '',
                            full: t.displayName || '',
                            logo: darkLogo(light),
                            logoFb: light,
                            note: e.note || null,
                            fav: isFav(league, t.id),
                            stat: (k) => stat(e, k)
                        };
                    })
                });
            }
            (n.children || []).forEach(walk);
        };
        walk(r || {});
        // a division best first (ESPN lists some by name)
        groups.forEach((g) => {
            if (!g.sorted) return;
            const pct = (x) => parseFloat(x.stat('winPercent')) || 0;
            g.rows.sort((a, b) => pct(b) - pct(a) || (parseFloat(b.stat('wins')) || 0) - (parseFloat(a.stat('wins')) || 0));
        });
        return groups;
    };
    // MLB's wild card races: each league's teams by playoff seed
    const wildCard = async () => {
        const r = await get(`${V2}baseball/mlb/standings`, 30 * MIN);
        return ((r && r.children) || []).map((lg) => {
            const rows = ((lg.standings && lg.standings.entries) || []).map((e) => {
                const t = e.team || {};
                const light = teamLogo(t);
                return {
                    id: String(t.id || ''), abbr: t.abbreviation || '', name: t.shortDisplayName || t.displayName || '',
                    logo: darkLogo(light), logoFb: light, fav: isFav('mlb', t.id), seed: +stat(e, 'playoffSeed') || 99,
                    stat: (k) => stat(e, k)
                };
            }).sort((a, b) => a.seed - b.seed);
            return { name: lg.name, short: lg.abbreviation, rows };
        });
    };

    // ---------- Rankings ----------

    // { title, week, inSeason, ranks: [{ rank, prev, trend, points, fpv, record, team }] }
    const rankings = async (league) => {
        const L = LEAGUES[league];
        const r = await get(`${SITE}${L.path}/rankings`, 30 * MIN);
        const list = (r && r.rankings) || [];
        const ap = list.find((x) => x.type === 'ap') || list[0];
        if (!ap) return null;
        const season = ap.season || {};
        const ended = season.endDate && Date.parse(season.endDate) < Date.now();
        return {
            title: ap.name || 'AP Top 25',
            week: (ap.occurrence && ap.occurrence.displayValue) || '',
            headline: ap.headline || '',
            season: season.displayName || String(season.year || ''),
            final: !!ended || (season.type && season.type.abbreviation === 'post' && ap.occurrence && ap.occurrence.last),
            inSeason: !ended,
            ranks: (ap.ranks || []).map((x) => {
                const t = x.team || {};
                const light = t.logo || teamLogo(t);
                return {
                    rank: x.current,
                    prev: x.previous,
                    trend: x.trend,
                    points: x.points,
                    fpv: x.firstPlaceVotes,
                    record: x.recordSummary || '',
                    id: String(t.id || ''),
                    abbr: t.abbreviation || '',
                    name: t.nickname || t.location || t.name || '',
                    mascot: t.name || '',
                    logo: darkLogo(light),
                    logoFb: light,
                    color: t.color || '',
                    conf: (t.groups && t.groups.shortName) || '',
                    fav: isFav(league, t.id)
                };
            })
        };
    };

    // ---------- News ----------

    // [{ title, image, published, source, summary, tag, type }]
    const news = async (league, { team = null, limit = 12 } = {}) => {
        const L = LEAGUES[league];
        const r = await get(`${SITE}${L.path}/news?limit=${limit + 6}${team ? `&team=${team}` : ''}`, 10 * MIN);
        return ((r && r.articles) || [])
            .filter((a) => a.headline && a.type !== 'Media') // video clips are just a headline
            .map((a) => {
                const pic = (a.images || []).find((i) => i.type === 'header') || (a.images || [])[0];
                return {
                    id: String(a.id || a.headline),
                    title: a.headline,
                    summary: a.description || '',
                    image: pic ? pic.url : '',
                    published: a.published || a.lastModified,
                    source: a.byline && !/^ESPN$/i.test(a.byline) ? `ESPN · ${a.byline}` : 'ESPN',
                    type: a.type || '',
                    tag: a.type === 'Recap' ? 'Recap' : a.premium ? 'ESPN+' : ''
                };
            })
            .slice(0, limit);
    };

    // ---------- A favorite's games ----------

    // { last, next, team: { record, standing, logo, color } }
    const teamGames = async (fav) => {
        const L = LEAGUES[fav.league];
        await H().channels.lineup().catch(() => null);
        const soccer = fav.league === 'epl';
        const urls = soccer
            ? [`${SITE}soccer/all/teams/${fav.id}/schedule?fixture=true`, `${SITE}${L.path}/teams/${fav.id}/schedule`, `${SITE}soccer/uefa.champions/teams/${fav.id}/schedule`]
            : [`${SITE}${L.path}/teams/${fav.id}/schedule`];
        const [rs] = await Promise.all([
            Promise.all(urls.map((u, k) => get(u, 20 * MIN).catch((err) => { if (k === 0) throw err; return null; }))),
            teamColors(fav.league),
            scores(fav.league).catch(() => []) // this week's opponents' colors
        ]);
        const team = (rs[0] && rs[0].team) || {};
        const all = [];
        const seen = new Set();
        rs.forEach((r, k) => ((r && r.events) || []).forEach((e) => {
            if (seen.has(e.id)) return;
            seen.add(e.id);
            const lg = soccer ? (k === 2 ? 'ucl' : 'epl') : fav.league;
            const g = game(e, lg);
            g.competition = (e.league && (e.league.shortName || e.league.abbreviation)) || (k === 2 ? 'Champions League' : k === 1 ? 'Premier League' : g.competition);
            all.push(g);
        }));
        const now = Date.now();
        const done = all.filter((g) => g.state === 'post' && !/postponed|canceled/i.test(g.status)).sort((a, b) => b.start - a.start);
        const live = all.find((g) => g.state === 'in');
        const next = all.filter((g) => g.state === 'pre' && g.start.getTime() > now - 6 * 3600000).sort((a, b) => a.start - b.start)[0] || null;
        const light = teamLogo(team);
        return {
            fav,
            live: live || null,
            last: done[0] || null,
            next,
            team: {
                record: team.recordSummary || '',
                standing: (team.standingSummary || '').replace(/English Premier League/, 'Premier League'),
                logo: darkLogo(light) || '',
                logoFb: light,
                color: team.color ? '#' + team.color : fav.color,
                alt: team.alternateColor ? '#' + team.alternateColor : ''
            }
        };
    };

    window.HomerSportsData = {
        version: VERSION,
        LEAGUES,
        FAVS,
        scores,
        standings,
        wildCard,
        rankings,
        news,
        teamGames,
        game,
        isFav,
        favFor,
        anyLive,
        noteLive,
        darkLogo
    };
})();
