import AppKit
import UniformTypeIdentifiers
import WebKit

final class WebFiles: NSObject, WKURLSchemeHandler {
  let root: URL
  init(root: URL) { self.root = root.resolvingSymlinksInPath() }
  func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
    guard let url = task.request.url, url.host == "app" else {
      task.didFailWithError(URLError(.badURL))
      return
    }
    let path = url.path == "/" ? "index.html" : String(url.path.dropFirst())
    let file = root.appendingPathComponent(path).standardizedFileURL.resolvingSymlinksInPath()
    guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file) else {
      task.didFailWithError(URLError(.fileDoesNotExist))
      return
    }
    let mime =
      [
        "html": "text/html", "js": "text/javascript", "css": "text/css", "svg": "image/svg+xml",
        "json": "application/json", "png": "image/png",
      ][file.pathExtension] ?? "application/octet-stream"
    task.didReceive(
      URLResponse(
        url: url, mimeType: mime, expectedContentLength: data.count, textEncodingName: "utf-8"))
    task.didReceive(data)
    task.didFinish()
  }
  func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKScriptMessageHandler,
  WKNavigationDelegate, WKUIDelegate
{
  private var window: NSWindow!
  private var web: WKWebView!
  private let engine = AudioEngine()
  private let smokeTest = CommandLine.arguments.contains("--smoke-test")
  private let audioCheck = CommandLine.arguments.contains("--audio-check")
  private var audioCheckFinished = false
  private var spectrumCheckFinished = false

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.setActivationPolicy(.regular)
    if let path = Bundle.main.path(forResource: "AppIcon", ofType: "icns") {
      NSApp.applicationIconImage = NSImage(contentsOfFile: path)
    }
    let menu = NSMenu()
    let appItem = NSMenuItem()
    menu.addItem(appItem)
    let appMenu = NSMenu()
    appItem.submenu = appMenu
    appMenu.addItem(
      withTitle: "关于 ToneBench", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)),
      keyEquivalent: "")
    appMenu.addItem(.separator())
    appMenu.addItem(
      withTitle: "退出 ToneBench", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    let editItem = NSMenuItem()
    menu.addItem(editItem)
    let editMenu = NSMenu(title: "编辑")
    editItem.submenu = editMenu
    for (title, selector, key) in [
      ("撤销", "undo:", "z"), ("剪切", "cut:", "x"), ("拷贝", "copy:", "c"), ("粘贴", "paste:", "v"),
      ("全选", "selectAll:", "a"),
    ] {
      editMenu.addItem(withTitle: title, action: Selector(selector), keyEquivalent: key)
    }
    NSApp.mainMenu = menu
    guard let resources = Bundle.main.resourceURL else {
      NSApp.terminate(nil)
      return
    }
    let configuration = WKWebViewConfiguration()
    if smokeTest || audioCheck { configuration.websiteDataStore = .nonPersistent() }
    configuration.setURLSchemeHandler(
      WebFiles(root: resources.appendingPathComponent("Web")), forURLScheme: "tonebench")
    configuration.userContentController.add(self, name: "tonebench")
    configuration.userContentController.addUserScript(
      WKUserScript(
        source: "window.__TONEBENCH_NATIVE__ = true;", injectionTime: .atDocumentStart,
        forMainFrameOnly: true))
    web = WKWebView(frame: .zero, configuration: configuration)
    web.navigationDelegate = self
    web.uiDelegate = self
    web.underPageBackgroundColor = NSColor(calibratedWhite: 0.08, alpha: 1)
    window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1380, height: 900),
      styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false
    )
    window.title = "ToneBench"
    window.minSize = NSSize(width: 1000, height: 680)
    window.backgroundColor = NSColor(calibratedWhite: 0.08, alpha: 1)
    window.appearance = NSAppearance(named: .darkAqua)
    window.contentView = web
    window.delegate = self
    window.center()
    window.makeKeyAndOrderFront(nil)
    engine.onChange = { [weak self] status in
      guard let data = try? JSONSerialization.data(withJSONObject: status),
        let json = String(data: data, encoding: .utf8)
      else { return }
      self?.web.evaluateJavaScript(
        "window.dispatchEvent(new CustomEvent('tonebench:audio', {detail: \(json)}));",
        completionHandler: nil)
      if self?.audioCheck == true { self?.recordAudioCheck(status) }
    }
    engine.onSpectrum = { [weak self] frame in
      let json: String
      if let frame, let data = try? JSONSerialization.data(withJSONObject: frame),
        let text = String(data: data, encoding: .utf8)
      { json = text } else { json = "null" }
      self?.web.evaluateJavaScript(
        "window.dispatchEvent(new CustomEvent('tonebench:spectrum', {detail: \(json)}));",
        completionHandler: nil)
      if self?.audioCheck == true, let frame { self?.recordSpectrumCheck(frame) }
    }
    web.load(URLRequest(url: URL(string: "tonebench://app/")!))
    NSApp.activate(ignoringOtherApps: true)
    if smokeTest {
      DispatchQueue.main.asyncAfter(deadline: .now() + 15) {
        let results = Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent()
          .appendingPathComponent("test-results")
        try? "Native WebKit smoke timed out".write(
          to: results.appendingPathComponent("native-timeout.txt"), atomically: true,
          encoding: .utf8)
        NSApp.terminate(nil)
      }
    }
  }
  func userContentController(
    _ userContentController: WKUserContentController, didReceive message: WKScriptMessage
  ) {
    guard message.frameInfo.isMainFrame, message.frameInfo.request.url?.scheme == "tonebench",
      message.frameInfo.request.url?.host == "app", let body = message.body as? [String: Any],
      let action = body["action"] as? String
    else { return }
    switch action {
    case "ready": engine.publish()
    case "stop": engine.stop()
    case "start", "update":
      guard let object = body["settings"], JSONSerialization.isValidJSONObject(object),
        let data = try? JSONSerialization.data(withJSONObject: object), data.count < 32768,
        let settings = try? JSONDecoder().decode(EQSettings.self, from: data)
      else { return }
      if action == "start" { engine.start(settings) } else { engine.update(settings) }
    case "export":
      guard let name = body["name"] as? String, let contents = body["contents"] as? String,
        name.count < 200, contents.utf8.count <= 1_000_000
      else { return }
      let panel = NSSavePanel()
      panel.nameFieldStringValue = URL(fileURLWithPath: name).lastPathComponent
      panel.allowedContentTypes = name.hasSuffix(".json") ? [.json] : [.plainText]
      panel.beginSheetModal(for: window) { result in
        guard result == .OK, let url = panel.url else { return }
        do { try contents.write(to: url, atomically: true, encoding: .utf8) } catch {
          let alert = NSAlert(error: error)
          alert.beginSheetModal(for: self.window)
        }
      }
    case "copy":
      guard let text = body["contents"] as? String, text.utf8.count < 1_000_000 else { return }
      NSPasteboard.general.clearContents()
      NSPasteboard.general.setString(text, forType: .string)
    default: break
    }
  }
  func webView(
    _ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    let local = action.request.url?.scheme == "tonebench" && action.request.url?.host == "app"
    if action.navigationType == .linkActivated, let url = action.request.url,
      ["https", "http"].contains(url.scheme ?? "")
    {
      NSWorkspace.shared.open(url)
    }
    // No remote page may navigate into the privileged native bridge.
    decisionHandler(local ? .allow : .cancel)
  }
  func webView(
    _ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
    initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void
  ) {
    let panel = NSOpenPanel()
    panel.canChooseDirectories = false
    panel.allowsMultipleSelection = false
    panel.beginSheetModal(for: window) { result in
      completionHandler(result == .OK ? panel.urls : nil)
    }
  }
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    engine.stop()
    webView.reload()
  }
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    if audioCheck {
      DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
        self.web.evaluateJavaScript(
          "[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '直接手动调音')?.click()"
        ) { _, _ in
          self.engine.start(EQSettings(bands: [], preamp: 0, bypass: true, autoPreamp: true))
        }
      }
    }
    guard smokeTest else { return }
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
      let script = """
        (() => {
          const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '直接手动调音');
          if (!button) throw new Error('React workbench did not render');
          button.click();
          return { title: document.querySelector('h1')?.textContent, native: window.__TONEBENCH_NATIVE__, uuid: typeof crypto.getRandomValues, body: document.body.innerText };
        })()
        """
      self.web.evaluateJavaScript(script) { result, error in
        let root = Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent()
          .appendingPathComponent("test-results")
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        var report: [String: Any] = [
          "initial": result ?? "", "error": error?.localizedDescription ?? "",
        ]
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
          self.web.evaluateJavaScript(
            "({rows: document.querySelectorAll('.eq-table tbody tr').length, audio: document.querySelector('.audio-strip')?.innerText, chart: document.querySelector('.chart-footer')?.innerText, font: getComputedStyle(document.querySelector('h1')).fontFamily})"
          ) { state, error in
            report["state"] = state ?? ""
            report["stateError"] = error?.localizedDescription ?? ""
            if let data = try? JSONSerialization.data(
              withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
            {
              try? data.write(to: root.appendingPathComponent("native-smoke.json"))
            }
            self.web.takeSnapshot(with: nil) { image, _ in
              if let tiff = image?.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
                let png = bitmap.representation(using: .png, properties: [:])
              {
                try? png.write(to: root.appendingPathComponent("native-mac.png"))
              }
              NSApp.terminate(nil)
            }
          }
        }
      }
    }
  }
  private func recordAudioCheck(_ status: [String: Any]) {
    guard !audioCheckFinished else { return }
    let root = Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent()
      .appendingPathComponent("test-results")
    try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    if let data = try? JSONSerialization.data(
      withJSONObject: status, options: [.prettyPrinted, .sortedKeys])
    {
      try? data.write(to: root.appendingPathComponent("native-audio-check.json"))
    }
    if let phase = status["phase"] as? String, ["running", "error"].contains(phase) {
      audioCheckFinished = true
      DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
        self.engine.stop()
        NSApp.terminate(nil)
      }
    }
  }
  private func recordSpectrumCheck(_ frame: [String: Any]) {
    guard !spectrumCheckFinished else { return }
    spectrumCheckFinished = true
    let root = Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent()
      .appendingPathComponent("test-results")
    try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    let levels = frame["after"] as? [Float] ?? []
    let report: [String: Any] = [
      "sampleRate": frame["sampleRate"] ?? 0, "fftSize": frame["fftSize"] ?? 0,
      "bins": levels.count, "maximumDBFS": levels.max() ?? -120,
      "finite": levels.allSatisfy { $0.isFinite },
    ]
    if let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) {
      try? data.write(to: root.appendingPathComponent("native-spectrum-check.json"))
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
      self.web.evaluateJavaScript(
        "document.querySelector('.spectrum-panel')?.scrollIntoView({block:'center'})"
      ) { _, _ in
        self.web.takeSnapshot(with: nil) { image, _ in
          if let tiff = image?.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
            let png = bitmap.representation(using: .png, properties: [:])
          { try? png.write(to: root.appendingPathComponent("native-spectrum.png")) }
        }
      }
    }
  }
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    engine.stop()
  }
  func applicationWillTerminate(_ notification: Notification) { engine.stop() }
  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
  func windowWillClose(_ notification: Notification) { engine.stop() }
}

let delegate = AppDelegate()
let app = NSApplication.shared
app.delegate = delegate
app.run()
