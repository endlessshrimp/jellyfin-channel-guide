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
        const href = BASE + path + QUERY;
        const had = document.getElementById(id);
        if (had) {
            if (had.href !== href) had.href = href; // loaded again from elsewhere: swap it too
            return;
        }
        const l = document.createElement('link');
        l.id = id;
        l.rel = 'stylesheet';
        l.href = href;
        document.head.appendChild(l);
    };
    const js = (path) => {
        const s = document.createElement('script');
        s.src = BASE + path + QUERY;
        s.async = false; // keep load order
        document.head.appendChild(s);
    };

    css('shared/tokens.css', 'homer-tokens');
    css('shared/shell.css', 'homer-shell'); // the TV screens' shared stage, top bar and legend
    css('skin/skin.css', 'homer-skin');
    css('shared/weather.css', 'homer-weather');
    css('shared/phone.css', 'homer-phone'); // the phone layout's top bar and tab bar
    js('shared/layout.js'); // first: TV or phone layout, and touch
    js('shared/player.js'); // every screen plays through it
    js('shared/weather.js');
    js('shared/logos.js'); // before the screens: they hand it their channel logos
    js('guide/guide-model.js'); // the guide's channels, listings and recordings
    js('guide/guide.js');
    js('guide/guide-phone.js'); // the guide's phone layout
    js('home/home.js');
    js('library/library.js');
    js('settings/settings.js');
    js('search/search.js');
    js('recordings/recordings.js');
    js('forecast/forecast.js');
})();
