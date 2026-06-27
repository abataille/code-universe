import Foundation

final class SessionStore: ObservableObject {
    @Published private(set) var user = UserProfile(displayName: "Avery")
    private let authenticationService = AuthenticationService()

    func refresh() async {
        user = await authenticationService.currentUser()
    }

    func signOut() {
        authenticationService.signOut()
    }
}
