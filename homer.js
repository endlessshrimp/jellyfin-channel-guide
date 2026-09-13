/*
 * HOMER for Jellyfin Web: loads every HOMER screen from the same release.
 * Point the JavaScript Injector at this one file:
 *   https://cdn.jsdelivr.net/gh/endlessshrimp/jellyfin-channel-guide@<tag>/homer.js
 */
(() => {
    const src = (document.currentScript && document.currentScript.src) || '';
    const BASE = src.replace(/homer\.js(\?.*)?$/, '');
    const QUERY = (src.match(/\?.*$/) || [''])[0];
    if (window.__homerLoaded === BASE + QUERY) return;
    window.__homerLoaded = BASE + QUERY;

    const css = (path, id) => {
        if (document.getElementById(id)) return;
        const l = document.createElement('link');
        l.id = id;
        l.rel = 'stylesheet';
        l.href = BASE + path + QUERY;
        document.head.appendChild(l);
    };
    const js = (path) => {
        const s = document.createElement('script');
        s.src = BASE + path + QUERY;
        s.async = false; // keep load order
        document.head.appendChild(s);
    };

    css('shared/tokens.css', 'homer-tokens');
    css('skin/skin.css', 'homer-skin');
    js('shared/player.js'); // first: every screen plays through it
    js('guide/guide.js');
    js('home/home.js');
    js('library/library.js');
    js('settings/settings.js');
    js('search/search.js');
})();
