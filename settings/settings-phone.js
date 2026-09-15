/*
 * HOMER Settings, phone layout. settings/settings.js draws this instead of the
 * TV screen when shared/layout.js says it's a phone; both draw from the same
 * settings (createModel in settings.js), and every choice saves the moment
 * it's picked, as on TV.
 *
 * One column: each setting with what it's set to. A tap opens its choices
 * right under it, one setting at a time and one level deep: whether it's
 * saved to the account or kept on this device, what it does, and the choices,
 * with a check on the current one. Weather location has a ZIP box that brings
 * up the number pad and stays above it; Home Assistant has an address box,
 * Connect, and a Disconnect that asks for a second tap. Sign out asks for a
 * second tap. Who's signed in and the server are at the bottom.
 *
 * A video playing in a preview window docks at the top (HomerPlayer pins it
 * there); a tap on it goes full screen, ✕ stops it.
 *
 * window.HomerSettingsPhone = { create, version }
 */
(() => {
    const VERSION = '0.1.0';
    const CONFIRM_MS = 8000; // Sign out waits this long for its second tap

    const el = (tag, cls, html) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html != null) e.innerHTML = html;
        return e;
    };
    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const icon = (name, cls) => `<span class="material-icons${cls ? ' ' + cls : ''}" aria-hidden="true">${name}</span>`;

    const create = (ctx) => {
        const m = ctx.model;
        const P = () => window.HomerPlayer || null;
        const W = () => window.HomerWeather || null;

        let open = (ctx.state && ctx.state.id) || null; // the setting whose choices are showing
        let armed = false; // Sign out tapped once
        let armedOpt = null; // { id, i }: a choice that asks first (Disconnect), tapped once
        let armTimer = 0;
        let signingOut = false;
        let zipBusy = false;
        let alive = true;

        // ---------- Page ----------
        const root = el('div', 'homer-screen hx-root hx-phone');
        root.id = 'hx-root';
        root.style.visibility = 'hidden'; // until the stylesheet is in
        root.innerHTML = `
            <div class="xp-dock">
                <div class="xp-video" data-homer-preview><span class="xp-video-idle">Tuning…</span></div>
                <div class="xp-dock-bar">
                    <span class="xp-dock-what"></span>
                    <button type="button" class="xp-dock-btn xp-dock-full" aria-label="Full screen">${icon('fullscreen')}</button>
                    <button type="button" class="xp-dock-btn xp-dock-stop" aria-label="Stop">${icon('close')}</button>
                </div>
            </div>
            <div class="xp-scroll">
                <div class="xp-col">
                    <div class="xp-list"></div>
                    <div class="xp-state"></div>
                    <div class="xp-account">
                        <div class="xp-account-row">${icon('person')}<span class="xp-account-user"></span></div>
                        <div class="xp-account-row">${icon('dns')}<span class="xp-account-server"></span></div>
                    </div>
                </div>
            </div>
            <div class="xp-toast" role="status" aria-live="polite"></div>`;
        document.body.appendChild(root);
        const $ = (s) => root.querySelector(s);
        const scroller = $('.xp-scroll');
        const list = $('.xp-list');

        // don't leave a Jellyfin control underneath focused
        const ae = document.activeElement;
        if (ae && ae !== document.body && !root.contains(ae) && typeof ae.blur === 'function') ae.blur();

        // ---------- Toast ----------
        const toastEl = $('.xp-toast');
        let toastTimer = 0;
        const toast = (msg, kind = '') => {
            toastEl.innerHTML = `${icon(kind === 'err' ? 'error_outline' : 'check_circle')}<span class="xp-toast-text">${esc(msg)}</span>`;
            toastEl.className = 'xp-toast show' + (kind ? ' ' + kind : '');
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => { toastEl.className = 'xp-toast'; }, 2200);
        };

        // ---------- The list ----------
        const byId = (id) => m.visible.find((s) => s.id === id) || null;

        // a choice; the ZIP code gets its box and a Save button under it
        const choiceHtml = (s, o, i, cur) => {
            const isArmed = !!(o.confirm && armedOpt && armedOpt.id === s.id && armedOpt.i === i);
            const label = isArmed ? o.confirmTap || o.confirm : o.label;
            const text = `<span class="xp-opt-text"><span class="xp-opt-label">${esc(label)}</span>${o.sub && !isArmed ? `<span class="xp-opt-sub">${esc(o.sub)}</span>` : ''}</span>`;
            if (o.input === 'url') {
                return `<div class="xp-opt xp-zip-opt xp-url-opt" data-i="${i}">
                    <div class="xp-zip-top">${icon('link', 'xp-opt-lead')}${text}</div>
                    <form class="xp-zip-form xp-url-form" novalidate>
                        <input class="xp-url" type="url" inputmode="url" enterkeyhint="done" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="http://homeassistant.local:8123" value="${esc(o.url)}" aria-label="Home Assistant address">
                        <button type="submit" class="xp-zip-save">Save</button>
                    </form>
                </div>`;
            }
            if (!o.input) {
                return `<button type="button" class="xp-opt${cur ? ' cur' : ''}${o.info ? ' info' : ''}${isArmed ? ' armed' : ''}" data-i="${i}" aria-pressed="${cur}">${icon('check', 'xp-opt-check')}${text}</button>`;
            }
            return `<div class="xp-opt xp-zip-opt${cur ? ' cur' : ''}" data-i="${i}">
                    <div class="xp-zip-top">${icon('check', 'xp-opt-check')}${text}</div>
                    <form class="xp-zip-form" novalidate>
                        <input class="xp-zip" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="5" enterkeyhint="done" autocomplete="off" spellcheck="false" value="${esc(o.zip)}" aria-label="ZIP code">
                        <button type="submit" class="xp-zip-save">Save</button>
                    </form>
                </div>`;
        };

        const panelHtml = (s) => {
            const scope = m.scope(s);
            const v = s.current();
            return `<div class="xp-panel">
                    <div class="xp-scope">${icon(scope.icon)}${esc(scope.label)}</div>
                    <div class="xp-desc">${esc(m.desc(s))}</div>
                    <div class="xp-opts">${s.options().map((o, i) => choiceHtml(s, o, i, s.matches(o, v))).join('')}</div>
                </div>`;
        };

        const settingHtml = (s) => {
            if (s.action) {
                // Sign out: a tap arms it, a second tap signs out
                const label = signingOut ? 'Signing out…' : armed ? 'Sign out?' : s.label;
                const sub = armed && !signingOut ? 'Tap again to sign out' : m.desc(s);
                return `<button type="button" class="xp-row xp-signout${armed ? ' armed' : ''}" data-id="${s.id}">
                        ${icon(s.icon, 'xp-row-icon')}<span class="xp-row-text"><span class="xp-row-label">${esc(label)}</span><span class="xp-row-value">${esc(sub)}</span></span>
                    </button>`;
            }
            const isOpen = open === s.id;
            return `<section class="xp-set${isOpen ? ' open' : ''}" data-id="${s.id}">
                    <button type="button" class="xp-row" aria-expanded="${isOpen}">
                        ${icon(s.icon, 'xp-row-icon')}<span class="xp-row-text"><span class="xp-row-label">${esc(s.label)}</span><span class="xp-row-value">${esc(m.valueLabel(s)) || '&nbsp;'}</span></span>${icon('expand_more', 'xp-row-go')}
                    </button>
                    ${isOpen ? panelHtml(s) : ''}
                </section>`;
        };

        const drawList = () => {
            list.innerHTML = m.visible.map(settingHtml).join('');
        };
        // one setting again (its value, its choices), leaving the rest alone
        const drawSetting = (s) => {
            const old = list.querySelector(`[data-id="${s.id}"]`);
            if (!old) { drawList(); return; }
            const t = document.createElement('template');
            t.innerHTML = settingHtml(s).trim();
            old.replaceWith(t.content.firstChild);
        };

        // The opened setting's row at the top, so its choices show under it
        const reveal = (id) => {
            const sec = list.querySelector(`[data-id="${id}"]`);
            if (!sec) return;
            const top = sec.offsetTop - 10;
            const fits = sec.offsetTop >= scroller.scrollTop && sec.offsetTop + sec.offsetHeight <= scroller.scrollTop + scroller.clientHeight;
            if (!fits) scroller.scrollTo({ top, behavior: 'smooth' });
        };

        const toggle = (id) => {
            open = open === id ? null : id;
            drawList();
            if (open) reveal(open);
        };

        // ---------- Choosing ----------
        const choose = async (s, i) => {
            const o = s.options()[i];
            if (!o || m.status !== 'ready') return;
            if (o.input === 'url') { editUrl(); return; }
            if (o.input) { editZip(); return; }
            if (o.info) return; // says how things are; nothing to pick
            // a choice that asks first (Disconnect): the first tap arms it
            if (o.confirm) {
                if (!armedOpt || armedOpt.id !== s.id || armedOpt.i !== i) {
                    armedOpt = { id: s.id, i, at: Date.now() };
                    drawSetting(s);
                    clearTimeout(armTimer);
                    armTimer = setTimeout(disarm, CONFIRM_MS);
                    return;
                }
                if (Date.now() - armedOpt.at < 400) return; // a double tap isn't a decision
                clearTimeout(armTimer);
                armedOpt = null;
            }
            if (s.matches(o, s.current()) && !o.confirm) {
                toast('Saved');
                return;
            }
            // the new check at once; it goes back if the save fails
            const saving = m.save(s, o);
            drawSetting(s);
            try {
                await saving;
                if (!alive) return;
                toast(o.done || 'Saved');
            } catch (err) {
                console.warn('[HOMER Settings] save failed', err);
                if (!alive) return;
                toast('Couldn\'t save that. Try again.', 'err');
            }
            if (alive) drawSetting(s);
        };

        // ---------- Sign out ----------
        const disarm = () => {
            clearTimeout(armTimer);
            if (armedOpt) {
                const was = byId(armedOpt.id);
                armedOpt = null;
                if (was) drawSetting(was);
            }
            if (!armed || signingOut) return;
            armed = false;
            const s = m.visible.find((x) => x.action);
            if (s) drawSetting(s);
        };
        const tapSignOut = (s) => {
            if (m.status !== 'ready' || signingOut) return;
            if (!armed) {
                armed = true;
                drawSetting(s);
                clearTimeout(armTimer);
                armTimer = setTimeout(disarm, CONFIRM_MS);
                return;
            }
            clearTimeout(armTimer);
            signingOut = true;
            drawSetting(s);
            ctx.signOut();
        };

        // ---------- The Home Assistant address box ----------
        const HA = () => window.HomerHA || null;
        const urlBox = () => list.querySelector('.xp-url');
        const editUrl = () => {
            const box = urlBox();
            if (!box) return;
            box.focus();
            box.select();
        };
        const submitUrl = () => {
            const box = urlBox();
            if (!box || !HA()) return;
            if (!HA().setAddress(box.value)) { toast('That isn\'t an address', 'err'); return; }
            const problem = HA().addressProblem();
            box.blur(); // the keyboard goes away
            if (problem) toast('Needs an https:// address here', 'err');
            else toast('Saved · ' + HA().address());
            const s = byId('ha');
            if (s) drawSetting(s);
        };
        // its connection coming and going changes its row
        const offHA = HA() ? HA().onChange(() => {
            const s = byId('ha');
            const box = urlBox();
            if (alive && s && m.status === 'ready' && !(box && document.activeElement === box)) drawSetting(s);
        }) : () => {};

        // ---------- The ZIP code box ----------
        const zipBox = () => list.querySelector('.xp-zip');
        const editZip = () => {
            const box = zipBox();
            if (!box || zipBusy) return;
            box.focus();
            box.select();
        };
        const submitZip = async () => {
            const box = zipBox();
            if (!box || zipBusy || !W()) return;
            const zip = box.value.trim();
            if (!/^\d{5}$/.test(zip)) { toast('Enter a 5-digit ZIP code', 'err'); return; }
            zipBusy = true;
            const opt = box.closest('.xp-opt');
            const sub = opt && opt.querySelector('.xp-opt-sub');
            if (sub) sub.textContent = 'Looking it up…';
            let hit = null;
            let failed = false;
            try { hit = await W().useZip(zip); } catch { failed = true; }
            zipBusy = false;
            if (!alive) return;
            const s = byId('weather');
            if (hit) {
                box.blur(); // the keyboard goes away
                toast(`Saved · ${hit.name}`);
            } else {
                toast(failed ? 'Couldn\'t look that up. Try again.' : `Couldn't find ZIP ${zip}`, 'err');
            }
            if (s) drawSetting(s);
            if (!hit) {
                const again = zipBox();
                if (again) { again.value = zip; again.focus(); }
            }
        };

        // Keep the ZIP box above the on-screen keyboard. The keyboard covers the
        // bottom of the page (the visual viewport shrinks); give the list room to
        // scroll that far and bring the box up above it.
        const vv = window.visualViewport || null;
        const keepZipVisible = () => {
            const box = [zipBox(), urlBox()].find((b) => b && document.activeElement === b);
            if (!box) {
                root.style.removeProperty('--xp-kb');
                return;
            }
            const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
            root.style.setProperty('--xp-kb', Math.max(0, Math.round(window.innerHeight - bottom)) + 'px');
            const r = box.closest('.xp-opt').getBoundingClientRect();
            const s = scroller.getBoundingClientRect();
            const limit = Math.min(bottom, s.bottom) - 12;
            if (r.bottom > limit) scroller.scrollTop += r.bottom - limit;
            else if (r.top < s.top + 8) scroller.scrollTop -= s.top + 8 - r.top;
        };
        let kbTimer = 0;
        const onViewport = () => {
            clearTimeout(kbTimer);
            kbTimer = setTimeout(keepZipVisible, 60);
        };
        if (vv) {
            vv.addEventListener('resize', onViewport);
            vv.addEventListener('scroll', onViewport);
        }
        const onFocusIn = (ev) => {
            if (!ev.target.classList.contains('xp-zip') && !ev.target.classList.contains('xp-url')) return;
            keepZipVisible();
            setTimeout(keepZipVisible, 350); // once the keyboard is up
        };
        const onFocusOut = (ev) => {
            if (ev.target.classList.contains('xp-url')) {
                if (HA()) ev.target.value = HA().address();
                setTimeout(keepZipVisible, 350);
                return;
            }
            if (!ev.target.classList.contains('xp-zip')) return;
            // put the saved ZIP back unless it's being looked up
            if (!zipBusy && W()) ev.target.value = W().zip().zip;
            setTimeout(keepZipVisible, 350);
        };
        const onInput = (ev) => {
            if (!ev.target.classList.contains('xp-zip')) return;
            const digits = ev.target.value.replace(/\D/g, '').slice(0, 5);
            if (digits !== ev.target.value) ev.target.value = digits;
        };
        const onSubmit = (ev) => {
            if (!ev.target.classList.contains('xp-zip-form')) return;
            ev.preventDefault();
            if (ev.target.classList.contains('xp-url-form')) submitUrl();
            else submitZip();
        };

        // ---------- Taps ----------
        const onClick = (ev) => {
            const t = ev.target;
            // a tap anywhere but the armed button puts it back
            const tappedOpt = t.closest('.xp-opt');
            if (!t.closest('.xp-signout') && !(tappedOpt && tappedOpt.classList.contains('armed'))) disarm();
            if (t.closest('.xp-retry')) { load(); return; }
            if (m.status !== 'ready' || signingOut) return;
            const so = t.closest('.xp-signout');
            if (so) { tapSignOut(byId(so.dataset.id)); return; }
            const sec = t.closest('.xp-set');
            if (!sec) return;
            const s = byId(sec.dataset.id);
            if (!s) return;
            if (t.closest('.xp-row')) { toggle(s.id); return; }
            if (t.closest('.xp-zip-form')) return; // the box and its Save button
            const o = t.closest('.xp-opt');
            if (o) choose(s, Number(o.dataset.i));
        };

        // Esc closes the open setting, then goes back (a phone with a keyboard)
        const onKey = (ev) => {
            if (document.getElementById('cg-root')) return; // the guide is up
            if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
            if (!['Escape', 'Backspace', 'GoBack', 'BrowserBack'].includes(ev.key)) return;
            if (ev.target && ev.target.classList && (ev.target.classList.contains('xp-zip') || ev.target.classList.contains('xp-url'))) {
                if (ev.key !== 'Backspace') { ev.preventDefault(); ev.target.blur(); }
                ev.stopPropagation();
                return;
            }
            ev.preventDefault();
            ev.stopPropagation();
            if (open) toggle(open);
            else ctx.goBack();
        };
        // scrolling here is Settings' alone (Jellyfin's player page turns it into volume)
        const onWheel = (ev) => {
            if (root.contains(ev.target)) ev.stopPropagation();
        };

        root.addEventListener('click', onClick);
        root.addEventListener('focusin', onFocusIn);
        root.addEventListener('focusout', onFocusOut);
        root.addEventListener('input', onInput);
        root.addEventListener('submit', onSubmit);
        document.addEventListener('keydown', onKey, true);
        window.addEventListener('wheel', onWheel, { capture: true, passive: true });

        // ---------- Docked video ----------
        const dockEl = $('.xp-dock');
        let dockFor = '';
        const syncDock = () => {
            const hp = P();
            const on = !!(hp && hp.docked && hp.docked());
            root.classList.toggle('xp-docked', on);
            if (!on) { dockFor = ''; return; }
            const v = document.querySelector('.videoPlayerContainer.homer-pinned video');
            root.classList.toggle('xp-live', !!(v && v.readyState >= 2 && v.videoWidth > 0));
            const np = hp.nowPlaying ? hp.nowPlaying() : null;
            const p = np && np.program;
            const item = np && np.item;
            const what = p ? [p.ChannelNumber ? `CH ${p.ChannelNumber}` : '', p.Name].filter(Boolean).join(' · ') : item ? item.Name || '' : '';
            if (what !== dockFor) {
                dockFor = what;
                $('.xp-dock-what').innerHTML = `${p ? '<span class="xp-live-badge">Live</span>' : ''}<span>${esc(what)}</span>`;
            }
        };
        dockEl.addEventListener('click', (ev) => {
            const hp = P();
            if (!hp) return;
            if (ev.target.closest('.xp-dock-stop')) { ev.stopPropagation(); hp.stop(); } else if (ev.target.closest('.xp-dock-full')) { ev.stopPropagation(); hp.fullscreen(); }
            // a tap on the video itself: HomerPlayer takes it to full screen
        });
        const offPlayer = P() && P().onChange ? P().onChange(syncDock) : () => {};
        const dockTimer = setInterval(syncDock, 500); // the video coming in, what's playing
        syncDock();

        // ---------- Data ----------
        const stateEl = $('.xp-state');
        const setState = (html) => {
            stateEl.innerHTML = html || '';
            stateEl.classList.toggle('show', !!html);
            root.classList.toggle('xp-waiting', !!html);
        };
        const load = async () => {
            const loading = m.load();
            setState('<div class="xp-spinner"></div><b>Loading settings…</b>');
            try {
                if (!await loading || !alive) return;
                if (open && !byId(open)) open = null;
                $('.xp-account-user').innerHTML = m.userLine();
                $('.xp-account-server').innerHTML = m.serverLine();
                setState('');
                drawList();
                if (open) setTimeout(() => reveal(open), 0);
            } catch {
                if (!alive) return;
                setState(`<b>Couldn't load your settings</b><button type="button" class="xp-retry">${icon('refresh')}Try again</button>`);
            }
        };
        drawList();
        load();

        return {
            phone: true,
            show() { root.style.visibility = ''; },
            // where Settings is, for the TV layout
            state: () => ({ id: open }),
            teardown() {
                alive = false;
                m.dispose();
                offHA();
                clearTimeout(toastTimer);
                clearTimeout(armTimer);
                clearTimeout(kbTimer);
                clearInterval(dockTimer);
                offPlayer();
                if (vv) {
                    vv.removeEventListener('resize', onViewport);
                    vv.removeEventListener('scroll', onViewport);
                }
                document.removeEventListener('keydown', onKey, true);
                window.removeEventListener('wheel', onWheel, { capture: true });
                root.remove();
            }
        };
    };

    window.HomerSettingsPhone = { version: VERSION, create };
    // tell the layout Settings has a phone layout (Settings already open on a
    // phone switches over)
    if (window.HomerLayout) window.HomerLayout.register('settings', { phone: true });
})();
