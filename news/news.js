/*
 * HOMER News Hub (#/news): the day's news on one screen, made from the shared
 * hub (shared/hub.js): CNN in the TV window, every news channel in the guide
 * under it, the headlines along the bottom in the ticker, and the stories
 * themselves on the right.
 *
 *   TV window   CNN (channel 1200, looked up by number) on open, unless a
 *               video is already playing or docked
 *   Guide       the news channels: U.S. (1200–1219), Dallas–Fort Worth
 *               (1220–1249), weather (1250s), U.K. (3200s), France (5200s),
 *               world (7200s), with what's on now and next
 *   Tabs        Top, US, World, UK, France, Business, Local, Tech: a lead
 *               story with a big picture, then story cards (picture,
 *               headline, "NYT · 12m"), then more headlines a line each
 *   A story     OK opens it over the tabs: the headline, the picture, the
 *               feed's summary, who else has it, and a QR code to read the
 *               whole article on a phone (a TV can't open web pages inside
 *               HOMER). ◀▶ goes through the section's stories; OK or Esc
 *               closes it.
 *   Ticker      Top Stories, World, DFW, Business, Tech headlines; OK on one
 *               opens it
 *
 * The stories come from news/news-data.js (window.HomerNewsData): real
 * publishers' RSS through HOMER's feed helper on the NAS.
 *
 * Keys: the hub's (arrows, OK, [ ] or 1–8 for sections, F, Esc, H), plus the
 * story reader's (◀▶, OK/Esc).
 *
 * window.HomerNews = { open, reader, data, destroy, version }
 */
(() => {
    const VERSION = '0.1.0';

    if (window.HomerNews && typeof window.HomerNews.destroy === 'function') {
        window.HomerNews.destroy();
    }

    const CNN = '1200';
    const QR_LIB = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js';
    const TICKER_SECTIONS = ['top', 'world', 'local', 'business', 'tech'];
    const CARDS = 12; // story cards under the lead
    const LINES = 12; // then this many more headlines, a line each
    const FRESH_MS = 30 * 60000; // "new": the age turns red
    const HOLD_MS = 45000; // new stories wait this long while you're browsing the cards
    const BACK_KEYS = ['Escape', 'Backspace', 'GoBack', 'BrowserBack'];

    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const D = () => window.HomerNewsData || null;
    const fmtAge = (t) => (D() ? D().fmtAge(t) : '');
    const safe = (fn, fallback) => {
        try { return fn(); } catch (err) { console.warn('[HOMER News]', err); return fallback; }
    };

    // ---------- The news (one copy while the hub is open) ----------

    let news = null; // HomerNewsData instance
    let hub = null; // the open hub's API
    const listeners = new Set(); // section key -> redraw
    const startNews = () => {
        if (news || !D()) return news;
        news = D().create({ onUpdate: (key) => listeners.forEach((fn) => safe(() => fn(key))) });
        news.start();
        return news;
    };
    const stopNews = () => {
        if (news) news.stop();
        news = null;
        listeners.clear();
    };
    const sectionOf = (key) => (D() ? D().SECTIONS.find((s) => s.key === key) : null);
    // the hub drew its phone layout (shared/hub.js marks the root)
    const isPhone = () => !!(hub && hub.root && hub.root.classList.contains('hb-phone'));

    // ---------- Pieces ----------

    // a picture box: the paper's name on navy until the picture is in; the
    // big version first, the feed's own if that fails, and none if both do
    const picture = (story, cls) => `
        <div class="hn-img ${cls}">
            <span class="hn-mast">${esc(story.source)}</span>
            ${story.image ? `<img alt="" draggable="false" decoding="async" data-big="${esc(story.image)}" data-small="${esc(story.imageSmall || '')}">` : ''}
        </div>`;
    const loadPictures = (box) => {
        box.querySelectorAll('.hn-img img[data-big]').forEach((img) => {
            const holder = img.parentElement;
            const small = img.dataset.small;
            img.onload = () => {
                img.classList.add('in');
                holder.classList.add('has-img');
            };
            img.onerror = () => {
                if (small && img.getAttribute('src') !== small) img.src = small;
                else img.remove();
            };
            img.src = img.dataset.big;
            img.removeAttribute('data-big');
        });
    };

    const ageHtml = (t) => {
        if (!t) return '';
        const fresh = Date.now() - t < FRESH_MS;
        return `<span class="dot">·</span><span class="age${fresh ? ' fresh' : ''}" data-t="${t}">${esc(fmtAge(t))}</span>`;
    };
    // "NYT · 12m · also BBC, NPR"
    const metaHtml = (s, { also = true } = {}) => {
        const more = also && s.also && s.also.length
            ? `<span class="dot">·</span><span class="also">+ ${esc(s.also.slice(0, 3).join(', '))}${s.also.length > 3 ? ` +${s.also.length - 3}` : ''}</span>` : '';
        return `<div class="hn-meta"><span class="src">${esc(s.source)}</span>${ageHtml(s.t)}${more}</div>`;
    };
    // keep the ages right without redrawing
    const refreshAges = (box) => {
        box.querySelectorAll('.age[data-t]').forEach((a) => {
            const t = +a.dataset.t;
            a.textContent = fmtAge(t);
            a.classList.toggle('fresh', Date.now() - t < FRESH_MS);
        });
    };

    // ---------- QR code (for reading the article on a phone) ----------

    let qrP = null;
    const qrLib = () => {
        if (window.qrcode) return Promise.resolve(window.qrcode);
        if (!qrP) {
            qrP = new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = QR_LIB;
                s.async = true;
                s.onload = () => (window.qrcode ? resolve(window.qrcode) : reject(new Error('no qrcode')));
                s.onerror = () => reject(new Error('QR code library didn\'t load'));
                document.head.appendChild(s);
            });
            qrP.catch(() => { qrP = null; });
        }
        return qrP;
    };
    // an <svg> of the link, one path, dark on white
    const qrSvg = (lib, text) => {
        const q = lib(0, 'L');
        q.addData(text);
        q.make();
        const n = q.getModuleCount();
        let d = '';
        for (let r = 0; r < n; r++) {
            for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
        }
        return `<svg viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" aria-hidden="true"><path d="${d}" fill="#07142a"/></svg>`;
    };

    // "nytimes.com", or for a Google News link the paper's name
    const siteOf = (s) => {
        try {
            const h = new URL(s.link).hostname.replace(/^(www|www3|rss|feeds|m)\./, '');
            return /news\.google\.com$/.test(h) ? `${s.source} (via Google News)` : h;
        } catch {
            return s.source;
        }
    };

    // ---------- The story reader ----------

    let reader = null; // { el, legend, list, i, section, onClose }

    const readerKeys = () => `
        <span data-action="prev"><span class="hb-key">◀▶</span>Stories</span>
        <span data-action="close"><span class="hb-key">OK</span>Close</span>
        <span class="spacer"></span>
        <span data-action="home"><span class="hb-key">H</span>Home</span>
        <span data-action="close"><span class="hb-key">ESC</span>Back</span>`;

    // On a phone the article can open: a button to it instead of the QR
    // code, the story in a column that scrolls, ‹ › buttons for the next one.
    const paintPhoneReader = () => {
        const s = reader.list[reader.i];
        const sec = sectionOf(reader.section);
        const summary = s.summary ? `<p class="hn-reader-sum">${esc(s.summary)}</p>` : '';
        const also = s.also && s.also.length ? `<div class="hn-reader-also">Also reported by <b>${esc(s.also.join(', '))}</b></div>` : '';
        const n = reader.list.length;
        reader.el.innerHTML = `
            <div class="hn-pr-bar">
                <button type="button" class="hn-pr-btn" data-action="close" aria-label="Back"><span class="material-icons" aria-hidden="true">arrow_back</span></button>
                <span class="hn-reader-count">${esc(sec ? sec.label : '')} · ${reader.i + 1} of ${n}</span>
            </div>
            <div class="hn-pr-scroll">
                ${metaHtml(s, { also: false })}
                <h2>${esc(s.title)}</h2>
                ${s.image ? picture(s, 'hn-reader-img') : ''}
                ${summary}
                ${also}
                ${s.link ? `<a class="hn-pr-read" href="${esc(s.link)}" target="_blank" rel="noopener noreferrer"><span>Read it at <b>${esc(siteOf(s))}</b></span><span class="material-icons" aria-hidden="true">open_in_new</span></a>` : ''}
            </div>
            <div class="hn-pr-nav">
                <button type="button" class="hn-pr-btn" data-action="prev"${n < 2 ? ' disabled' : ''}><span class="material-icons" aria-hidden="true">chevron_left</span>Previous</button>
                <button type="button" class="hn-pr-btn" data-action="next"${n < 2 ? ' disabled' : ''}>Next<span class="material-icons" aria-hidden="true">chevron_right</span></button>
            </div>`;
        loadPictures(reader.el);
    };

    const paintReader = () => {
        if (!reader) return;
        const s = reader.list[reader.i];
        if (!s) return;
        if (reader.phone) { paintPhoneReader(); return; }
        const sec = sectionOf(reader.section);
        const body = reader.el;
        const summary = s.summary
            ? `<p class="hn-reader-sum${s.summary.length < 170 ? ' short' : ''}">${esc(s.summary)}</p>`
            : `<p class="hn-reader-sum none">${esc(s.source)}'s feed has only the headline for this one.</p>`;
        const also = s.also && s.also.length ? `<div class="hn-reader-also">Also reported by <b>${esc(s.also.join(', '))}</b></div>` : '';
        body.innerHTML = `
            <div class="hn-reader-top">
                ${metaHtml(s, { also: false })}
                <span class="hn-reader-count">${esc(sec ? sec.label : '')} · ${reader.i + 1} of ${reader.list.length}</span>
            </div>
            <h2>${esc(s.title)}</h2>
            <div class="hn-reader-body${s.image ? '' : ' noimg'}">
                <div class="hn-reader-side">
                    ${picture(s, 'hn-reader-img')}
                    <div class="hn-reader-read">
                        <div class="hn-qr"></div>
                        <div class="hn-reader-link"><span>Read the whole story on your phone</span><b>${esc(siteOf(s))}</b></div>
                    </div>
                </div>
                <div class="hn-reader-text">
                    ${summary}
                    ${also}
                </div>
            </div>`;
        loadPictures(body);
        const qr = body.querySelector('.hn-qr');
        if (s.link) {
            const link = s.link;
            qrLib().then((lib) => {
                if (!reader || reader.list[reader.i] !== s) return;
                qr.innerHTML = safe(() => qrSvg(lib, link), '');
            }).catch(() => {
                const l = body.querySelector('.hn-reader-link span');
                if (l) l.textContent = 'Read the whole story at';
            });
        }
    };

    const closeReader = () => {
        if (!reader) return;
        const r = reader;
        reader = null;
        r.el.classList.remove('show');
        r.root.classList.remove('hn-reading');
        setTimeout(() => { r.el.remove(); r.legend.remove(); }, 200);
        if (r.onClose) safe(() => r.onClose(r.list[r.i]));
        else if (r.phone && hub) {
            // opened from the ticker: a tap focused (and paused) it; let it run again
            const tab = hub.root.querySelector('.hb-tab.on');
            if (tab) safe(() => hub.focus(tab));
        }
    };

    // open(list, i): a section's stories, at story i
    const openReader = (list, i, section, onClose) => {
        if (!hub || !list || !list[i]) return;
        if (reader) closeReader();
        const phone = isPhone();
        const el = document.createElement('div');
        el.className = 'hn-reader' + (phone ? ' phone' : '');
        const legend = document.createElement('div');
        legend.className = 'hn-reader-legend';
        legend.innerHTML = readerKeys();
        if (phone) {
            // over the tabs and the stories, under the video strip
            (hub.stage.querySelector('.hb-main') || hub.stage).appendChild(el);
            el.addEventListener('click', (ev) => {
                const a = ev.target.closest('button[data-action]');
                if (!a) return;
                if (a.dataset.action === 'close') closeReader();
                else if (a.dataset.action === 'prev') stepReader(-1);
                else if (a.dataset.action === 'next') stepReader(1);
            });
        } else {
            hub.stage.appendChild(el);
            hub.stage.appendChild(legend);
        }
        reader = { el, legend, root: hub.root, list, i, section, onClose, phone };
        hub.root.classList.add('hn-reading');
        paintReader();
        void el.offsetWidth;
        el.classList.add('show');
        legend.addEventListener('click', (ev) => {
            const a = ev.target.closest('[data-action]');
            if (!a) return;
            if (a.dataset.action === 'close') closeReader();
            else if (a.dataset.action === 'prev') stepReader(1);
            else if (a.dataset.action === 'home') { closeReader(); if (window.HomerPlayer) window.HomerPlayer.goHome(); }
        });
    };
    const stepReader = (dir) => {
        if (!reader) return;
        const n = reader.list.length;
        reader.i = (reader.i + dir + n) % n;
        paintReader();
        const sc = reader.el.querySelector('.hn-pr-scroll');
        if (sc) sc.scrollTop = 0;
    };

    // The reader's keys come before the hub's: this listener is added when
    // this file loads, ahead of any hub screen's (same target and phase run
    // in the order they were added).
    const onKey = (ev) => {
        if (!reader || ev.ctrlKey || ev.metaKey || ev.altKey) return;
        if (document.getElementById('cg-root')) return; // the TV guide is on top
        const k = ev.key;
        const stop = () => { ev.preventDefault(); ev.stopImmediatePropagation(); };
        if (BACK_KEYS.includes(k) || k === 'Enter' || k === ' ') { stop(); if (!ev.repeat) closeReader(); return; }
        if (k === 'ArrowLeft') { stop(); stepReader(-1); return; }
        if (k === 'ArrowRight') { stop(); stepReader(1); return; }
        if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'PageUp' || k === 'PageDown' || k === '[' || k === ']' || /^[1-9]$/.test(k)) { stop(); return; }
        // H (Home), F (full screen), G (the guide), L pass through; the reader closes with the hub
        if (k === 'h' || k === 'H' || k === 'g' || k === 'G') closeReader();
    };
    window.addEventListener('keydown', onKey, true);

    // ---------- A section's tab ----------

    // what's drawn: the lead, the cards, the lines
    const layout = (stories) => {
        // the lead wants a news photo, not a station's stock graphic
        const lead = stories.find((s) => s.image && !s.stock) || stories.find((s) => s.image) || stories[0] || null;
        const rest = stories.filter((s) => s !== lead);
        return { lead, cards: rest.slice(0, CARDS), lines: rest.slice(CARDS, CARDS + LINES) };
    };
    const signature = (l) => [l.lead, ...l.cards, ...l.lines].filter(Boolean).map((s) => s.id + (s.image ? '+' : '')).join(',');

    // ---------- On a phone: Watch CNN, then the stories in one column ----------

    // CNN and what's on it, looked up once a few minutes
    let cnnP = null;
    let cnnAt = 0;
    const cnnInfo = (ctx) => {
        if (!cnnP || Date.now() - cnnAt > 5 * 60000) {
            cnnAt = Date.now();
            cnnP = ctx.channels.byNumber(CNN).then(async (ch) => {
                if (!ch) return null;
                const M = window.HomerGuideModel;
                const server = M && M.getServer && M.getServer();
                let program = null;
                if (server) {
                    const r = await ctx.data.api(`/LiveTv/Programs?UserId=${server.UserId}&ChannelIds=${ch.Id}&IsAiring=true&Limit=1&EnableImages=false`).catch(() => null);
                    program = (r && r.Items && r.Items[0]) || null;
                }
                return { ch, program };
            });
            cnnP.catch(() => { cnnP = null; });
        }
        return cnnP;
    };
    // a tap plays CNN in the strip at the top (HomerPlayer docks it there);
    // hidden while something's playing (the strip is up then)
    const watchBar = (ctx) => {
        const b = document.createElement('div');
        b.className = 'hn-watch';
        b.innerHTML = `
            <span class="hn-watch-logo"></span>
            <span class="hn-watch-text"><b>Watch CNN</b><small>Live on ${CNN}</small></span>
            <span class="material-icons" aria-hidden="true">play_circle</span>`;
        ctx.focusable(b, () => ctx.hub.tune(CNN), 'Watch CNN');
        cnnInfo(ctx).then((info) => {
            if (!info || !b.isConnected) return;
            const url = ctx.channels.logoUrl(info.ch, 64);
            if (url) {
                const chip = b.querySelector('.hn-watch-logo');
                const img = new Image();
                img.alt = '';
                img.src = url;
                chip.appendChild(img);
                if (window.HomerLogos) window.HomerLogos.watch(img, chip);
            }
            const p = info.program;
            const name = p && p.Name && !/\(\w+\. \d\d:\d\d - \d\d:\d\d\)$/.test(p.Name) ? p.Name.replace(/^live\s*[:\-–]\s*/i, '') : '';
            b.querySelector('small').textContent = name ? `Live · ${name}` : `Live on ${info.ch.Number}`;
        }).catch(() => {});
        return b;
    };

    // the lead with its picture, then a row a story: headline and paper ·
    // age on the left, a small picture on the right
    const drawPhone = (ctx, key, panel, l, open) => {
        panel.appendChild(watchBar(ctx));
        const lead = document.createElement('div');
        lead.className = 'hn-lead hn-plead';
        lead.dataset.key = l.lead.id;
        lead.innerHTML = `
            ${l.lead.image ? picture(l.lead, 'hn-lead-img') : ''}
            <div class="hn-lead-body">
                <span class="hn-kicker">${key === 'top' ? 'Top story' : esc(sectionOf(key).label)}</span>
                <h2>${esc(l.lead.title)}</h2>
                ${metaHtml(l.lead)}
            </div>`;
        ctx.focusable(lead, () => open(0), 'Read');
        panel.appendChild(lead);
        const rows = document.createElement('div');
        rows.className = 'hn-prows';
        [...l.cards, ...l.lines].forEach((st, k) => {
            const r = document.createElement('div');
            r.className = 'hn-prow';
            r.dataset.key = st.id;
            // the feed's own (smaller) picture is plenty for a thumbnail
            const thumb = st.image ? picture({ source: '', image: st.imageSmall || st.image, imageSmall: st.image }, 'hn-thumb') : '';
            r.innerHTML = `<div class="hn-prow-text"><h3>${esc(st.title)}</h3>${metaHtml(st, { also: false })}</div>${thumb}`;
            ctx.focusable(r, () => open(k + 1), 'Read');
            rows.appendChild(r);
        });
        panel.appendChild(rows);
    };

    const renderSection = (key) => (ctx) => {
        const n = startNews();
        if (!hub) hub = ctx.hub; // the first tab draws before the hub's onOpen
        const panel = ctx.panel;
        if (!n) {
            panel.appendChild(ctx.ui.empty('The news didn\'t load', 'news/news-data.js is missing.'));
            return null;
        }
        n.want(key);
        let shown = ''; // the signature on screen
        let heldSince = 0;
        let lastKeyAt = 0;
        let list = []; // the stories in screen order (for the reader)

        const open = (i) => openReader(list, i, key, (s) => {
            // back on the card of the last story read, if it's on screen
            const card = s && panel.querySelector(`[data-key="${CSS.escape(s.id)}"]`);
            if (card) ctx.focus(card);
        });

        const draw = () => {
            const stories = n.stories(key);
            const l = layout(stories);
            const sig = signature(l) || 'none:' + n.status(key);
            if (sig === shown && panel.childElementCount) { refreshAges(panel); return; }
            shown = sig;
            list = [l.lead, ...l.cards, ...l.lines].filter(Boolean);
            panel.innerHTML = '';
            if (!l.lead) {
                if (isPhone()) panel.appendChild(watchBar(ctx));
                const st = n.status(key);
                panel.appendChild(st === 'error'
                    ? ctx.ui.empty('The news didn\'t load', 'HOMER\'s feed helper didn\'t answer. It tries again every few minutes.')
                    : ctx.ui.empty('Getting the news…'));
                return;
            }
            if (isPhone()) {
                drawPhone(ctx, key, panel, l, open);
            } else {
                let idx = 0;
                // the lead
                const lead = document.createElement('div');
                lead.className = 'hn-lead';
                lead.dataset.key = l.lead.id;
                lead.innerHTML = `
                    ${picture(l.lead, 'hn-lead-img')}
                    <div class="hn-lead-body">
                        <span class="hn-kicker">${key === 'top' ? 'Top story' : esc(sectionOf(key).label)}</span>
                        <h2>${esc(l.lead.title)}</h2>
                        ${metaHtml(l.lead)}
                    </div>`;
                const li = idx++;
                ctx.focusable(lead, () => open(li), 'Read');
                panel.appendChild(lead);
                // the cards
                if (l.cards.length) {
                    const grid = document.createElement('div');
                    grid.className = 'hn-grid';
                    l.cards.forEach((s) => {
                        const c = document.createElement('div');
                        c.className = 'hn-card' + (s.image ? '' : ' text');
                        c.dataset.key = s.id;
                        c.innerHTML = `
                            ${s.image ? picture(s, 'hn-card-img') : ''}
                            <div class="hn-card-body">
                                <h3>${esc(s.title)}</h3>
                                ${!s.image && s.summary ? `<div class="hn-sum">${esc(s.summary)}</div>` : ''}
                                ${metaHtml(s)}
                            </div>`;
                        const ci = idx++;
                        ctx.focusable(c, () => open(ci), 'Read');
                        grid.appendChild(c);
                    });
                    panel.appendChild(grid);
                }
                // more headlines
                if (l.lines.length) {
                    const more = document.createElement('div');
                    more.className = 'hn-more';
                    more.innerHTML = '<div class="hn-more-head">More headlines</div>';
                    l.lines.forEach((s) => {
                        const r = document.createElement('div');
                        r.className = 'hn-line';
                        r.dataset.key = s.id;
                        r.innerHTML = `<h3>${esc(s.title)}</h3>${metaHtml(s, { also: false })}`;
                        const ri = idx++;
                        ctx.focusable(r, () => open(ri), 'Read');
                        more.appendChild(r);
                    });
                    panel.appendChild(more);
                }
            }
            // where it's from
            const sec = sectionOf(key);
            const papers = [...new Set(sec.feeds.map((f) => f.name))];
            const at = n.updatedAt(key);
            const foot = document.createElement('div');
            foot.className = 'hn-foot';
            const stale = n.status(key) === 'stale';
            foot.innerHTML = `From <b>${esc(papers.join(', '))}</b>${at ? ` · updated <span class="age" data-t="${at}">${esc(fmtAge(at))}</span> ago` : ''}`
                + (stale ? '<br>The feeds aren\'t answering right now, so these are the last ones HOMER saw. It keeps trying.' : '');
            panel.appendChild(foot);
            loadPictures(panel);
            ctx.refocus();
        };

        // New stories reorder the cards, so while you're moving around in them
        // they wait (up to HOLD_MS after your last key); ages update anyway.
        // (on a phone: a finger on the list in the last HOLD_MS)
        const browsing = () => {
            if (isPhone()) return Date.now() - lastKeyAt < HOLD_MS;
            const f = panel.querySelector('.hb-focus');
            return !!f && Date.now() - lastKeyAt < HOLD_MS;
        };
        const onUpdate = (k) => {
            if (k !== key || !ctx.alive()) return;
            if (!shown || !panel.querySelector('.hn-lead')) { draw(); return; }
            if (browsing() || reader) {
                if (!heldSince) heldSince = Date.now();
                return;
            }
            heldSince = 0;
            draw();
        };
        const onKeyNote = () => { lastKeyAt = Date.now(); };
        const scrollBox = panel.closest('.hb-panel') || panel;
        window.addEventListener('keydown', onKeyNote, true);
        scrollBox.addEventListener('scroll', onKeyNote, { passive: true });
        scrollBox.addEventListener('pointerdown', onKeyNote, { passive: true });
        listeners.add(onUpdate);
        const ages = setInterval(() => {
            refreshAges(panel);
            if (heldSince && !browsing() && !reader) { heldSince = 0; draw(); }
        }, 20000);

        draw();
        return () => {
            listeners.delete(onUpdate);
            window.removeEventListener('keydown', onKeyNote, true);
            scrollBox.removeEventListener('scroll', onKeyNote);
            scrollBox.removeEventListener('pointerdown', onKeyNote);
            clearInterval(ages);
            if (reader && reader.section === key) closeReader();
        };
    };

    // ---------- The ticker ----------

    const tickerItem = (s, list, i, key) => ({
        html: `<span class="hb-tk-text"><span class="hn-tk-src">${esc(s.source)}</span>${esc(s.title)}${s.t ? `<span class="hn-tk-age${Date.now() - s.t < FRESH_MS ? ' fresh' : ''}">${esc(fmtAge(s.t))}</span>` : ''}</span>`,
        key: s.id,
        act: () => openReader(list, i, key),
    });
    const tickerSegments = () => {
        const n = news;
        if (!n) return [];
        return TICKER_SECTIONS.map((key) => {
            const sec = sectionOf(key);
            const list = n.headlines(key, 8);
            // a phone's chip is narrow: "Top", not "Top Stories"
            const label = isPhone() ? (key === 'local' ? sec.ticker : sec.label) : sec.ticker;
            return { label, color: 'var(--news)', items: list.map((s, i) => tickerItem(s, list, i, key)) };
        }).filter((s) => s.items.length);
    };
    let tickerTimer = 0;
    let tickerHad = false;
    const pushTicker = () => {
        clearTimeout(tickerTimer);
        // the first headlines straight away, later ones in a bunch
        tickerTimer = setTimeout(() => {
            const t = hub && hub.ticker && hub.ticker();
            if (!t) return;
            const segs = tickerSegments();
            if (segs.length) { t.setSegments(segs); tickerHad = true; }
        }, tickerHad ? 4000 : 300);
    };

    // ---------- The hub ----------

    const inRange = (lo, hi) => (ch, info) => info.number >= lo && info.number < hi;
    const GROUPS = [
        { key: 'us', label: 'U.S. News', test: inRange(1200, 1220) },
        { key: 'dfw', label: 'Dallas–Fort Worth', test: inRange(1220, 1250) },
        { key: 'wx', label: 'Weather', test: inRange(1250, 1300) },
        { key: 'uk', label: 'U.K.', test: inRange(3200, 3300) },
        { key: 'fr', label: 'France', test: inRange(5200, 5300) },
        { key: 'world', label: 'World', test: inRange(7200, 7300) },
    ];

    const define = () => {
        const H = window.HomerHub;
        const data = D();
        if (!H || !data) return false;
        H.define({
            id: 'news',
            route: 'news',
            title: 'News',
            css: 'news/news.css',
            tv: { channel: CNN },
            guide: {
                title: 'News channels',
                include: (ch, info) => GROUPS.some((g) => g.test(ch, info)),
                groups: GROUPS,
            },
            tabs: data.SECTIONS.map((s) => ({ key: s.key, label: s.label, render: renderSection(s.key) })),
            phone: true, // its phone layout: a column between HOMER's bars (shared/hub.js), no CNN until asked
            ticker: {
                mode: 'flip',
                pageMs: 6500,
                refreshMs: 0, // pushed as the news comes in (pushTicker)
                priorityLabel: 'Breaking',
                stepLabel: 'Headlines',
                okLabel: 'Read',
                empty: 'Getting the headlines…',
            },
            // Back with a story open closes the story (the reader's own key
            // listener normally gets there first)
            onBack() {
                if (!reader) return false;
                closeReader();
                return true;
            },
            onOpen(api) {
                hub = api;
                startNews();
                const onAny = (k) => { if (TICKER_SECTIONS.includes(k)) pushTicker(); };
                listeners.add(onAny);
                pushTicker();
            },
            onClose() {
                closeReader();
                clearTimeout(tickerTimer);
                tickerHad = false;
                stopNews();
                hub = null;
            },
        });
        return true;
    };

    // hub.js and news-data.js may load after this file
    let tries = 0;
    let defineTimer = 0;
    const tryDefine = () => {
        if (define()) return;
        if (++tries < 150) defineTimer = setTimeout(tryDefine, 200);
        else console.warn('[HOMER News] shared/hub.js or news/news-data.js never loaded');
    };
    tryDefine();

    window.HomerNews = {
        version: VERSION,
        open() { if (window.HomerHub) window.HomerHub.open('news'); },
        // for checking: the reader, and the news
        reader: () => reader,
        data: () => news,
        destroy() {
            clearTimeout(defineTimer);
            clearTimeout(tickerTimer);
            window.removeEventListener('keydown', onKey, true);
            closeReader();
            if (window.HomerHub && window.HomerHub.undefine) safe(() => window.HomerHub.undefine('news'));
            stopNews();
            hub = null;
        },
    };
})();
