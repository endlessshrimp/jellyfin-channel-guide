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

    // ---------- Claiming the page ----------
    // Jellyfin Web routes long before HOMER's files land, and it knows none of
    // HOMER's own pages, so it paints its "Page not found" over the second or
    // two the rest of this file spends loading — longer cold, and every launch
    // in the Apple TV app. Nothing below has been fetched yet, so the claim is
    // made here, in the one file the injector runs, and it is the whole of it:
    // <html> gets homer-booting, blanking Jellyfin's page to HOMER's ground.
    // shared/loading.js (first in the list below) draws HOMER's loading screen
    // over that and takes both down when the screen is up; it owns the class
    // from the moment it loads, and the screen names with it. An address that
    // isn't one of HOMER's is left alone, so Jellyfin's real 404 still answers.
    const OURS = /^#\/(weather|rooms|cameras|planes|sports|news|books|music|radio|playing)(\?|$)/;
    if (!document.getElementById('homer-booting-css')) {
        const boot = document.createElement('style');
        boot.id = 'homer-booting-css';
        boot.textContent = `
            html.homer-booting { background: #02050a !important; }
            html.homer-booting .skinHeader,
            html.homer-booting .skinBody,
            html.homer-booting .mainDrawer,
            html.homer-booting .mainDrawerHandle,
            html.homer-booting .backdropContainer,
            html.homer-booting .docspinner { visibility: hidden !important; }`;
        document.head.appendChild(boot); // always: shared/loading.js uses it too
    }
    if (OURS.test(location.hash)) {
        document.documentElement.classList.add('homer-booting');
        // never blank the page for good: if shared/loading.js never arrives,
        // give Jellyfin back whatever it was going to show
        setTimeout(() => {
            if (!window.HomerLoading) document.documentElement.classList.remove('homer-booting');
        }, 30000);
    }

    css('shared/tokens.css', 'homer-tokens');
    css('shared/shell.css', 'homer-shell'); // the TV screens' shared stage, top bar and legend
    css('skin/skin.css', 'homer-skin');
    css('shared/weather.css', 'homer-weather');
    css('shared/phone.css', 'homer-phone'); // the phone layout's top bar and tab bar
    css('shared/hub.css', 'hb-css'); // the hubs (Sports, News)
    css('shared/arr.css', 'homer-arr-css'); // Sonarr/Radarr's chips (Search, the guide)
    css('shared/tmdb.css', 'homer-tmdb-css'); // TMDB's rows (Movies, TV Shows)
    css('music/music-strip.css', 'homer-music-strip-css'); // the music's now-playing strip, on every screen
    css('shared/alerts.css', 'homer-alerts-css'); // the alert crawl, over every screen
    css('music/playon.css', 'homer-playon-css'); // "Play on…", the Music screens' device picker
    css('music/radio.css', 'homer-radio-css'); // the Music screens' Radio tab
    js('shared/loading.js'); // first of all: HOMER's loading screen, over Jellyfin's 404
    js('shared/layout.js'); // first: TV or phone layout, and touch
    js('shared/menu.js'); // before the screens: Home and Now Playing draw its menu
    js('shared/actions.js'); // before the screens: they register their actions with it
    js('shared/homeassistant.js'); // before the player: it takes a Home Assistant sign-in off the address first
    js('rooms/quick.js'); // before the screens: its keys (L, and the panel's arrows) come first
    js('shared/player.js'); // every screen plays through it
    js('shared/skip.js'); // commercial skip in the full-screen player
    js('shared/weather.js');
    js('shared/alerts.js'); // the alert crawl: severe weather and the house, over any screen
    js('shared/logos.js'); // before the screens: they hand it their channel logos
    js('shared/arr.js'); // before the screens: Sonarr and Radarr through HOMER's NAS helper
    js('shared/tmdb.js'); // before the screens: what's out there, through the same helper
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
    js('cameras/cameras-model.js'); // the cameras, their events and clips
    js('cameras/cameras.js'); // Cameras (#/cameras)
    js('cameras/cameras-phone.js'); // Cameras' phone layout
    js('planes/planes-model.js'); // the ADS-B feeds, through the NAS helper
    js('planes/planes-map.js'); // the Planes map, shared by both layouts
    js('planes/planes.js'); // Planes (#/planes)
    js('planes/planes-phone.js'); // Planes' phone layout
    js('shared/ticker.js'); // the hubs' BottomLine-style ticker
    js('shared/hub.js'); // the hubs' screen: TV window, channel guide, tabs, ticker
    js('sports/sports-data.js'); // ESPN's scores, standings, rankings and news
    js('sports/sports.js'); // the Sports hub (#/sports)
    js('news/news-data.js'); // the News hub's feeds
    js('news/news.js'); // the News hub (#/news)
    js('books/books-model.js'); // the audiobooks (Jellyfin's Books library) and their player
    js('books/books.js'); // Books (#/books)
    js('books/books-phone.js'); // Books' phone layout
    js('music/radio-model.js'); // before the Music screens: internet radio (SomaFM, Radio Browser)
    js('music/playon.js'); // before the Music screens: "Play on…", the album (or a station) on a speaker
    js('music/music-model.js'); // the music (Jellyfin's Music library) and its player
    js('music/music-strip.js'); // the music's now-playing strip on every other screen
    js('music/music.js'); // Music (#/music)
    js('music/music-phone.js'); // Music's phone layout
    js('playing/playing-model.js'); // everything playing: Jellyfin's sessions, the house, HOMER's music
    js('playing/playing.js'); // Now Playing (#/playing)
    js('playing/playing-phone.js'); // Now Playing's phone layout
})();
