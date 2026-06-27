import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var sessionStore: SessionStore
    @State private var selectedTab = 0

    var body: some View {
        TabView(selection: $selectedTab) {
            DashboardView()
                .tag(0)

            SettingsView()
                .tag(1)
        }
        .task {
            await sessionStore.refresh()
        }
    }
}
