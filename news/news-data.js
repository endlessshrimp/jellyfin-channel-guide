/*
 * HOMER News data: the News Hub's stories, from real publishers' RSS/Atom.
 *
 * Most papers' feeds can't be read by a browser (no CORS), so every feed goes
 * through HOMER's feed helper on the NAS (homerfeeds.py): GET <base>/feed?url=…
 * answers JSON { title, link, items: [{ title, link, published, summary,
 * image, source }] }, cached 5 minutes there. Only allow-listed hosts are
 * fetched (the list is in homerfeeds.py, plus allow.txt beside it).
 *
 *   Sections  Top, US, World, UK, France, Business, Local (DFW), Tech: each a
 *             handful of feeds. A section's stories are its feeds' items,
 *             with the same story from several papers merged into one (the
 *             one with a picture kept, the others listed as "also"), junk
 *             (quizzes, crosswords, opinion) left out, ranked by how new it
 *             is, how many papers have it, and whether it has a picture.
 *   Refresh   every 5 minutes while a hub has it started; a feed that fails
 *             is tried again later (1, 2, 4… up to 30 minutes) and its last
 *             good items stay, so a feed that's down just drops out.
 *   Cache     the last items of every feed are kept in localStorage, so the
 *             hub opens with the news straight away and refreshes behind it.
 *
 * A few feeds are headlines only, through Google News' search RSS (AP,
 * Reuters, the Dallas Morning News, the Star-Telegram, NHK World), because
 * those publishers have no working feed of their own.
 *
 * window.HomerNewsData = { SECTIONS, FEEDS, create, feedBase, fmtAge,
 *                          bigImage, version }
 *   create({ onUpdate(sectionKey) }) -> { start, stop, refresh, stories,
 *     lead, headlines, status, updatedAt, want }
 */
(() => {
    const VERSION = '0.1.0';

    const REFRESH_MS = 5 * 60000; // the helper caches 5 minutes too
    const TIMEOUT_MS = 20000; // the helper gives up on a publisher after 15s
    const PARALLEL = 4; // feed requests at a time
    const RETRY_MIN = 60000;
    const RETRY_MAX = 30 * 60000;
    const STORE = 'homer-news-v1';
    const STORE_ITEMS = 8; // per feed, in the cache (about 250 KB in all)
    const MIN_MS = 60000;
    const HOUR = 60 * MIN_MS;

    // ---------- Where the feed helper is ----------

    const feedBase = () => {
        const cfg = window.HomerConfig && window.HomerConfig.feeds;
        if (typeof cfg === 'string' && cfg) return cfg.replace(/\/$/, '');
        return location.protocol === 'https:'
            ? location.origin + '/homer-feeds'
            : 'http://' + location.hostname + ':8095';
    };

    // ---------- Sections and their feeds ----------
    // name: what a card says ("NYT · 12m"). weight: a nudge in the ranking
    // (the home pages' picks are the day's big stories). gn: a Google News
    // search feed (headlines only; the publisher is in the title).

    const GN = (q) => 'https://news.google.com/rss/search?q=' + encodeURIComponent(q).replace(/%20/g, '+') + '&hl=en-US&gl=US&ceid=US:en';
    const NYT = (s) => `https://rss.nytimes.com/services/xml/rss/nyt/${s}.xml`;
    const BBC = (s) => `https://feeds.bbci.co.uk/news/${s ? s + '/' : ''}rss.xml`;
    const NPR = (id) => `https://feeds.npr.org/${id}/rss.xml`;

    const FEEDS = [
        // Top stories (US national front pages)
        { id: 'nyt-home', section: 'top', name: 'NYT', url: NYT('HomePage'), weight: 1 },
        { id: 'npr-news', section: 'top', name: 'NPR', url: NPR(1001), weight: 0.5 },
        { id: 'nbc-news', section: 'top', name: 'NBC News', url: 'https://feeds.nbcnews.com/nbcnews/public/news', weight: 0.5 },
        { id: 'abc-top', section: 'top', name: 'ABC News', url: 'https://abcnews.go.com/abcnews/topstories', weight: 0.5 },
        { id: 'cbs-main', section: 'top', name: 'CBS News', url: 'https://www.cbsnews.com/latest/rss/main' },
        { id: 'wapo-politics', section: 'top', name: 'WaPo', url: 'https://feeds.washingtonpost.com/rss/politics' },
        // US
        { id: 'nyt-us', section: 'us', name: 'NYT', url: NYT('US'), weight: 0.5 },
        { id: 'wapo-national', section: 'us', name: 'WaPo', url: 'https://feeds.washingtonpost.com/rss/national' },
        { id: 'npr-national', section: 'us', name: 'NPR', url: NPR(1003) },
        { id: 'abc-us', section: 'us', name: 'ABC News', url: 'https://abcnews.go.com/abcnews/usheadlines' },
        { id: 'cbs-us', section: 'us', name: 'CBS News', url: 'https://www.cbsnews.com/latest/rss/us' },
        { id: 'ap', section: 'us', name: 'AP', url: GN('site:apnews.com when:1d'), gn: true, weight: -0.5 },
        // World
        { id: 'bbc-world', section: 'world', name: 'BBC', url: BBC('world'), weight: 0.5 },
        { id: 'nyt-world', section: 'world', name: 'NYT', url: NYT('World'), weight: 0.5 },
        { id: 'aljazeera', section: 'world', name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
        { id: 'reuters', section: 'world', name: 'Reuters', url: GN('site:reuters.com/world when:1d'), gn: true, weight: -0.5 },
        { id: 'dw', section: 'world', name: 'DW', url: 'https://rss.dw.com/xml/rss-en-all' },
        { id: 'f24-en', section: 'world', name: 'France 24', url: 'https://www.france24.com/en/rss' },
        { id: 'guardian-world', section: 'world', name: 'Guardian', url: 'https://www.theguardian.com/world/rss' },
        { id: 'nhk', section: 'world', name: 'NHK', url: GN('site:www3.nhk.or.jp/nhkworld when:2d'), gn: true, weight: -0.5 },
        { id: 'cbc-world', section: 'world', name: 'CBC', url: 'https://www.cbc.ca/webfeed/rss/rss-world' },
        { id: 'abc-au', section: 'world', name: 'ABC Australia', url: 'https://www.abc.net.au/news/feed/51120/rss.xml', weight: -0.5 },
        { id: 'cna', section: 'world', name: 'CNA', url: 'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml', weight: -0.5 },
        { id: 'euronews', section: 'world', name: 'Euronews', url: 'https://www.euronews.com/rss?format=mrss&level=theme&name=news', weight: -0.5 },
        // UK
        { id: 'bbc-uk', section: 'uk', name: 'BBC', url: BBC('uk'), weight: 0.5 },
        { id: 'bbc-top', section: 'uk', name: 'BBC', url: BBC(''), weight: 0.5 },
        { id: 'guardian-uk', section: 'uk', name: 'Guardian', url: 'https://www.theguardian.com/uk-news/rss' },
        { id: 'sky-home', section: 'uk', name: 'Sky News', url: 'https://feeds.skynews.com/feeds/rss/home.xml' },
        { id: 'sky-uk', section: 'uk', name: 'Sky News', url: 'https://feeds.skynews.com/feeds/rss/uk.xml' },
        // France
        { id: 'lemonde', section: 'france', name: 'Le Monde', url: 'https://www.lemonde.fr/rss/une.xml', weight: 0.5 },
        { id: 'franceinfo', section: 'france', name: 'franceinfo', url: 'https://www.francetvinfo.fr/titres.rss' },
        { id: 'f24-fr', section: 'france', name: 'France 24', url: 'https://www.france24.com/fr/france/rss' },
        { id: 'lemonde-intl', section: 'france', name: 'Le Monde', url: 'https://www.lemonde.fr/international/rss_full.xml', weight: -0.5 },
        // Business
        { id: 'nyt-biz', section: 'business', name: 'NYT', url: NYT('Business'), weight: 0.5 },
        { id: 'cnbc', section: 'business', name: 'CNBC', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114' },
        { id: 'ft', section: 'business', name: 'FT', url: 'https://www.ft.com/rss/home', weight: 0.5 },
        { id: 'bbc-biz', section: 'business', name: 'BBC', url: BBC('business'), weight: -1 }, // UK-centric
        { id: 'npr-biz', section: 'business', name: 'NPR', url: NPR(1006) },
        { id: 'cbs-money', section: 'business', name: 'CBS News', url: 'https://www.cbsnews.com/latest/rss/moneywatch' },
        { id: 'wapo-biz', section: 'business', name: 'WaPo', url: 'https://feeds.washingtonpost.com/rss/business' },
        // Local: Dallas–Fort Worth
        { id: 'nbcdfw', section: 'local', name: 'NBC DFW', url: 'https://www.nbcdfw.com/?rss=y', weight: 0.5 },
        { id: 'fox4', section: 'local', name: 'FOX 4', url: 'https://www.fox4news.com/rss/category/local-news', weight: 0.5 },
        { id: 'wfaa', section: 'local', name: 'WFAA', url: 'https://www.wfaa.com/feeds/syndication/rss/news/local', weight: 0.5 },
        { id: 'cbs-texas', section: 'local', name: 'CBS Texas', url: 'https://www.cbsnews.com/texas/latest/rss/main', weight: 0.5 },
        { id: 'kera', section: 'local', name: 'KERA', url: 'https://www.keranews.org/news.rss' },
        { id: 'dmn', section: 'local', name: 'DMN', url: GN('site:dallasnews.com when:1d'), gn: true },
        { id: 'star-telegram', section: 'local', name: 'Star-Telegram', url: GN('site:star-telegram.com when:1d'), gn: true, weight: -0.5 },
        // Tech & science
        { id: 'verge', section: 'tech', name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', weight: 0.5 },
        { id: 'ars', section: 'tech', name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index', weight: 0.5 },
        { id: 'nyt-tech', section: 'tech', name: 'NYT', url: NYT('Technology') },
        { id: 'bbc-tech', section: 'tech', name: 'BBC', url: BBC('technology') },
        { id: 'nyt-science', section: 'tech', name: 'NYT', url: NYT('Science') },
        { id: 'nasa', section: 'tech', name: 'NASA', url: 'https://www.nasa.gov/feed/', weight: -0.5 },
    ];

    // label: the tab. ticker: the ticker's chip. keep: how old a story can be.
    const SECTIONS = [
        { key: 'top', label: 'Top', ticker: 'Top Stories', keep: 36 * HOUR },
        { key: 'us', label: 'US', ticker: 'U.S.', keep: 36 * HOUR },
        { key: 'world', label: 'World', ticker: 'World', keep: 36 * HOUR },
        { key: 'uk', label: 'UK', ticker: 'U.K.', keep: 36 * HOUR },
        { key: 'france', label: 'France', ticker: 'France', keep: 48 * HOUR },
        { key: 'business', label: 'Business', ticker: 'Business', keep: 48 * HOUR },
        { key: 'local', label: 'Local', ticker: 'DFW', keep: 72 * HOUR },
        { key: 'tech', label: 'Tech', ticker: 'Tech', keep: 72 * HOUR },
    ];
    SECTIONS.forEach((s) => { s.feeds = FEEDS.filter((f) => f.section === s.key); });
    const sectionOf = (key) => SECTIONS.find((s) => s.key === key) || null;

    // Google News puts the publisher at the end of the title
    const GN_NAMES = [
        [/^AP( News)?$|Associated Press/i, 'AP'],
        [/^Reuters/i, 'Reuters'],
        [/Dallas (Morning )?News/i, 'DMN'],
        [/Star-Telegram/i, 'Star-Telegram'],
        [/NHK/i, 'NHK'],
    ];

    // ---------- Cleaning up an item ----------

    const unescape = (s) => String(s || '')
        .replace(/&#0?38;|&amp;/g, '&')
        .replace(/&#0?39;|&apos;/g, '\'')
        .replace(/&quot;/g, '"')
        .replace(/&nbsp;| /g, ' ')
        .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n));

    // Not news, or not news for a TV: puzzles, quizzes, opinion, shopping,
    // podcasts, "watch live" promos.
    const JUNK_TITLE = /^(quiz|the (mini )?crossword|wordle|connections|spelling bee|sudoku|strands|horoscope|letters?\b|opinion\b|watch live|listen\b|podcast\b|newsletter\b|the morning:|your .* briefing)|\b(deals?|coupon|promo code)s?\b.*\b(sale|off|today)\b|\bhints?\b.*\b(wordle|connections|strands)\b|\btv(\/radio)? listings\b|\blottery (numbers|results)\b|join our readers|we want to (hear|answer|know)|tell us (about|what|how)|share your (story|thoughts|photos)|send us your/i;
    // (sport too: the Sports Hub has it; BBC's front page mixes it in)
    const JUNK_LINK = /\/(opinion|opinions|crosswords|games|puzzles|podcasts|live-video|shopping|deals|coupons|commentisfree|sport|sports)\//i;

    const cleanSummary = (s, title) => {
        let t = unescape(s).replace(/\s+/g, ' ').trim();
        t = t.replace(/\s*(Continue reading\.*|Read more\.*|\[…\]|\[\.\.\.\]|The post .* appeared first on .*)$/i, '').trim();
        // Google News repeats the headline and the publisher
        if (title && t.toLowerCase().startsWith(title.toLowerCase().slice(0, 40))) return '';
        if (t.length < 20) return '';
        return t;
    };

    // Bigger pictures where the publisher's URL says the size (the feeds carry
    // thumbnails). Returns [big, original]; the card falls back to the
    // original if the big one doesn't load.
    const bigImage = (url) => {
        if (!url) return ['', ''];
        const u = unescape(url);
        let b = u
            .replace(/(ichef\.bbci\.co\.uk\/(?:ace|news)\/(?:standard|ws)\/)\d+\//, '$1976/')
            .replace(/-(mediumSquareAt3X|articleLarge|thumbStandard|superJumbo)\.jpg/, '-videoSixteenByNineJumbo1600.jpg')
            .replace(/(s\.abcnews\.com\/images\/.*_)\d{2,4}(\.jpe?g)$/, '$1992$2')
            .replace(/^(https:\/\/img\.lemde\.fr\/\d{4}\/\d\d\/\d\d\/\d+\/\d+\/\d+\/\d+\/)(\d+)\/(\d+)\//, (m, a, w, h) => (+w < 1000 ? `${a}${w * 2}/${h * 2}/` : m))
            .replace(/(media\.tegna-media\.com\/.*_)\d+x\d+(\.jpe?g)$/, '$11140x641$2')
            .replace(/(images\.euronews\.com\/.*\/)\d+x\d+(_cmsv2)/, '$11200x675$2')
            .replace(/(npr\.brightspotcdn\.com\/dims3\/.*\/resize\/)[^/]+\//, '$11200/');
        return [b, u];
    };
    // a thumbnail too small for a card isn't a picture (the Guardian's feed
    // leads with 140px ones)
    // (and a publisher's stand-in logo isn't one: ABC's "abc_news_default")
    const PLACEHOLDER_IMG = /abc_news_default|[_-]default[_-]?(image|thumb|share)|placeholder|\/fallback[._-]/i;
    const tooSmall = (url) => {
        if (PLACEHOLDER_IMG.test(url)) return true;
        const w = /[?&]width=(\d+)/.exec(url);
        return !!(w && +w[1] < 300 && /i\.guim\.co\.uk/.test(url));
    };

    const stockImage = (url, t) => {
        const m = /\/(20\d\d)\/(\d\d)\/(\d\d)?/.exec(url);
        if (!m) return false;
        const at = Date.UTC(+m[1], +m[2] - 1, +(m[3] || 1));
        return (t || Date.now()) - at > 45 * 24 * HOUR;
    };

    const parseTime = (s) => {
        if (!s) return null;
        let t = Date.parse(s);
        // "Mon, Sep 14 2026 09:55:00 PM" (NBC DFW) parses as local time, which
        // is right for a Dallas station read in Dallas
        if (!isFinite(t)) t = Date.parse(String(s).replace(/,/g, ''));
        if (!isFinite(t)) return null;
        if (t > Date.now() + 10 * MIN_MS) return null; // a feed that says the future is in the wrong zone
        return t;
    };

    const hashOf = (s) => {
        let h = 5381;
        for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
        return (h >>> 0).toString(36);
    };

    const normalize = (feed, raw) => {
        let title = unescape(raw.title).replace(/\s+/g, ' ').trim();
        let name = feed.name;
        if (feed.gn) {
            // "Headline - AP News", "Headline | NHK WORLD-JAPAN News - NHK"
            const m = /^(.*\S)\s+[-–—]\s+([^-–—]+)$/.exec(title);
            if (m) {
                title = m[1];
                const pub = m[2].trim();
                const hit = GN_NAMES.find(([re]) => re.test(pub));
                name = hit ? hit[1] : pub;
            }
            title = title.replace(/\s+\|\s+[^|]*NHK[^|]*$/i, '').trim();
        }
        if (!title || JUNK_TITLE.test(title) || JUNK_LINK.test(raw.link || '')) return null;
        const [big, small] = bigImage(raw.image);
        const img = small && !tooSmall(small) ? small : '';
        const link = unescape(raw.link || '');
        const t = parseTime(raw.published);
        return {
            id: hashOf(link || title),
            title,
            summary: cleanSummary(raw.summary, title).slice(0, 360),
            image: img ? big : '',
            imageSmall: img,
            link,
            t,
            // a picture dated well before the story is a stock graphic ("CHILD FOUND")
            stock: !!img && stockImage(img, t),
            source: name,
            feed: feed.id,
            weight: feed.weight || 0,
        };
    };

    // ---------- The same story from several papers ----------

    const STOP = new Set(('the a an and or but of to in on at for from by with as is are was were be been has have had it its '
        + 'this that these those after before over under into about amid says said say new more than not no will would could can '
        + 'up out off his her their they them he she we you who what when where why how all just may might us u.s '
        + 'le la les un une des du de et en au aux pour par sur dans avec est sont qui que ce cette son ses leur plus pas ne'
    ).split(' '));
    const tokens = (title) => {
        const out = new Set();
        String(title).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[’']s\b/g, '').split(/[^a-z0-9]+/)
            .forEach((w) => {
                if (w.length < 3 || STOP.has(w)) return;
                // plurals and -ing forms match their stems, roughly
                out.add(w.length > 4 ? w.replace(/(ing|es|s)$/, '') : w);
            });
        return out;
    };
    const sameStory = (a, b) => {
        let shared = 0;
        for (const w of a) if (b.has(w)) shared++;
        const small = Math.min(a.size, b.size);
        return shared >= 3 && shared / small >= 0.55;
    };

    // Merge a section's items: one story per event, the version with a
    // picture (then the newest) up front, the other papers under "also".
    const merge = (items) => {
        const stories = [];
        const byLink = new Map();
        for (const it of items) {
            if (it.link && byLink.has(it.link)) continue;
            const tk = tokens(it.title);
            const hit = stories.find((s) => sameStory(s.tk, tk));
            if (!hit) {
                const s = Object.assign({}, it, { tk, also: [], t: it.t });
                stories.push(s);
                if (it.link) byLink.set(it.link, s);
                continue;
            }
            if (it.link) byLink.set(it.link, hit);
            if (hit.source !== it.source && !hit.also.includes(it.source)) hit.also.push(it.source);
            // the picture, or failing that the summary, from whoever has one
            const better = (!hit.image && it.image) || (!!hit.image === !!it.image && it.weight > hit.weight);
            if (better) {
                const keepAlso = hit.also.filter((n) => n !== it.source);
                if (!keepAlso.includes(hit.source)) keepAlso.push(hit.source);
                Object.assign(hit, it, { tk: hit.tk, also: keepAlso, t: Math.max(hit.t || 0, it.t || 0) || null });
            } else {
                if (!hit.summary && it.summary) hit.summary = it.summary;
                if (it.t && (!hit.t || it.t > hit.t)) hit.t = it.t;
            }
        }
        return stories;
    };

    // newer first, pulled up by how many papers have it, a picture, and the
    // feed's weight (a front page's pick counts for more)
    const rank = (stories, keep) => {
        const now = Date.now();
        const hours = (s) => (s.t ? (now - s.t) / HOUR : 8);
        const score = (s) => -hours(s) + 1.6 * Math.min(s.also.length, 4) + (s.image ? 1 : 0) + s.weight;
        const fresh = stories.filter((s) => !s.t || now - s.t <= keep);
        const list = fresh.length >= 8 ? fresh : stories;
        return list.map((s) => [score(s), s]).sort((a, b) => b[0] - a[0]).map(([, s]) => s);
    };

    // ---------- Age: "12m", "3h", "2d" ----------

    const fmtAge = (t) => {
        if (!t) return '';
        const m = Math.max(0, Math.round((Date.now() - t) / MIN_MS));
        if (m < 1) return 'now';
        if (m < 60) return m + 'm';
        const h = Math.round(m / 60);
        if (h < 24) return h + 'h';
        return Math.round(h / 24) + 'd';
    };

    // ---------- The cache ----------

    const loadStore = () => {
        try {
            const s = JSON.parse(localStorage.getItem(STORE) || 'null');
            return s && s.v === 1 && s.feeds ? s.feeds : {};
        } catch {
            return {};
        }
    };
    let saveTimer = 0;
    const saveStore = (state) => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            const feeds = {};
            for (const [id, f] of state) {
                if (!f.items || !f.items.length) continue;
                feeds[id] = {
                    at: f.at,
                    // the big picture's address is worked out again on the way back in
                    items: f.items.slice(0, STORE_ITEMS).map((i) => Object.assign({}, i, { image: undefined, summary: (i.summary || '').slice(0, 220) })),
                };
            }
            try { localStorage.setItem(STORE, JSON.stringify({ v: 1, feeds })); } catch { /* full: memory only */ }
        }, 2000);
    };

    // ---------- A hub's news ----------

    const fetchJson = async (url) => {
        const ctl = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = setTimeout(() => ctl && ctl.abort(), TIMEOUT_MS);
        try {
            const res = await fetch(url, ctl ? { signal: ctl.signal } : {});
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return await res.json();
        } finally {
            clearTimeout(timer);
        }
    };

    const create = (opts = {}) => {
        const onUpdate = typeof opts.onUpdate === 'function' ? opts.onUpdate : () => {};
        // feed id -> { items, at (last good fetch), fails, retryAt, loading, error }
        const state = new Map();
        const cached = loadStore();
        FEEDS.forEach((f) => {
            const c = cached[f.id];
            if (c) c.items.forEach((i) => { i.image = i.imageSmall ? bigImage(i.imageSmall)[0] : ''; });
            state.set(f.id, { items: c ? c.items : null, at: c ? c.at : 0, fromCache: !!c, fails: 0, retryAt: 0, loading: false, error: null });
        });

        let running = false;
        let timer = 0;
        let inFlight = 0;
        let wanted = ['top']; // sections to load first (the one on screen)
        const built = new Map(); // section -> { stories, at }
        const dirty = new Set(SECTIONS.map((s) => s.key));

        const due = (f, now) => {
            const st = state.get(f.id);
            if (st.loading) return false;
            if (st.retryAt && now < st.retryAt) return false;
            return !st.at || st.fromCache || now - st.at >= REFRESH_MS - 5000;
        };
        const queue = () => {
            const now = Date.now();
            const order = [...wanted, ...SECTIONS.map((s) => s.key).filter((k) => !wanted.includes(k))];
            const out = [];
            order.forEach((k) => sectionOf(k).feeds.forEach((f) => { if (due(f, now)) out.push(f); }));
            return out;
        };

        let notifyTimer = 0;
        const pending = new Set();
        const notify = (section) => {
            pending.add(section);
            if (notifyTimer) return;
            notifyTimer = setTimeout(() => {
                notifyTimer = 0;
                const keys = [...pending];
                pending.clear();
                keys.forEach((k) => {
                    try { onUpdate(k); } catch (err) { console.error('[HOMER News]', err); }
                });
            }, 120);
        };

        const load = async (f) => {
            const st = state.get(f.id);
            st.loading = true;
            inFlight++;
            try {
                const j = await fetchJson(`${feedBase()}/feed?url=${encodeURIComponent(f.url)}`);
                const items = ((j && j.items) || []).map((r) => normalize(f, r)).filter(Boolean);
                st.items = items;
                st.at = Date.now();
                st.fromCache = false;
                st.live = true;
                st.fails = 0;
                st.retryAt = 0;
                st.error = null;
            } catch (err) {
                st.fails++;
                st.retryAt = Date.now() + Math.min(RETRY_MAX, RETRY_MIN * 2 ** (st.fails - 1));
                st.error = String((err && err.message) || err);
                st.fromCache = false; // the cached items stay; don't ask again until retryAt
                console.warn(`[HOMER News] ${f.name} (${f.id}) didn't load:`, st.error);
            } finally {
                st.loading = false;
                inFlight--;
            }
            if (!running) return;
            dirty.add(f.section);
            notify(f.section);
            saveStore(state);
            pump();
        };

        const pump = () => {
            if (!running) return;
            const q = queue();
            while (inFlight < PARALLEL && q.length) load(q.shift());
        };

        const build = (key) => {
            const sec = sectionOf(key);
            if (!sec) return [];
            if (!dirty.has(key) && built.has(key)) return built.get(key).stories;
            const items = [];
            sec.feeds.forEach((f) => {
                const st = state.get(f.id);
                if (st.items) items.push(...st.items);
            });
            // newest first into the merge, so a story's first version is its latest
            items.sort((a, b) => (b.t || 0) - (a.t || 0));
            const stories = rank(merge(items), sec.keep);
            stories.forEach((s) => { delete s.tk; });
            built.set(key, { stories, at: Date.now() });
            dirty.delete(key);
            return stories;
        };

        // 'ready' (a feed answered), 'loading', 'stale' (only the cache, and
        // every feed has failed since), or 'error' (nothing at all)
        const status = (key) => {
            const sec = sectionOf(key);
            if (!sec) return 'error';
            const sts = sec.feeds.map((f) => state.get(f.id));
            if (sts.some((s) => s.live)) return 'ready';
            const waiting = sts.some((s) => s.loading || !s.fails);
            if (waiting) return 'loading';
            return sts.some((s) => s.items && s.items.length) ? 'stale' : 'error';
        };

        return {
            // start(): read the feeds now, and every few minutes after
            start() {
                if (running) return;
                running = true;
                pump();
                timer = setInterval(() => {
                    // the rankings age too: redraw even when nothing new came in
                    SECTIONS.forEach((s) => dirty.add(s.key));
                    pump();
                }, 30000);
                // the cache (if any) is there straight away
                setTimeout(() => SECTIONS.forEach((s) => notify(s.key)), 0);
            },
            stop() {
                running = false;
                clearInterval(timer);
                clearTimeout(notifyTimer);
                notifyTimer = 0;
                pending.clear();
            },
            // refresh(): everything that's due again, now (OK on an error)
            refresh() {
                for (const st of state.values()) st.retryAt = 0;
                pump();
            },
            // want(key): load this section's feeds first
            want(key) {
                if (!sectionOf(key)) return;
                wanted = [key, ...wanted.filter((k) => k !== key)].slice(0, 3);
                pump();
            },
            stories: build,
            // the lead: the best story with a picture in a section
            lead(key = 'top') {
                const list = build(key);
                return list.find((s) => s.image) || list[0] || null;
            },
            // headlines for the ticker: a section's first n
            headlines(key, n = 8) {
                return build(key).slice(0, n);
            },
            status,
            // when a section last heard from any of its feeds
            updatedAt(key) {
                const sec = sectionOf(key);
                return sec ? Math.max(0, ...sec.feeds.map((f) => state.get(f.id).at || 0)) : 0;
            },
            // for checking: each feed's state
            feeds() {
                return FEEDS.map((f) => {
                    const st = state.get(f.id);
                    return { id: f.id, name: f.name, section: f.section, items: st.items ? st.items.length : 0, at: st.at, fails: st.fails, error: st.error, cached: st.fromCache };
                });
            },
        };
    };

    window.HomerNewsData = { version: VERSION, SECTIONS, FEEDS, create, feedBase, fmtAge, bigImage };
})();
