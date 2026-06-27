import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var sessionStore: SessionStore

    var body: some View {
        Form {
            Toggle("Notifications", isOn: .constant(true))
            Button("Sign Out") {
                sessionStore.signOut()
            }
        }
    }
}
