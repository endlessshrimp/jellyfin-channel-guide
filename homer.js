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
    css('shared/hub.css', 'hb-css'); // the hubs (Sports, News)
    css('shared/arr.css', 'homer-arr-css'); // Sonarr/Radarr's chips (Search, the guide)
    js('shared/layout.js'); // first: TV or phone layout, and touch
    js('shared/homeassistant.js'); // before the player: it takes a Home Assistant sign-in off the address first
    js('rooms/quick.js'); // before the screens: its keys (L, and the panel's arrows) come first
    js('shared/player.js'); // every screen plays through it
    js('shared/skip.js'); // commercial skip in the full-screen player
    js('shared/weather.js');
    js('shared/logos.js'); // before the screens: they hand it their channel logos
    js('shared/arr.js'); // before the screens: Sonarr and Radarr through HOMER's NAS helper
    js('guide/guide-model.js'); // the guide's channels, listings and recordings
    js('guide/guide.js');
    js('guide/guide-phone.js'); // the guide's phone layout
    js('home/home.js');
    js('home/home-phone.js'); // Home's phone layout
    js('library/library-model.js'); // the library screens' data
    js('library/library.js');
    js('library/library-phone.js'); // the library screens' phone layout
    js('settings/settings.js');
    js('settings/settings-phone.js'); // Settings' phone layout
    js('search/search.js');
    js('search/search-phone.js'); // Search's phone layout
    js('recordings/recordings-model.js'); // the DVR's recordings and timers
    js('recordings/recordings.js');
    js('recordings/recordings-phone.js'); // Recordings' phone layout
    js('forecast/forecast.js');
    js('forecast/forecast-phone.js'); // Weather's phone layout
    js('rooms/rooms.js'); // Home Assistant's rooms
    js('rooms/rooms-phone.js'); // Rooms' phone layout
    js('shared/ticker.js'); // the hubs' BottomLine-style ticker
    js('shared/hub.js'); // the hubs' screen: TV window, channel guide, tabs, ticker
    js('sports/sports-data.js'); // ESPN's scores, standings, rankings and news
    js('sports/sports.js'); // the Sports hub (#/sports)
    js('news/news-data.js'); // the News hub's feeds
    js('news/news.js'); // the News hub (#/news)
})();
