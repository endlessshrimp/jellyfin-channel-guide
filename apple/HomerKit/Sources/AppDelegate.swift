import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        true
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}

/// Apps built with the tvOS 26 SDK or later must use scenes, or they quit
/// the moment they launch, with no crash log (tvOSBrowser PR #68). So there's
/// a UIApplicationSceneManifest in Info.plist and a scene delegate here, and
/// the app-level background callbacks (which no longer fire) are the scene's.
final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    private var homer: HomerViewController? { window?.rootViewController as? HomerViewController }

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = HomerViewController.make()
        window.backgroundColor = .black
        window.makeKeyAndVisible()
        self.window = window
    }

    func sceneWillResignActive(_ scene: UIScene) { homer?.saveSession() }
    func sceneDidEnterBackground(_ scene: UIScene) { homer?.saveSession() }
    func sceneDidDisconnect(_ scene: UIScene) { homer?.saveSession() }
}
