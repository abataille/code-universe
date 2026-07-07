import AppKit
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
  private var window: NSWindow?
  private var webView: WKWebView?
  private var serverProcess: Process?
  private var baseURLString = ProcessInfo.processInfo.environment["CODE_UNIVERSE_URL"] ?? "http://127.0.0.1:4174"
  private var pendingScanPath: String?
  private var loadAttempt = 0
  private var lastRequestedScanPath: String?
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
    webView.navigationDelegate = self
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

    loadWebAppWhenReady(scanPath: pendingScanPath)
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
    loadWebAppWhenReady(scanPath: pendingScanPath)
  }

  private func loadWebAppWhenReady(scanPath: String?) {
    lastRequestedScanPath = scanPath
    loadAttempt = 0
    waitForServerAndLoad(scanPath: scanPath)
  }

  private func waitForServerAndLoad(scanPath: String?) {
    loadAttempt += 1
    let attempt = loadAttempt
    appendLog("server-ready-check attempt=\(attempt)")

    probeServer { isReady in
      DispatchQueue.main.async {
        guard attempt == self.loadAttempt else {
          return
        }

        if isReady {
          self.appendLog("server-ready attempt=\(attempt)")
          self.loadWebApp(scanPath: scanPath)
          return
        }

        if attempt < 60 {
          let delay = min(0.25 + Double(attempt) * 0.08, 1.5)
          self.appendLog("server-not-ready retry-in=\(String(format: "%.2f", delay))")
          DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
            self.waitForServerAndLoad(scanPath: scanPath)
          }
        } else {
          self.appendLog("server-not-ready giving-up")
          self.showLoadingError("Code Universe server did not become ready. Check ~/Library/Logs/CodeUniverseMac.log.")
        }
      }
    }
  }

  private func probeServer(completion: @escaping (Bool) -> Void) {
    guard var components = URLComponents(string: baseURLString) else {
      completion(false)
      return
    }
    components.path = "/api/health"
    components.queryItems = nil
    guard let url = components.url else {
      completion(false)
      return
    }

    probeURL(url) { isHealthy in
      if isHealthy {
        completion(true)
        return
      }

      guard let rootURL = URL(string: self.baseURLString) else {
        completion(false)
        return
      }
      self.probeURL(rootURL, completion: completion)
    }
  }

  private func probeURL(_ url: URL, completion: @escaping (Bool) -> Void) {
    var request = URLRequest(url: url)
    request.timeoutInterval = 1.0
    URLSession.shared.dataTask(with: request) { _, response, error in
      if let error {
        self.appendLog("server-probe-error \(error.localizedDescription)")
      }
      let status = (response as? HTTPURLResponse)?.statusCode ?? 0
      completion((200..<300).contains(status))
    }.resume()
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

  private func showLoadingError(_ message: String) {
    let escapedMessage = message
      .replacingOccurrences(of: "&", with: "&amp;")
      .replacingOccurrences(of: "<", with: "&lt;")
      .replacingOccurrences(of: ">", with: "&gt;")
    let html = """
    <!doctype html>
    <html>
    <body style="margin:0;background:#071018;color:#d9eef8;font:15px -apple-system,BlinkMacSystemFont,sans-serif;display:grid;min-height:100vh;place-items:center;">
      <main style="max-width:560px;padding:28px;border:1px solid rgba(99,210,255,.25);border-radius:20px;background:rgba(255,255,255,.05);">
        <h1 style="margin-top:0;">Code Universe is still starting</h1>
        <p>\(escapedMessage)</p>
      </main>
    </body>
    </html>
    """
    webView?.loadHTMLString(html, baseURL: nil)
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
    environment["PATH"] = [
      environment["PATH"],
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin"
    ]
      .compactMap { $0 }
      .joined(separator: ":")
    process.environment = environment
    let outputPipe = Pipe()
    let errorPipe = Pipe()
    process.standardOutput = outputPipe
    process.standardError = errorPipe
    captureProcessOutput(outputPipe, prefix: "server-out")
    captureProcessOutput(errorPipe, prefix: "server-err")

    do {
      try process.run()
      serverProcess = process
      appendLog("server-started pid=\(process.processIdentifier) root=\(repoRoot.path)")
    } catch {
      serverProcess = nil
      appendLog("server-start-failed \(error.localizedDescription)")
    }
  }

  private func captureProcessOutput(_ pipe: Pipe, prefix: String) {
    pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
      let data = handle.availableData
      guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else {
        return
      }
      text
        .split(separator: "\n", omittingEmptySubsequences: true)
        .forEach { self?.appendLog("\(prefix) \($0)") }
    }
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    appendLog("webview-provisional-fail \(error.localizedDescription)")
    retryWebLoadAfterNavigationFailure()
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    appendLog("webview-navigation-fail \(error.localizedDescription)")
    retryWebLoadAfterNavigationFailure()
  }

  private func retryWebLoadAfterNavigationFailure() {
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
      self.loadWebAppWhenReady(scanPath: self.lastRequestedScanPath)
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
