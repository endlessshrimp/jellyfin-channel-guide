/*
 * HOMER Sports data: ESPN's public site API (it answers any page: CORS *),
 * turned into the shapes the Sports hub draws. No key, no account.
 *
 * Baseball is the exception: MLB runs its own StatsAPI (statsapi.mlb.com,
 * also no key and also CORS *), and it knows things ESPN's scoreboard never
 * says — the count, the outs, who's on which base, who's at the plate and on
 * the mound, the line score inning by inning, the last play, and what a game
 * is *actually* doing (Warmup, Delayed: Rain, Postponed, Final/10). So MLB
 * comes from there and every other league stays on ESPN. See the MLB section
 * below; scores('mlb') and teamGames(rangers) return the same shapes as the
 * rest, with the baseball hung off game.mlb.
 *
 *   scores(league)          the league's games around now, as HomerHub games
 *   standings(league)       groups (divisions, the table) of team rows
 *   rankings(league)        the AP Top 25 (college football and basketball)
 *   news(league, { team })  articles with pictures
 *   teamGames(fav)          a favorite team's last game and next game
 *   resolveChannels(games)  fills in g.channel for the games actually on
 *                           screen, by asking the guide which of a network's
 *                           candidate channels is really showing each one —
 *                           see "Regional channel resolution" below
 *
 * Every call goes through HomerHub.data (a cache per URL, one request at a
 * time, timeouts), so the ticker and the tabs share what's been fetched.
 * Scores are fresh for 15 seconds while a league has a game live, a minute
 * when one's about to start, else 5 minutes; standings and rankings for 30
 * minutes, news for 10.
 *
 * Favorites (Jason's): the Rangers (MLB), the Cowboys (NFL), the Texas
 * Longhorns (college football) and Arsenal (soccer). Their games lead every
 * list and the ticker's MY TEAMS segment.
 *
 * MLB is also the one league whose live state can run ahead of Jason's
 * broadcast, so the games it returns (and the one-game feed below) can be
 * held back a configurable number of seconds — see "Live delay" below;
 * settings/settings.js is the dial.
 *
 * window.HomerSportsData = { LEAGUES, FAVS, scores, standings, rankings, news,
 *                            teamGames, resolveChannels, game, isFav,
 *                            anyLive, version, mlbLive, mlbLivePace,
 *                            mlbStanding, mlbTeams, delaySeconds,
 *                            setDelaySeconds, DELAY_OPTIONS, DELAY_DEFAULT }
 */
(() => {
    const VERSION = '0.3.0';

    const SITE = 'https://site.api.espn.com/apis/site/v2/sports/';
    const V2 = 'https://site.api.espn.com/apis/v2/sports/';
    const MIN = 60000;
    const H = () => window.HomerHub;
    const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
    const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } };

    // ---------- Leagues ----------

    const LEAGUES = {
        mlb: { key: 'mlb', label: 'MLB', name: 'MLB', path: 'baseball/mlb', color: '#0a3a7e', logo: 'https://a.espncdn.com/i/teamlogos/leagues/500-dark/mlb.png' },
        nfl: { key: 'nfl', label: 'NFL', name: 'NFL', path: 'football/nfl', color: '#013369', logo: 'https://a.espncdn.com/i/teamlogos/leagues/500-dark/nfl.png' },
        cfb: { key: 'cfb', label: 'College FB', name: 'College Football', path: 'football/college-football', color: '#7a2a12', logo: 'https://a.espncdn.com/redesign/assets/img/icons/ESPN-icon-football-college.png' },
        epl: { key: 'epl', label: 'Premier League', name: 'Premier League', path: 'soccer/eng.1', color: '#3d195b', logo: 'https://a.espncdn.com/i/leaguelogos/soccer/500-dark/23.png' },
        ucl: { key: 'ucl', label: 'Champions League', name: 'Champions League', path: 'soccer/uefa.champions', color: '#0b1e5b', logo: 'https://a.espncdn.com/i/leaguelogos/soccer/500-dark/2.png' },
        nba: { key: 'nba', label: 'NBA', name: 'NBA', path: 'basketball/nba', color: '#1d428a', logo: 'https://a.espncdn.com/i/teamlogos/leagues/500/nba.png' },
        nhl: { key: 'nhl', label: 'NHL', name: 'NHL', path: 'hockey/nhl', color: '#111111', logo: 'https://a.espncdn.com/i/teamlogos/leagues/500-dark/nhl.png' },
        cbb: { key: 'cbb', label: 'College Hoops', name: 'College Basketball', path: 'basketball/mens-college-basketball', color: '#1a3b73', logo: 'https://a.espncdn.com/redesign/assets/img/icons/ESPN-icon-basketball.png' }
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
    // every lineup channel that could carry one of `names` (plural: a
    // network can have more than one regional feed), and the name that hit —
    // see resolveChannels below for how a game picks the right one of them
    const chanLookup = (names) => (H() ? H().channels.forNetworkAllNow(names) : null);

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
        // every lineup channel that could be carrying it (a network can have
        // several regional feeds); resolveChannels below asks the guide which
        // one actually is, before this game is ever tunable
        const match = chanLookup(nets.all.filter(isTv).concat(nets.all));
        const favGame = away.fav || home.fav;
        // the network to name: ours, else national TV, else (for a favorite) the local one
        const network = match ? match.name : (nets.national.filter(isTv)[0] || (favGame ? nets.local.filter(isTv)[0] || nets.all[0] : '') || '');
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
            homeFirst: /^soccer\//.test((LEAGUES[league] || {}).path || ''),
            short,
            // filled in by resolveChannels(), once the guide confirms which
            // of _chanCandidates (if any) is really showing this game
            channel: null,
            _chanCandidates: match ? match.chans : [],
            note,
            name: e.shortName || e.name || '',
            priority: away.fav || home.fav,
            round: (e.week && e.week.number) || null,
            competition: (e.league && e.league.abbreviation) || (e.seasonType && e.seasonType.name) || ''
        };
    };

    // ---------- Regional channel resolution ----------
    //
    // A network name doesn't pin down a channel: "FOX" can be FOX 4 Dallas
    // and a "FOX 4 Plus" subchannel both, and — the case that actually bit
    // Jason — FOX regionalizes, so two different games can both legitimately
    // say "FOX" while his one FOX 4 affiliate only carries one of them.
    // chanLookup (above) already finds every lineup channel a game's network
    // could mean; resolveChannels asks Jellyfin's guide what each of those
    // channels is really showing during the game's window and keeps the one
    // whose listing actually names both teams — never a guess between
    // several plausible channels, and never a channel whose listing is a
    // replay (Jellyfin's IsRepeat, or a title that says so).
    const REPLAY_RE = /\b(replay|encore|re-?air(?:ed|ing)?)\b/i;
    const isReplay = (p) => !!p.IsRepeat || REPLAY_RE.test(`${p.Name || ''} ${p.EpisodeTitle || ''}`);
    const normText = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
    // a side's full name and nickname ("Kansas City Royals", "Royals") — not
    // the abbreviation, too short to be a reliable signal on its own
    const sideNames = (side) => [side && side.name, side && side.short].map(normText).filter((s) => s.length >= 4);
    // both teams named somewhere in the programme's title, episode title or
    // synopsis (Jason's guide source puts the matchup in the synopsis for a
    // lot of channels — "Live: MLB Baseball" tells you nothing by itself)
    const programIsGame = (p, g) => {
        const text = normText(`${p.Name || ''} ${p.EpisodeTitle || ''} ${p.Overview || ''}`);
        const has = (side) => sideNames(side).some((n) => text.includes(n));
        return has(g.away) && has(g.home);
    };
    const COVER_TOL = 20 * MIN; // EPG block boundaries wobble against a game's actual start
    const covers = (p, t) => p._s - COVER_TOL <= t && p._e + COVER_TOL >= t;
    // Resolve g.channel for every game in `games` that's worth it (not
    // final, and has at least one candidate channel), with one batched guide
    // query covering all of them — not one fetch per game, and not one for
    // games nobody's looking at (call this on what's actually on screen).
    // Mutates and returns the same games. programsFor caches per
    // channel-set-and-window, so calling this again for the same games (a
    // poll redraw) re-asks Jellyfin nothing.
    const resolveChannels = async (games) => {
        const H_ = H();
        const list = (games || []).filter((g) => g && g.state !== 'post' && g._chanCandidates && g._chanCandidates.length);
        if (!H_ || !list.length) return games;
        const ids = new Set();
        let lo = Infinity;
        let hi = -Infinity;
        list.forEach((g) => {
            g._chanCandidates.forEach((c) => ids.add(c.Id));
            const t = g.start.getTime();
            lo = Math.min(lo, t - 45 * MIN);
            hi = Math.max(hi, t + 4 * 3600000); // most games are done inside 4h
        });
        const items = await H_.channels.programsFor([...ids], { from: lo, to: hi }).catch(() => []);
        const byChan = new Map();
        items.forEach((p) => {
            p._s = Date.parse(p.StartDate);
            p._e = Date.parse(p.EndDate);
            if (!byChan.has(p.ChannelId)) byChan.set(p.ChannelId, []);
            byChan.get(p.ChannelId).push(p);
        });
        list.forEach((g) => {
            const t = g.start.getTime();
            // more than one block can cover the window (a pregame show
            // butts right up against tip-off) — any of them naming the game
            // counts, not just whichever comes first
            const named = g._chanCandidates.filter((ch) => (byChan.get(ch.Id) || [])
                .filter((p) => covers(p, t))
                .some((p) => !isReplay(p) && programIsGame(p, g)));
            // exactly one channel whose listing actually names this game:
            // resolved. Zero (no listing yet, or none of them match) or more
            // than one (ambiguous) — leave it a named network, not tunable.
            g.channel = named.length === 1 ? { number: named[0].Number, name: named[0].Name, ch: named[0] } : null;
        });
        return games;
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

    // ---------- Live delay ----------
    //
    // Jason's broadcast runs a bit behind StatsAPI — MLB's feed knows about a
    // home run before his TV shows it. So every live MLB fetch below (the
    // slate, the one-game feed, the play log that seeds it) can ask
    // StatsAPI's own ?timecode= for "the game as it stood N seconds ago"
    // instead of its real-time state. That's exact — unlike buffering
    // snapshots here, it doesn't depend on how often this polls — and it
    // covers everything StatsAPI hands back for that request in one go: the
    // score, the count, the bases, the line score, the last play, all as of
    // the same moment.
    //
    // The setting (settings/settings.js) is a plain number of seconds in
    // localStorage; 0 is off. Every read rounds down to a 5-second bucket
    // before turning it into a timecode: several pollers ask for the slate
    // or a game's feed within a second or two of each other (the MLB tab,
    // My Teams, the ticker), and landing on the same bucket means they land
    // on the same URL and share one request instead of each minting its
    // own. Rounding down (never up, never to the nearest) also means the
    // real delay is always at least what's configured, never less.
    const DELAY_KEY = 'homer-sports-mlb-delay';
    const DELAY_DEFAULT = 25;
    // seconds; 0 means off. Keep in step with settings/settings.js, which
    // draws its labels from this same list.
    const DELAY_OPTIONS = [0, 10, 15, 20, 25, 30, 45, 60];
    const DELAY_BUCKET = 5000;
    const delaySeconds = () => {
        const v = parseInt(lsGet(DELAY_KEY), 10);
        return DELAY_OPTIONS.includes(v) ? v : DELAY_DEFAULT;
    };
    const setDelaySeconds = (v) => lsSet(DELAY_KEY, String(DELAY_OPTIONS.includes(v) ? v : DELAY_DEFAULT));
    const pad2 = (n) => String(n).padStart(2, '0');
    // StatsAPI's timecode: YYYYMMDD_HHMMSS, UTC
    const utcTimecode = (ms) => {
        const d = new Date(ms);
        return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}_${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}`;
    };
    // undefined when the delay is off (real time, no param); else the
    // timecode to ask StatsAPI for instead of "now"
    const delayedTimecode = () => {
        const sec = delaySeconds();
        if (!sec) return undefined;
        return utcTimecode(Math.floor((Date.now() - sec * 1000) / DELAY_BUCKET) * DELAY_BUCKET);
    };
    const withTimecode = (url, tc) => (tc ? `${url}&timecode=${tc}` : url);

    // ---------- MLB: the league's own StatsAPI ----------
    //
    // ESPN gives baseball a score and an inning. MLB's StatsAPI (no key, no
    // account, CORS *) gives the count, the outs, who's on base, who's at the
    // plate, who's pitching, the line score by inning, the real state of a
    // game (Warmup, Delayed: Rain, Postponed, Final/10) and the probables.
    // So MLB alone comes from here; every other league stays on ESPN.
    //
    // Three requests, on purpose:
    //   slate   v1/schedule, yesterday and today, trimmed with fields= to
    //           about 20 KB. Every game's state, score, count, outs, bases
    //           and batter. This is what's polled (15s while a game is live).
    //   tv      the same window with broadcasts(all), on a 30 minute cache
    //           — networks don't change mid-game, and it's another 12 KB.
    //   feed    v1.1/game/<pk>/feed/live, trimmed to about 3 KB: the line
    //           score by inning, the at-bat, the pitch sequence, the last
    //           play. One game at a time — the one on screen, and the
    //           Rangers — never the whole slate.

    const MLBAPI = 'https://statsapi.mlb.com/api/';
    // StatsAPI's abbreviation where it differs from ESPN's (logos, colors)
    const MLB_ABBR = { AZ: 'ARI', CWS: 'CHW' };
    const MLB_TEX = 140; // the Rangers, StatsAPI's id

    const F_SLATE = ['dates', 'date', 'games', 'gamePk', 'gameType', 'gameDate', 'officialDate', 'rescheduleDate',
        'resumeDate', 'doubleHeader', 'gameNumber', 'seriesDescription', 'description', 'status', 'abstractGameState',
        'codedGameState', 'detailedState', 'reason', 'startTimeTBD', 'teams', 'away', 'home', 'team', 'id', 'name',
        'leagueRecord', 'wins', 'losses', 'pct', 'score', 'isWinner', 'probablePitcher', 'fullName', 'linescore',
        'currentInning', 'currentInningOrdinal', 'inningState', 'isTopInning', 'scheduledInnings', 'balls', 'strikes',
        'outs', 'offense', 'first', 'second', 'third', 'batter'].join(',');
    const F_TV = 'dates,games,gamePk,broadcasts,name,type,isNational,homeAway,callSign,language';
    const F_FEED = ['gamePk', 'gameData', 'status', 'abstractGameState', 'detailedState', 'codedGameState', 'reason',
        'datetime', 'dateTime', 'probablePitchers', 'away', 'home', 'fullName', 'teams', 'id', 'name', 'abbreviation',
        'teamName', 'clubName', 'flags', 'noHitter', 'perfectGame', 'liveData', 'linescore', 'currentInning',
        'currentInningOrdinal', 'inningState', 'isTopInning', 'scheduledInnings', 'innings', 'num', 'runs', 'hits',
        'errors', 'balls', 'strikes', 'outs', 'offense', 'defense', 'first', 'second', 'third', 'batter', 'pitcher',
        'onDeck', 'plays', 'currentPlay', 'result', 'description', 'event', 'eventType', 'rbi', 'isScoringPlay',
        'about', 'inning', 'halfInning', 'isComplete', 'count', 'matchup', 'batSide', 'pitchHand', 'code',
        'playEvents', 'details', 'isPitch', 'decisions', 'winner', 'loser', 'save'].join(',');
    const F_PLAYS = 'allPlays,result,description,event,rbi,about,inning,halfInning,isComplete,isScoringPlay,atBatIndex';

    const ymdDash = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const mlbWindow = () => `startDate=${ymdDash(dayOffset(-1))}&endDate=${ymdDash(dayOffset(0))}`;

    // Every club, by StatsAPI's team id: ESPN's id (so a favorite is still
    // recognised by the id FAVS uses), ESPN's abbreviation, its color and its
    // logo slug. This is a table and not a request because ESPN's /teams
    // endpoint is the one on that API that sends no CORS header, so a browser
    // can't read it — and thirty clubs that change once a decade don't need
    // fetching anyway.
    const MLB_TEAMS = {
        108: ['3', 'LAA', 'ba0021', 'laa'], //  Angels
        109: ['29', 'ARI', 'aa182c', 'ari'], // Diamondbacks
        110: ['1', 'BAL', 'df4601', 'bal'], //  Orioles
        111: ['2', 'BOS', '0d2b56', 'bos'], //  Red Sox
        112: ['16', 'CHC', '0e3386', 'chc'], // Cubs
        113: ['17', 'CIN', 'c6011f', 'cin'], // Reds
        114: ['5', 'CLE', '002b5c', 'cle'], //  Guardians
        115: ['27', 'COL', '33006f', 'col'], // Rockies
        116: ['6', 'DET', '0a2240', 'det'], //  Tigers
        117: ['18', 'HOU', '002d62', 'hou'], // Astros
        118: ['7', 'KC', '004687', 'kc'], //    Royals
        119: ['19', 'LAD', '005a9c', 'lad'], // Dodgers
        120: ['20', 'WSH', 'ab0003', 'wsh'], // Nationals
        121: ['21', 'NYM', '002d72', 'nym'], // Mets
        133: ['11', 'ATH', '003831', 'ath'], // Athletics
        134: ['23', 'PIT', '111111', 'pit'], // Pirates
        135: ['25', 'SD', '2f241d', 'sd'], //   Padres
        136: ['12', 'SEA', '005c5c', 'sea'], // Mariners
        137: ['26', 'SF', '222222', 'sf'], //   Giants
        138: ['24', 'STL', 'be0a14', 'stl'], // Cardinals
        139: ['30', 'TB', '092c5c', 'tb'], //   Rays
        140: ['13', 'TEX', '003278', 'tex'], // Rangers
        141: ['14', 'TOR', '134a8e', 'tor'], // Blue Jays
        142: ['9', 'MIN', '031f40', 'min'], //  Twins
        143: ['22', 'PHI', 'e81828', 'phi'], // Phillies
        144: ['15', 'ATL', '0c2340', 'atl'], // Braves
        145: ['4', 'CHW', '1d1d1d', 'chw'], //  White Sox
        146: ['28', 'MIA', '00a3e0', 'mia'], // Marlins
        147: ['10', 'NYY', '132448', 'nyy'], // Yankees
        158: ['8', 'MIL', '13294b', 'mil'] //   Brewers
    };
    const MLB_LOGO = 'https://a.espncdn.com/i/teamlogos/mlb/500';

    // StatsAPI's team id -> everything we know about that club. The names
    // come from StatsAPI (one request a day), the rest from the table above.
    let mlbTeamsP = null;
    const mlbTeams = () => {
        if (mlbTeamsP) return mlbTeamsP;
        mlbTeamsP = get(`${MLBAPI}v1/teams?sportId=1&fields=teams,id,name,abbreviation,teamName,clubName,shortName,locationName,league,division`, 24 * 60 * MIN)
            .then((mlb) => {
                const map = new Map();
                ((mlb && mlb.teams) || []).forEach((t) => {
                    const abbr = String(t.abbreviation || '').toUpperCase();
                    const [espnId, espnAbbr, color, slug] = MLB_TEAMS[t.id] || ['', MLB_ABBR[abbr] || abbr, '', ''];
                    if (espnId && color) colors.set(colorKey('mlb', espnId), color);
                    map.set(t.id, {
                        mlbId: t.id,
                        id: String(espnId || t.id),
                        abbr: espnAbbr,
                        name: t.name || '',
                        short: t.teamName || t.clubName || t.shortName || espnAbbr,
                        logo: slug ? `${MLB_LOGO}-dark/${slug}.png` : '',
                        logoFb: slug ? `${MLB_LOGO}/${slug}.png` : '',
                        color,
                        league: (t.league && t.league.name) || '',
                        division: (t.division && t.division.name) || ''
                    });
                });
                return map;
            });
        mlbTeamsP.catch(() => { mlbTeamsP = null; });
        return mlbTeamsP;
    };

    // "Rangers Sports Network, presented by Progressive" -> "Rangers Sports
    // Network"; "Twins.TV Presented by Progressive" -> "Twins.TV". The
    // channel lineup is matched on the name, and the sponsor isn't part of it.
    const unsponsor = (n) => String(n || '').replace(/[,·]?\s*presented by .*$/i, '').trim();

    // The inning line: "Top 7th", "Mid 7th", "Bot 7th", "End 7th"
    const inningText = (ls) => {
        const ord = ls.currentInningOrdinal || (ls.currentInning && H() ? H().fmt.ordinal(ls.currentInning) : '');
        if (!ord) return 'Live';
        const half = String(ls.inningState || (ls.isTopInning ? 'Top' : 'Bottom'));
        const tag = /^Mid/i.test(half) ? 'Mid' : /^End/i.test(half) ? 'End' : /^Bot/i.test(half) ? 'Bot' : 'Top';
        return `${tag} ${ord}`;
    };
    // What the game is really doing, in words a scoreboard would use
    const mlbStatus = (st, ls, start) => {
        const det = String(st.detailedState || '');
        const abs = st.abstractGameState;
        const reason = st.reason && !new RegExp(st.reason.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(det.split(':')[0]) ? st.reason : '';
        const why = det.includes(':') ? det.split(':').slice(1).join(':').trim() : reason;
        const F = H() && H().fmt;
        if (/postponed/i.test(det)) return why ? `Postponed · ${why}` : 'Postponed';
        if (/cancell?ed/i.test(det)) return why ? `Cancelled · ${why}` : 'Cancelled';
        if (/suspended/i.test(det)) return why ? `Suspended · ${why}` : 'Suspended';
        if (/^delayed start/i.test(det)) return why ? `Delayed · ${why}` : 'Delayed';
        if (/^delayed/i.test(det)) return why ? `Delayed · ${why}` : 'Delayed';
        if (/completed early/i.test(det)) return why ? `Final · ${why}` : 'Final';
        if (abs === 'Final' || /^(final|game over)$/i.test(det)) {
            const extras = ls.currentInning && ls.scheduledInnings && ls.currentInning > ls.scheduledInnings;
            return extras ? `Final/${ls.currentInning}` : 'Final';
        }
        if (/warmup/i.test(det)) return 'Warmup';
        if (/challenge|review|replay/i.test(det)) return `Review · ${inningText(ls)}`;
        if (abs === 'Live') return inningText(ls);
        if (/^pre-?game/i.test(det)) return 'Pre-game';
        if (st.startTimeTBD) return F ? `${F.day(start)} · TBD` : 'TBD';
        return F ? F.when(start) : start.toLocaleTimeString();
    };

    // One StatsAPI game -> a HomerHub game (HomerHub.ui.scoreCard), with the
    // baseball on it under .mlb
    const mlbGame = (raw, T, tv) => {
        const st = raw.status || {};
        const ls = raw.linescore || {};
        const det = String(st.detailedState || '');
        const off = ls.offense || {};
        const dead = /postponed|cancell?ed|suspended/i.test(det);
        const state = dead ? 'post' : st.abstractGameState === 'Live' ? 'in' : st.abstractGameState === 'Final' ? 'post' : 'pre';
        const start = new Date(raw.gameDate);
        const side = (ha) => {
            const s = raw.teams[ha] || {};
            const t = T.get(s.team && s.team.id) || {};
            const rec = s.leagueRecord || {};
            return {
                id: t.id || String((s.team && s.team.id) || ''),
                mlbId: (s.team && s.team.id) || 0,
                abbr: t.abbr || '',
                name: t.name || (s.team && s.team.name) || '',
                short: t.short || t.abbr || '',
                logo: t.logo || '',
                logoFb: t.logoFb || '',
                score: s.score != null ? String(s.score) : '',
                rank: null,
                record: rec.wins != null ? `${rec.wins}-${rec.losses}` : '',
                winner: !!s.isWinner,
                color: t.color || '',
                fav: isFav('mlb', t.id),
                probable: (s.probablePitcher || {}).fullName || ''
            };
        };
        const away = side('away');
        const home = side('home');
        const status = mlbStatus(st, ls, start);
        // The networks for it: national TV first, then the two clubs' own
        // (the Rangers' own network is a channel in the lineup).
        const nets = { national: [], local: [], all: [] };
        (tv || []).filter((b) => b.type === 'TV').forEach((b) => {
            const n = unsponsor(b.name);
            if (!n) return;
            const list = b.isNational ? nets.national : nets.local;
            if (!list.includes(n)) list.push(n);
        });
        nets.national.concat(nets.local).forEach((n) => { if (!nets.all.includes(n)) nets.all.push(n); });
        // StatsAPI writes a simulcast as one name ("FOX / FOX ONE"); the
        // lineup is matched on each side of it as well as on the whole thing
        const lookup = nets.all.concat(nets.all.filter((n) => n.includes('/')).flatMap((n) => n.split('/').map((x) => x.trim())));
        const match = chanLookup(lookup);
        const favGame = away.fav || home.fav;
        const network = match ? match.name : (nets.national[0] || (favGame ? nets.local[0] || '' : '') || '');
        const F = H() && H().fmt;
        const short = state === 'pre' && !dead && F && !st.startTimeTBD
            ? (F.day(start) === 'Today' ? F.time(start) : `${start.toLocaleDateString([], { weekday: 'short' })} ${F.time(start)}`)
            : status;
        const note = raw.description || (raw.seriesDescription && raw.seriesDescription !== 'Regular Season' ? raw.seriesDescription : '');
        return {
            id: String(raw.gamePk),
            league: 'mlb',
            state,
            status,
            start,
            away,
            home,
            network,
            networks: nets.all,
            homeFirst: false,
            short,
            channel: null,
            _chanCandidates: match ? match.chans : [],
            note,
            name: `${away.abbr} @ ${home.abbr}`,
            priority: favGame,
            round: null,
            competition: raw.seriesDescription === 'Regular Season' ? '' : (raw.seriesDescription || ''),
            mlb: {
                pk: raw.gamePk,
                detailed: det,
                coded: st.codedGameState || '',
                reason: st.reason || '',
                dead,
                inning: ls.currentInning || 0,
                ord: ls.currentInningOrdinal || '',
                half: ls.inningState || '',
                isTop: !!ls.isTopInning,
                scheduled: ls.scheduledInnings || 9,
                balls: ls.balls ?? null,
                strikes: ls.strikes ?? null,
                outs: ls.outs ?? null,
                bases: [!!off.first, !!off.second, !!off.third],
                onBase: {
                    first: (off.first || {}).fullName || '',
                    second: (off.second || {}).fullName || '',
                    third: (off.third || {}).fullName || ''
                },
                batter: (off.batter || {}).fullName || '',
                probables: { away: away.probable, home: home.probable },
                doubleHeader: raw.doubleHeader && raw.doubleHeader !== 'N' ? (raw.gameNumber || 1) : 0,
                description: raw.description || ''
            }
        };
    };

    // Yesterday and today, as HomerHub games. `ttl` paces the slate; the TV
    // listings ride along on their own half-hour cache.
    const mlbSlate = async (ttl) => {
        await H().channels.lineup().catch(() => null); // so a game can name our channel
        const win = mlbWindow();
        // the schedule/linescore call is the one that's delayed — it's what
        // scores(), and so the scores grid, My Teams and the ticker, draw
        // from. The broadcasts call rides on its own half-hour cache: a
        // network assignment isn't live game state, and delaying it would
        // only turn that cache into a fresh fetch every few seconds for
        // nothing.
        const [sched, tv, T] = await Promise.all([
            get(withTimecode(`${MLBAPI}v1/schedule?sportId=1&${win}&hydrate=linescore,probablePitcher&fields=${F_SLATE}`, delayedTimecode()), ttl),
            get(`${MLBAPI}v1/schedule?sportId=1&${win}&hydrate=broadcasts(all)&fields=${F_TV}`, 30 * MIN).catch(() => null),
            mlbTeams()
        ]);
        const nets = new Map();
        ((tv && tv.dates) || []).forEach((d) => (d.games || []).forEach((g) => nets.set(g.gamePk, g.broadcasts || [])));
        const games = [];
        ((sched && sched.dates) || []).forEach((d) => (d.games || []).forEach((g) => games.push(mlbGame(g, T, nets.get(g.gamePk)))));
        return games;
    };

    // ----- One game, live -----

    // What the plays feed says happened, newest first. allPlays is 17 KB, so
    // it's fetched once (a ten minute cache) to seed the list when a game
    // first comes on screen; after that the live feed's currentPlay keeps it
    // up to date for a tenth of the bytes.
    const plays = new Map(); // gamePk -> [{ key, desc, event, inning, half, scoring }]
    const seeded = new Set();
    const playKey = (p) => `${(p.about || {}).inning}:${(p.about || {}).halfInning}:${(p.result || {}).description || ''}`;
    const remember = (pk, p) => {
        const r = p.result || {};
        const a = p.about || {};
        if (!a.isComplete || !r.description) return;
        const list = plays.get(pk) || [];
        const key = playKey(p);
        if (list[0] && list[0].key === key) return;
        list.unshift({ key, desc: r.description, event: r.event || '', inning: a.inning, half: a.halfInning, scoring: !!a.isScoringPlay });
        plays.set(pk, list.slice(0, 5));
    };
    const seedPlays = async (pk, tc) => {
        if (seeded.has(pk)) return;
        seeded.add(pk);
        const r = await get(withTimecode(`${MLBAPI}v1/game/${pk}/playByPlay?fields=${F_PLAYS}`, tc), 10 * MIN).catch(() => null);
        if (!r) { seeded.delete(pk); return; } // it can try again next time round
        const all = r.allPlays || [];
        const had = plays.get(pk) || [];
        const seen = new Set(had.map((x) => x.key));
        const add = [];
        for (let i = all.length - 1; i >= 0 && add.length < 5; i--) {
            const p = all[i];
            const a = p.about || {};
            const res = p.result || {};
            if (!a.isComplete || !res.description) continue;
            const key = playKey(p);
            if (seen.has(key)) continue;
            seen.add(key);
            add.push({ key, desc: res.description, event: res.event || '', inning: a.inning, half: a.halfInning, scoring: !!a.isScoringPlay });
        }
        plays.set(pk, had.concat(add).slice(0, 5));
    };

    const PITCH_BALL = /^(ball|ball in dirt|intent ball|pitchout|automatic ball|hit by pitch)/i;
    const PITCH_STRIKE = /^(called strike|swinging strike|foul|foul tip|foul bunt|missed bunt|strike|automatic strike)/i;

    // The live feed for one game (about 3 KB), as everything the live view
    // draws. `pk` is the gamePk on a game from mlbSlate (g.mlb.pk).
    const mlbLive = async (pk, { ttl = 12000, seed = true } = {}) => {
        const tc = delayedTimecode();
        const [r, T] = await Promise.all([
            get(withTimecode(`${MLBAPI}v1.1/game/${pk}/feed/live?fields=${F_FEED}`, tc), ttl),
            mlbTeams()
        ]);
        if (!r || !r.liveData) return null;
        const gd = r.gameData || {};
        const ld = r.liveData || {};
        const ls = ld.linescore || {};
        const st = gd.status || {};
        const cp = (ld.plays || {}).currentPlay || {};
        remember(pk, cp);
        if (seed && st.abstractGameState !== 'Preview') await seedPlays(pk, tc).catch(() => null);
        const off = ls.offense || {};
        const def = ls.defense || {};
        const cnt = cp.count || {};
        const team = (ha) => {
            const t = (gd.teams || {})[ha] || {};
            const m = T.get(t.id);
            return m || { id: String(t.id || ''), abbr: t.abbreviation || '', short: t.teamName || t.name || '', name: t.name || '', logo: '', logoFb: '', color: '' };
        };
        const tot = ls.teams || {};
        const pitches = (cp.playEvents || []).filter((e) => e.isPitch).map((e) => {
            const d = (e.details || {}).description || '';
            return { desc: d, code: (e.details || {}).code || '', kind: PITCH_BALL.test(d) ? 'ball' : PITCH_STRIKE.test(d) ? 'strike' : 'in-play' };
        });
        const det = String(st.detailedState || '');
        return {
            pk,
            away: team('away'),
            home: team('home'),
            state: /postponed|cancell?ed|suspended/i.test(det) ? 'post' : st.abstractGameState === 'Live' ? 'in' : st.abstractGameState === 'Final' ? 'post' : 'pre',
            status: mlbStatus(st, ls, new Date((gd.datetime || {}).dateTime || Date.now())),
            detailed: det,
            live: st.abstractGameState === 'Live' && !/postponed|cancell?ed|suspended/i.test(det),
            inning: ls.currentInning || 0,
            ord: ls.currentInningOrdinal || '',
            half: ls.inningState || '',
            isTop: !!ls.isTopInning,
            scheduled: ls.scheduledInnings || 9,
            innings: (ls.innings || []).map((i) => ({
                num: i.num,
                away: { r: (i.away || {}).runs, h: (i.away || {}).hits, e: (i.away || {}).errors },
                home: { r: (i.home || {}).runs, h: (i.home || {}).hits, e: (i.home || {}).errors }
            })),
            totals: {
                away: { r: (tot.away || {}).runs ?? 0, h: (tot.away || {}).hits ?? 0, e: (tot.away || {}).errors ?? 0 },
                home: { r: (tot.home || {}).runs ?? 0, h: (tot.home || {}).hits ?? 0, e: (tot.home || {}).errors ?? 0 }
            },
            balls: ls.balls ?? cnt.balls ?? 0,
            strikes: ls.strikes ?? cnt.strikes ?? 0,
            outs: ls.outs ?? cnt.outs ?? 0,
            bases: [!!off.first, !!off.second, !!off.third],
            onBase: { first: (off.first || {}).fullName || '', second: (off.second || {}).fullName || '', third: (off.third || {}).fullName || '' },
            batter: { name: ((cp.matchup || {}).batter || off.batter || {}).fullName || '', hand: (((cp.matchup || {}).batSide) || {}).code || '' },
            pitcher: { name: ((cp.matchup || {}).pitcher || def.pitcher || {}).fullName || '', hand: (((cp.matchup || {}).pitchHand) || {}).code || '' },
            onDeck: (off.onDeck || {}).fullName || '',
            battingTeam: (off.team || {}).id === (gd.teams || {}).home?.id ? 'home' : 'away',
            pitches,
            plays: (plays.get(pk) || []).slice(0, 4),
            probables: {
                away: ((gd.probablePitchers || {}).away || {}).fullName || '',
                home: ((gd.probablePitchers || {}).home || {}).fullName || ''
            },
            decisions: {
                winner: ((ld.decisions || {}).winner || {}).fullName || '',
                loser: ((ld.decisions || {}).loser || {}).fullName || '',
                save: ((ld.decisions || {}).save || {}).fullName || ''
            },
            noHitter: !!((gd.flags || {}).noHitter),
            perfectGame: !!((gd.flags || {}).perfectGame)
        };
    };

    // How often a live game's feed is worth asking for. StatsAPI is a
    // courtesy: 12 seconds while the ball's in play, slower when it isn't,
    // and once a minute once it's over (a final can still gain a decision).
    const mlbLivePace = (g) => {
        const m = (g && g.mlb) || {};
        if (!g) return 60000;
        if (g.state === 'post' || m.dead) return 5 * MIN;
        if (g.state === 'pre') return /warmup|pre-?game/i.test(m.detailed || '') ? 60000 : 5 * MIN;
        if (/delayed|suspended/i.test(m.detailed || '')) return 60000;
        return 12000;
    };

    // Where a club stands, StatsAPI's way: the rank in its division, the
    // record, the streak and — the thing ESPN's one-line summary never says
    // — the magic number, or that they've clinched.
    const mlbStanding = async (mlbId) => {
        const [r, T] = await Promise.all([
            get(`${MLBAPI}v1/standings?leagueId=103,104&standingsTypes=byDivision&fields=records,division,id,teamRecords,team,wins,losses,winningPercentage,divisionRank,gamesBack,streak,streakCode,clinched,divisionChamp,magicNumber,eliminationNumber,wildCardEliminationNumber`, 30 * MIN).catch(() => null),
            mlbTeams()
        ]);
        let row = null;
        // (the standings' own division object comes back as a bare id under
        // fields=, so the name comes from the club)
        const div = ((T.get(mlbId) || {}).division || '').replace('American League', 'AL').replace('National League', 'NL');
        ((r && r.records) || []).forEach((rec) => (rec.teamRecords || []).forEach((t) => {
            if ((t.team || {}).id === mlbId) row = t;
        }));
        if (!row) return null;
        const F = H() && H().fmt;
        const rank = +row.divisionRank || 0;
        return {
            record: `${row.wins}-${row.losses}`,
            rank,
            division: div,
            where: rank && div ? `${F ? F.ordinal(rank) : rank} in ${div}` : div,
            gamesBack: row.gamesBack === '-' ? '' : row.gamesBack,
            streak: (row.streak || {}).streakCode || '',
            clinched: !!row.clinched,
            magic: row.magicNumber && row.magicNumber !== '-' ? row.magicNumber : '',
            eliminated: row.eliminationNumber === 'E'
        };
    };

    // The Rangers' games out of StatsAPI: their whole homestand's worth, so
    // the card can show the last result and the next game with its probables.
    const mlbTeamGames = async (fav, board) => {
        const T = await mlbTeams();
        const win = `startDate=${ymdDash(dayOffset(-7))}&endDate=${ymdDash(dayOffset(10))}`;
        const [sched, tv] = await Promise.all([
            get(`${MLBAPI}v1/schedule?sportId=1&teamId=${MLB_TEX}&${win}&hydrate=linescore,probablePitcher&fields=${F_SLATE}`, 30 * MIN),
            get(`${MLBAPI}v1/schedule?sportId=1&teamId=${MLB_TEX}&${win}&hydrate=broadcasts(all)&fields=${F_TV}`, 60 * MIN).catch(() => null)
        ]);
        const nets = new Map();
        ((tv && tv.dates) || []).forEach((d) => (d.games || []).forEach((g) => nets.set(g.gamePk, g.broadcasts || [])));
        // the slate is fresher than this schedule, so today's games come from it
        const fresh = new Map((board || []).map((g) => [g.id, g]));
        const all = [];
        ((sched && sched.dates) || []).forEach((d) => (d.games || []).forEach((g) => {
            all.push(fresh.get(String(g.gamePk)) || mlbGame(g, T, nets.get(g.gamePk)));
        }));
        const me = [...T.values()].find((t) => t.mlbId === MLB_TEX) || {};
        const now = Date.now();
        const done = all.filter((g) => g.state === 'post' && !g.mlb.dead).sort((a, b) => b.start - a.start);
        const live = all.find((g) => g.state === 'in') || null;
        const next = all.filter((g) => g.state === 'pre' && g.start.getTime() > now - 6 * 3600000).sort((a, b) => a.start - b.start)[0] || null;
        return { all, live, last: done[0] || null, next, team: me };
    };

    // ---------- Scores ----------

    // How fresh a league's scores need to be: 15 seconds while one of its
    // games is live, a minute when one starts within the half hour, else 5
    // minutes (ESPN's own cache is 8 seconds; a TV left on this screen all
    // day shouldn't pull megabytes a minute for nothing).
    const pace = new Map(); // league -> { live, soon }
    const lastScores = new Map(); // league -> its last games
    const peekScores = (league) => lastScores.get(league) || null;
    const ttlFor = (league) => {
        const p = pace.get(league);
        if (!p) return 30000;
        return p.live ? 15000 : p.soon ? 60000 : 5 * MIN;
    };
    // The games worth showing now, per league:
    //   MLB             yesterday and today, out of MLB's own StatsAPI
    //   NBA, NHL        yesterday and today
    //   NFL             ESPN's current week
    //   college FB      ESPN's current week: the Top 25, the SEC and the Big 12
    //   soccer          the last 4 days and the next 10
    const scores = async (league) => {
        const L = LEAGUES[league];
        if (!L) return [];
        const ttl = ttlFor(league);
        // MLB is the one league that isn't ESPN's: see mlbSlate above
        if (league === 'mlb') {
            const games = await mlbSlate(ttl);
            games.sort(byInterest);
            lastScores.set('mlb', games);
            const t = Date.now();
            pace.set('mlb', {
                live: games.some((g) => g.state === 'in'),
                soon: games.some((g) => g.state === 'pre' && g.start - t < 30 * MIN && g.start - t > -3 * 3600000)
            });
            return games;
        }
        await H().channels.lineup().catch(() => null); // so games can name our channels
        let events = [];
        if (league === 'nba' || league === 'nhl') {
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
            // Soccer is the one ESPN scoreboard that refuses a day range: a
            // `dates=YYYYMMDD-YYYYMMDD` query answers 400, which had quietly
            // emptied the Soccer tab. A whole month is fine, so ask for the
            // months our window touches and keep the games inside it.
            const from = dayOffset(-4);
            const to = dayOffset(10);
            const months = [];
            for (const d = new Date(from.getFullYear(), from.getMonth(), 1); d <= to; d.setMonth(d.getMonth() + 1)) {
                months.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`);
            }
            const rs = await Promise.all(months.map(
                (m) => get(`${SITE}${L.path}/scoreboard?dates=${m}`, ttl).catch(() => null)
            ));
            const lo = from.getTime();
            const hi = to.getTime();
            const seen = new Set();
            rs.forEach((r) => ((r && r.events) || []).forEach((e) => {
                const t = new Date(e.date).getTime();
                if (seen.has(e.id) || !(t >= lo && t <= hi)) return;
                seen.add(e.id);
                events.push(e);
            }));
            // a competition between matchdays (the Champions League is dark
            // for weeks at a time): show whatever ESPN has next rather than
            // an empty tab
            if (!events.length) {
                const n = await get(`${SITE}${L.path}/scoreboard`, 10 * MIN);
                events = (n && n.events) || [];
            }
        }
        const games = events.map((e) => {
            const g = game(e, league);
            if (e._conf) g.conf = e._conf;
            return g;
        });
        games.sort(byInterest);
        lastScores.set(league, games);
        const now = Date.now();
        pace.set(league, {
            live: games.some((g) => g.state === 'in'),
            soon: games.some((g) => g.state === 'pre' && g.start - now < 30 * MIN && g.start - now > -3 * 3600000)
        });
        return games;
    };
    const anyLive = (games) => games.some((g) => g.state === 'in');
    const noteLive = () => {}; // (kept for callers; the pace is per league now)

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
        // the Rangers come out of StatsAPI, like the rest of MLB
        if (fav.league === 'mlb') {
            const board = await scores('mlb').catch(() => []);
            const [tg, st] = await Promise.all([mlbTeamGames(fav, board), mlbStanding(MLB_TEX).catch(() => null)]);
            const where = st ? [st.where, st.clinched ? 'clinched' : st.magic ? `magic ${st.magic}` : st.eliminated ? 'eliminated' : ''].filter(Boolean).join(' · ') : '';
            return {
                fav,
                live: tg.live,
                last: tg.last,
                next: tg.next,
                standing: st,
                team: {
                    record: st ? st.record : '',
                    standing: where,
                    logo: tg.team.logo || '',
                    logoFb: tg.team.logoFb || '',
                    color: tg.team.color ? '#' + tg.team.color : fav.color,
                    alt: ''
                }
            };
        }
        const soccer = fav.league === 'epl';
        const urls = soccer
            ? [`${SITE}soccer/all/teams/${fav.id}/schedule?fixture=true`, `${SITE}${L.path}/teams/${fav.id}/schedule`, `${SITE}soccer/uefa.champions/teams/${fav.id}/schedule`]
            : [`${SITE}${L.path}/teams/${fav.id}/schedule`];
        // The schedule changes rarely (an hour's fine); the scores come from
        // the league's scoreboard, which is kept fresh (15 seconds while live).
        const [rs, , board] = await Promise.all([
            Promise.all(urls.map((u, k) => get(u, 60 * MIN).catch((err) => { if (k === 0) throw err; return null; }))),
            teamColors(fav.league),
            scores(fav.league).catch(() => []), // (and this week's opponents' colors)
            soccer ? scores('ucl').catch(() => []) : null
        ]);
        const fresh = new Map(board.map((g) => [g.id, g]));
        if (soccer) ((peekScores('ucl')) || []).forEach((g) => fresh.set(g.id, g));
        const team = (rs[0] && rs[0].team) || {};
        const all = [];
        const seen = new Set();
        rs.forEach((r, k) => ((r && r.events) || []).forEach((e) => {
            if (seen.has(e.id)) return;
            seen.add(e.id);
            const lg = soccer ? (k === 2 ? 'ucl' : 'epl') : fav.league;
            const comp = (e.league && (e.league.shortName || e.league.abbreviation)) || (k === 2 ? 'Champions League' : k === 1 ? 'Premier League' : '');
            const g = fresh.get(String(e.id)) || game(e, lg);
            g.competition = comp || g.competition;
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
        resolveChannels,
        game,
        isFav,
        favFor,
        anyLive,
        noteLive,
        darkLogo,
        // MLB's own (statsapi.mlb.com)
        mlbLive,
        mlbLivePace,
        mlbStanding,
        mlbTeams,
        MLB_TEX,
        // Live delay (settings/settings.js draws the "Live scores delay" choice from these)
        delaySeconds,
        setDelaySeconds,
        DELAY_OPTIONS,
        DELAY_DEFAULT
    };
})();
