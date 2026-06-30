import AppKit
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate {
  private var window: NSWindow?
  private var webView: WKWebView?
  private var serverProcess: Process?

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.setActivationPolicy(.regular)
    NSApp.activate(ignoringOtherApps: true)

    let urlString = ProcessInfo.processInfo.environment["CODE_UNIVERSE_URL"] ?? "http://127.0.0.1:4174"
    if ProcessInfo.processInfo.environment["CODE_UNIVERSE_URL"] == nil {
      startLocalServerIfPossible()
    }

    let configuration = WKWebViewConfiguration()
    let webView = WKWebView(frame: .zero, configuration: configuration)
    self.webView = webView

    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered,
      defer: false
    )
    window.title = "Code Universe"
    window.center()
    window.contentView = webView
    window.makeKeyAndOrderFront(nil)
    self.window = window

    DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
      if let url = URL(string: urlString) {
        webView.load(URLRequest(url: url))
      }
    }
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    true
  }

  func applicationWillTerminate(_ notification: Notification) {
    serverProcess?.terminate()
  }

  private func startLocalServerIfPossible() {
    guard let repoRoot = findRepoRoot() else {
      return
    }

    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    process.arguments = ["npm", "start"]
    process.currentDirectoryURL = repoRoot
    var environment = ProcessInfo.processInfo.environment
    environment["PORT"] = "4174"
    process.environment = environment
    process.standardOutput = Pipe()
    process.standardError = Pipe()

    do {
      try process.run()
      serverProcess = process
    } catch {
      serverProcess = nil
    }
  }

  private func findRepoRoot() -> URL? {
    var candidate = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
    for _ in 0..<6 {
      if FileManager.default.fileExists(atPath: candidate.appendingPathComponent("server.js").path) {
        return candidate
      }
      candidate.deleteLastPathComponent()
    }
    return nil
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
