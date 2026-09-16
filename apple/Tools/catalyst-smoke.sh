#!/bin/bash
# Runs the app's code on this Mac, without Xcode or an Apple TV.
#
# Builds the Apple TV app's code (HomerKit + tvOS) as a Mac Catalyst app with
# the Command Line Tools (the
# Mac SDK carries UIKit for Catalyst, and WebKit is loaded the same way it is
# on the TV), opens Tools/smoke/index.html from a local server in place of
# HOMER, and lets the Debug self-test press remote buttons. Then it runs again
# with the web view's storage wiped, to check the sign-in comes back.
#
# A small window opens on the Mac for about 40 seconds. It never loads HOMER
# or Jellyfin. Everything it saves is removed at the end.
#
#   apple-tv/Tools/catalyst-smoke.sh
set -u
HERE="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLE_ID=org.nelsons.homer.catalystsmoke
PORT=8765
WORK="$(mktemp -d)"
APP="$WORK/HOMER.app"
LOG="$WORK/server.log"
SDK="$(xcrun --show-sdk-path)"
IOS="$SDK/System/iOSSupport"

cleanup() {
    [ -n "${SERVER:-}" ] && { kill "$SERVER" 2>/dev/null; wait "$SERVER" 2>/dev/null; }
    pkill -f "$APP/Contents/MacOS/HOMER" 2>/dev/null
    rm -rf "$HOME/Library/WebKit/$BUNDLE_ID" "$HOME/Library/Caches/$BUNDLE_ID" "$HOME/Library/HTTPStorages/$BUNDLE_ID"*
    defaults delete "$BUNDLE_ID" >/dev/null 2>&1
    security delete-generic-password -s "HOMER tvapp" -a localStorage >/dev/null 2>&1
}
trap cleanup EXIT
cleanup

echo "== build (Mac Catalyst, Debug)"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -Onone -D DEBUG -swift-version 5 -module-name HOMER \
    -sdk "$SDK" -target arm64-apple-ios17.0-macabi \
    -F "$IOS/System/Library/Frameworks" -I "$IOS/usr/include" -L "$IOS/usr/lib" \
    -Xlinker -rpath -Xlinker /usr/lib/swift -Xlinker -rpath -Xlinker /System/iOSSupport/usr/lib/swift \
    "$HERE"/HomerKit/Sources/*.swift "$HERE"/tvOS/*.swift -o "$APP/Contents/MacOS/HOMER" || exit 1
cp "$HERE/HomerKit/Resources/homer-app.js" "$APP/Contents/Resources/"
sed -e 's/$(EXECUTABLE_NAME)/HOMER/; s/$(PRODUCT_NAME)/HOMER/; s/$(PRODUCT_MODULE_NAME)/HOMER/' \
    -e "s/\$(PRODUCT_BUNDLE_IDENTIFIER)/$BUNDLE_ID/; s/\$(PRODUCT_BUNDLE_PACKAGE_TYPE)/APPL/" \
    -e 's/$(MARKETING_VERSION)/0.1.0/; s/$(CURRENT_PROJECT_VERSION)/1/' \
    "$HERE/tvOS/Info.plist" > "$APP/Contents/Info.plist"
plutil -insert LSMinimumSystemVersion -string 14.0 "$APP/Contents/Info.plist"
plutil -insert CFBundleSupportedPlatforms -json '["MacOSX"]' "$APP/Contents/Info.plist"
plutil -insert UIDeviceFamily -json '[2]' "$APP/Contents/Info.plist"
codesign --force --sign - "$APP" >/dev/null 2>&1 || { echo "codesign failed"; exit 1; }

echo "== test server on 127.0.0.1:$PORT"
cd "$HERE/Tools/smoke" || exit 1
python3 - "$PORT" "$LOG" <<'PY' &
import http.server, sys, urllib.parse
port, log = int(sys.argv[1]), sys.argv[2]
class H(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/log?'):
            with open(log, 'a') as f:
                f.write(urllib.parse.unquote(self.path[5:]) + '\n')
            self.send_response(204); self.end_headers(); return
        super().do_GET()
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(('127.0.0.1', port), H).serve_forever()
PY
SERVER=$!
sleep 1

run() {
    NSUnbufferedIO=YES "$APP/Contents/MacOS/HOMER" -HomerURL "http://127.0.0.1:$PORT/index.html${2:-}" -HomerSelfTest YES >"$WORK/app$1.log" 2>&1 &
    local pid=$!
    sleep 12
    kill "$pid" 2>/dev/null
    wait "$pid" 2>/dev/null
}

echo "== run 1"
run 1
echo "== run 2 (web view storage wiped first)"
rm -rf "$HOME/Library/WebKit/$BUNDLE_ID" "$HOME/Library/Caches/$BUNDLE_ID"
run 2
echo "== run 3 (a sign-in form, no HOMER screen)"
run 3 '?plain'

echo "== app output"
cat "$WORK"/app*.log | grep '\[HOMER' | sort -u
echo "== what the page saw"
cat "$LOG"

pass=0; fail=0
check() {
    if grep -qE -- "$2" "$LOG" "$WORK"/app*.log; then echo "PASS  $1"; pass=$((pass + 1)); else echo "FAIL  $1"; fail=$((fail + 1)); fi
}
echo "== checks"
check "WebKit loaded at runtime"             '\[HOMER\] WebKit from '
check "bridge ran: HOMER_TVAPP"               'boot tvapp=true .*bridge=object'
check "no touch points (not an iPad)"         'maxTouchPoints=0'
check "desktop Safari user agent"             'ua=Mozilla/5.0 \(Macintosh'
check "clickpad down: ArrowDown / 40"         'keydown key="ArrowDown" code=ArrowDown keyCode=40 repeat=false'
check "held right arrow repeats"              'keydown key="ArrowRight" .*repeat=true'
check "select: Enter / 13"                    'keydown key="Enter" code=Enter keyCode=13 repeat=false target=BODY'
check "play/pause: Space / 32"                'keydown key=" " code=Space keyCode=32'
check "Back: Escape / 27"                     'keydown key="Escape" code=Escape keyCode=27'
check "hold Back: h / 72"                     'keydown key="h" code=KeyH keyCode=72'
check "keyup follows keydown"                 'keyup key="Enter"'
check "keyboard text lands in the box"        'input value=smoke'
check "Done presses Enter in the box"         'keydown key="Enter" .*target=q'
check "sign-in saved by the app"              '\[HOMER\] saved sign-in: .*homer-smoke'
check "sign-in restored after a wipe"         'restored=saved-[0-9]+'
check "hold OK: HOMER's menu, no Enter"      'homer-app action=menu'
check "swipe up / down: HOMER's swipes"       'homer-app action=swipe-(up|down)'
check "the old homer-tv event still fires"    'homer-tv action=menu'
check "the page is told which platform"       'boot .*platform=tvos'
check "swipe sideways stays an arrow"         'keydown key="ArrowLeft"'
check "a HOMER screen is never zoomed"        'zoomstate plain=false .* cssZoom=none'
check "Jellyfin's own pages are zoomed"       'zoomstate plain=true .* cssZoom=1.5'
check "sign-in form: arrow focuses, typed"   'plain input user=smoke'
check "sign-in form: Done moves to password"  'plain input pass=smoke'
check "sign-in form: OK clicks the button"    'plain click go user=smoke'
echo "== $pass passed, $fail failed"
[ "$fail" -eq 0 ]
