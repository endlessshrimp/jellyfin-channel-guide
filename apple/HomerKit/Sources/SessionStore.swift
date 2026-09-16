import Foundation
import Security

/// Keeps HOMER's sign-in across launches and reboots.
///
/// tvOS only promises about 500 KB of storage that survives, and a web
/// view's localStorage isn't part of it: tvOS can clear it whenever it needs
/// the room. So the app keeps its own copy of the few localStorage keys that
/// matter (Jellyfin's credentials and device id, HOMER's settings) in the
/// Keychain, and homer-tvapp.js puts them back before Jellyfin starts.
/// If the Keychain refuses, UserDefaults holds them instead.
struct SessionStore {
    private let service = "HOMER tvapp"
    private let account = "localStorage"
    private let defaultsKey = "HomerSavedLocalStorage"

    func load() -> [String: String] {
        if let data = keychainRead() ?? UserDefaults.standard.data(forKey: defaultsKey),
           let items = try? JSONDecoder().decode([String: String].self, from: data) {
            return items
        }
        return [:]
    }

    /// Saves `items` if they differ from what's saved.
    func save(_ items: [String: String]) {
        guard items != load(), let data = try? JSONEncoder().encode(items) else { return }
        if keychainWrite(data) {
            UserDefaults.standard.removeObject(forKey: defaultsKey)
        } else {
            UserDefaults.standard.set(data, forKey: defaultsKey)
        }
        print("[HOMER] saved sign-in: \(items.keys.sorted().joined(separator: ", "))")
    }

    // ---------- Keychain ----------

    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account]
    }

    private func keychainRead() -> Data? {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess else { return nil }
        return out as? Data
    }

    private func keychainWrite(_ data: Data) -> Bool {
        let attrs: [String: Any] = [kSecValueData as String: data,
                                    kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock]
        var status = SecItemUpdate(query as CFDictionary, attrs as CFDictionary)
        if status == errSecItemNotFound {
            var add = query
            add.merge(attrs) { _, new in new }
            status = SecItemAdd(add as CFDictionary, nil)
        }
        if status != errSecSuccess { print("[HOMER] Keychain said \(status); using UserDefaults") }
        return status == errSecSuccess
    }
}
