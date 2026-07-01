import AppKit
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate {
  private var window: NSWindow?
  private var webView: WKWebView?
  private var serverProcess: Process?
  private var baseURLString = ProcessInfo.processInfo.environment["CODE_UNIVERSE_URL"] ?? "http://127.0.0.1:4174"
  private var pendingScanPath: String?
  private var bundleIcon: NSImage?
  private let logURL = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Library/Logs/CodeUniverseMac.log")

  func applicationDidFinishLaunching(_ notification: Notification) {
    pendingScanPath = commandLineScanPath()
    NSApp.setActivationPolicy(.regular)
    applyBundleIcon()
    NSApp.activate(ignoringOtherApps: true)
    NSAppleEventManager.shared().setEventHandler(
      self,
      andSelector: #selector(handleGetURLEvent(_:withReplyEvent:)),
      forEventClass: AEEventClass(kInternetEventClass),
      andEventID: AEEventID(kAEGetURL)
    )

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
    applyWindowIcon()

    DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
      self.loadWebApp(scanPath: self.pendingScanPath)
    }
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    true
  }

  func applicationWillTerminate(_ notification: Notification) {
    serverProcess?.terminate()
  }

  func applicationDidBecomeActive(_ notification: Notification) {
    applyWindowIcon()
  }

  @objc private func handleGetURLEvent(_ event: NSAppleEventDescriptor, withReplyEvent replyEvent: NSAppleEventDescriptor) {
    guard
      let urlString = event.paramDescriptor(forKeyword: keyDirectObject)?.stringValue,
      let url = URL(string: urlString)
    else {
      return
    }

    pendingScanPath = scanPath(from: url)
    NSApp.activate(ignoringOtherApps: true)
    loadWebApp(scanPath: pendingScanPath)
  }

  private func loadWebApp(scanPath: String?) {
    guard var components = URLComponents(string: baseURLString) else {
      return
    }

    if let scanPath, !scanPath.isEmpty {
      components.queryItems = [URLQueryItem(name: "scanPath", value: scanPath)]
    }

    if let url = components.url {
      appendLog("loading \(url.absoluteString)")
      webView?.load(URLRequest(url: url))
    }
  }

  private func scanPath(from url: URL) -> String? {
    guard url.host == "scan" || url.path == "/scan" else {
      return nil
    }
    return URLComponents(url: url, resolvingAgainstBaseURL: false)?
      .queryItems?
      .first(where: { $0.name == "path" })?
      .value
  }

  private func commandLineScanPath() -> String? {
    let arguments = CommandLine.arguments
    guard let index = arguments.firstIndex(of: "--scan-path"), arguments.indices.contains(index + 1) else {
      return nil
    }
    appendLog("scan-path-arg \(arguments[index + 1])")
    return arguments[index + 1]
  }

  private func applyBundleIcon() {
    if let iconURL = Bundle.main.url(forResource: "CodeUniverse", withExtension: "icns"),
       let icon = NSImage(contentsOf: iconURL) {
      bundleIcon = icon
      NSApp.applicationIconImage = icon
      NSApp.dockTile.contentView = nil
      NSApp.dockTile.display()
      appendLog("applied-icon \(iconURL.path)")
    } else {
      appendLog("missing-icon-resource")
    }
  }

  private func applyWindowIcon() {
    guard let bundleIcon else {
      return
    }
    window?.miniwindowImage = bundleIcon
    NSApp.applicationIconImage = bundleIcon
    NSApp.dockTile.display()
  }

  private func appendLog(_ message: String) {
    let timestamp = ISO8601DateFormatter().string(from: Date())
    let line = "\(timestamp) \(message)\n"
    try? FileManager.default.createDirectory(at: logURL.deletingLastPathComponent(), withIntermediateDirectories: true)
    if let data = line.data(using: .utf8) {
      if FileManager.default.fileExists(atPath: logURL.path),
         let handle = try? FileHandle(forWritingTo: logURL) {
        _ = try? handle.seekToEnd()
        try? handle.write(contentsOf: data)
        try? handle.close()
      } else {
        try? data.write(to: logURL)
      }
    }
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
    if let configuredRoot = ProcessInfo.processInfo.environment["CODE_UNIVERSE_REPO_ROOT"],
       FileManager.default.fileExists(atPath: URL(fileURLWithPath: configuredRoot).appendingPathComponent("server.js").path) {
      return URL(fileURLWithPath: configuredRoot)
    }
    if let bundledRoot = Bundle.main.object(forInfoDictionaryKey: "CodeUniverseRepoRoot") as? String,
       FileManager.default.fileExists(atPath: URL(fileURLWithPath: bundledRoot).appendingPathComponent("server.js").path) {
      return URL(fileURLWithPath: bundledRoot)
    }
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
