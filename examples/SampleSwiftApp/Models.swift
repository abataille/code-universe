import Foundation

struct UserProfile {
    let displayName: String
}

struct ActivityEvent: Identifiable {
    let id = UUID()
    let title: String
}
