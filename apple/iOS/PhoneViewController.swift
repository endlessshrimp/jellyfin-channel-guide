import AVFoundation
import MediaPlayer
import UIKit

/// The iPhone and iPad half. The page takes touches itself, so there's no
/// input layer to speak of; what's here is the things a web view can't do on
/// its own:
///
/// - an audio session, so HOMER's Music keeps playing with the screen locked
///   or another app in front (with the audio background mode in Info.plist);
/// - what's playing on the lock screen, and its buttons wired back into
///   HOMER's player;
/// - picture in picture, turned on in the web view's configuration
///   (HomerWebView) so a video can pop out of the page.
final class PhoneViewController: HomerViewController {
    private var artworkURL: String?

    override func viewDidLoad() {
        super.viewDidLoad()
        startAudioSession()
        listenForRemoteCommands()
    }

    override var prefersHomeIndicatorAutoHidden: Bool { true }

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
        traitCollection.userInterfaceIdiom == .pad ? .all : [.portrait, .landscapeLeft, .landscapeRight]
    }

    // ---------- Sound that carries on ----------

    private func startAudioSession() {
        do {
            // .playback is the category that keeps going when the screen locks
            // or another app comes to the front. It's set now and made active
            // only while something is playing, so opening HOMER doesn't stop
            // whatever else was playing.
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
        } catch {
            print("[HOMER] audio session: \(error.localizedDescription)")
        }
        NotificationCenter.default.addObserver(self, selector: #selector(interrupted(_:)),
                                               name: AVAudioSession.interruptionNotification, object: nil)
    }

    /// Hold the audio session while the page is playing something.
    override func mediaPlayingChanged(_ playing: Bool) {
        do {
            if playing {
                try AVAudioSession.sharedInstance().setActive(true)
            } else {
                try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            }
        } catch {
            print("[HOMER] audio session \(playing ? "on" : "off"): \(error.localizedDescription)")
        }
    }

    @objc private func interrupted(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              AVAudioSession.InterruptionType(rawValue: raw) == .ended else { return }
        try? AVAudioSession.sharedInstance().setActive(true)
        web?.evaluate("window.__homerApp && window.__homerApp.remote('play')")
    }

    // ---------- The lock screen ----------

    private func listenForRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()
        let commands: [(MPRemoteCommand, String)] = [
            (center.playCommand, "play"),
            (center.pauseCommand, "pause"),
            (center.togglePlayPauseCommand, "toggle"),
            (center.nextTrackCommand, "next"),
            (center.previousTrackCommand, "previous"),
        ]
        for (command, name) in commands {
            command.isEnabled = true
            command.addTarget { [weak self] _ in
                self?.sendRemote(name)
                return .success
            }
        }
        center.changePlaybackPositionCommand.isEnabled = true
        center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            self?.web?.evaluate("window.__homerApp && window.__homerApp.remote('seek', \(event.positionTime))")
            return .success
        }
    }

    private func sendRemote(_ name: String) {
        web?.evaluate("window.__homerApp && window.__homerApp.remote(\(Self.js(name)))")
    }

    /// What HOMER's music player is doing, for the lock screen and Control
    /// Centre. The page sends this whenever a track or its state changes.
    override func handle(message: [String: Any], type: String) -> Bool {
        guard type == "nowplaying" else { return false }
        let center = MPNowPlayingInfoCenter.default()
        guard (message["playing"] as? Bool) != nil || message["title"] != nil else {
            center.nowPlayingInfo = nil
            return true
        }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: message["title"] as? String ?? "",
            MPMediaItemPropertyArtist: message["artist"] as? String ?? "",
            MPMediaItemPropertyAlbumTitle: message["album"] as? String ?? "",
            MPNowPlayingInfoPropertyPlaybackRate: (message["playing"] as? Bool) == true ? 1.0 : 0.0,
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
        ]
        if let duration = (message["duration"] as? NSNumber)?.doubleValue, duration > 0 {
            info[MPMediaItemPropertyPlaybackDuration] = duration
        }
        if let position = (message["position"] as? NSNumber)?.doubleValue {
            info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = position
        }
        if let art = center.nowPlayingInfo?[MPMediaItemPropertyArtwork], message["artwork"] as? String == artworkURL {
            info[MPMediaItemPropertyArtwork] = art
        }
        center.nowPlayingInfo = info
        loadArtwork(message["artwork"] as? String)
        #if DEBUG
        if Self.probe {
            print("[HOMER probe] now playing: \(message["title"] as? String ?? "-") — \(message["artist"] as? String ?? "-")"
                  + " playing=\((message["playing"] as? Bool) == true) position=\((message["position"] as? NSNumber)?.doubleValue ?? 0)")
        }
        #endif
        return true
    }

    /// The album's cover, fetched once per track.
    private func loadArtwork(_ urlString: String?) {
        guard let urlString, urlString != artworkURL, let url = URL(string: urlString) else { return }
        artworkURL = urlString
        URLSession.shared.dataTask(with: url) { data, _, _ in
            guard let data, let image = UIImage(data: data) else { return }
            DispatchQueue.main.async {
                guard self.artworkURL == urlString else { return } // the track moved on
                let art = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
                MPNowPlayingInfoCenter.default().nowPlayingInfo?[MPMediaItemPropertyArtwork] = art
            }
        }.resume()
    }
}
