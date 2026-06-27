import Foundation

struct AuthenticationService {
    func currentUser() async -> UserProfile {
        UserProfile(displayName: "Avery")
    }

    func signOut() {
    }
}

struct AnalyticsService {
    func recentEvents() -> [ActivityEvent] {
        [
            ActivityEvent(title: "Opened dashboard"),
            ActivityEvent(title: "Updated settings")
        ]
    }
}
