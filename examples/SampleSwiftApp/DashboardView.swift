import SwiftUI

struct DashboardView: View {
    @EnvironmentObject private var sessionStore: SessionStore
    private let analyticsService = AnalyticsService()

    var body: some View {
        VStack {
            Text(sessionStore.user.displayName)
            ActivityChartView(events: analyticsService.recentEvents())
        }
    }
}

struct ActivityChartView: View {
    let events: [ActivityEvent]

    var body: some View {
        List(events) { event in
            Text(event.title)
        }
    }
}
