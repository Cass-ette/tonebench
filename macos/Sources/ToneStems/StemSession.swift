import AVFoundation
import Foundation

public struct StemLevel {
  public var gain: Double = 0
  public var muted = false
  public var solo = false
  public init(gain: Double = 0, muted: Bool = false, solo: Bool = false) {
    self.gain = gain
    self.muted = muted
    self.solo = solo
  }
}

public enum StemMix {
  public static let ids = ["vocals", "drums", "bass", "guitar", "piano", "other"]
  public static func amplitudes(_ levels: [String: StemLevel]) -> [String: Double] {
    let solo = levels.values.contains { $0.solo }
    return Dictionary(
      uniqueKeysWithValues: ids.map { id in
        let level = levels[id] ?? StemLevel()
        let active = !level.muted && (!solo || level.solo)
        let gain = level.gain.isFinite ? min(6, max(-24, level.gain)) : 0
        return (id, active ? pow(10, gain / 20) : 0)
      })
  }
  // A conservative peak bound prevents clipping even with boosts and solo.
  // The same attenuation applies to original and stems for A/B comparison.
  public static func headroom(
    peaks: [String: Double], amplitudes: [String: Double], original: Double
  ) -> Double {
    let bound = ids.reduce(0.0) { $0 + (peaks[$1] ?? 0) * (amplitudes[$1] ?? 0) }
    let largestGain = amplitudes.values.max() ?? 1
    return 0.89 / max(1, max(largestGain, max(original, bound)))
  }
}

public final class StemSession {
  public var onChange: (([String: Any]) -> Void)?
  private let resources: URL
  private let outputRoot: URL
  private var phase = "idle"
  private var message = ""
  private var progress = 0.0
  private var fileName = ""
  private var folder: URL?
  private var process: Process?
  private var timer: Timer?
  private var audio: AVAudioEngine?
  private var routeObserver: NSObjectProtocol?
  private var players: [String: AVAudioPlayerNode] = [:]
  private var files: [String: AVAudioFile] = [:]
  private var peaks: [String: Double] = [:]
  private var originalPeak = 0.0
  private var levels: [String: StemLevel] = [:]
  private var original = false
  private var playing = false
  private var sampleRate = 44100.0
  private var duration = 0.0
  private var position = 0.0
  private var startedAt: Double = 0
  private var attenuation = 1.0
  private var runtime: [String: String] {
    guard let data = try? Data(contentsOf: resources.appendingPathComponent("runtime.json")),
      let value = try? JSONDecoder().decode([String: String].self, from: data)
    else { return [:] }
    return value
  }
  public var available: Bool {
    let config = runtime
    return ["python", "ffmpeg"].allSatisfy {
      FileManager.default.isExecutableFile(atPath: config[$0] ?? "")
    }
      && FileManager.default.fileExists(atPath: (config["models"] ?? "") + "/5c90dfd2-34c22ccb.th")
  }
  public var busy: Bool { process != nil }
  public var outputFolder: URL? { phase == "ready" ? folder : nil }
  public init(resources: URL, outputRoot: URL? = nil) {
    self.resources = resources
    self.outputRoot =
      outputRoot
      ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("app.tonebench.mac/Separation")
  }

  public func publish() {
    let controls: [[String: Any]] = StemMix.ids.map { id in
      let l = levels[id] ?? StemLevel()
      return ["id": id, "gain": l.gain, "muted": l.muted, "solo": l.solo]
    }
    onChange?([
      "available": available, "phase": phase, "message": message,
      "progress": progress, "fileName": fileName, "duration": duration,
      "position": currentPosition, "playing": playing, "original": original,
      "headroom": 20 * log10(max(attenuation, 1e-8)), "stems": controls,
    ])
  }
  private var currentPosition: Double {
    min(
      duration, max(0, position + (playing ? ProcessInfo.processInfo.systemUptime - startedAt : 0)))
  }

  public func load(_ input: URL, preview: Bool) {
    guard !busy, available else {
      publish()
      return
    }
    stopPlayback()
    files.removeAll()
    levels.removeAll()
    peaks.removeAll()
    duration = 0
    position = 0
    original = false
    attenuation = 1
    fileName = input.lastPathComponent
    phase = "decoding"
    progress = 0
    message = "正在读取音频"
    let output = outputRoot.appendingPathComponent(UUID().uuidString)
    folder = output
    let worker = Process()
    let pipe = Pipe()
    let config = runtime
    worker.executableURL = URL(fileURLWithPath: config["python"]!)
    worker.arguments =
      [
        resources.appendingPathComponent("worker.py").path,
        "--input", input.path, "--output", output.path,
        "--models", config["models"]!, "--ffmpeg", config["ffmpeg"]!,
      ]
      + (preview ? ["--preview"] : [])
    worker.standardOutput = pipe
    worker.standardError = FileHandle.nullDevice
    var environment = ProcessInfo.processInfo.environment
    environment["PYTHONUNBUFFERED"] = "1"
    environment["PYTHONNOUSERSITE"] = "1"
    environment["OMP_NUM_THREADS"] = "6"
    worker.environment = environment
    do {
      try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
      process = worker
      try worker.run()
      publish()
      DispatchQueue.global(qos: .userInitiated).async { [weak self] in
        var buffer = Data()
        while true {
          let chunk = pipe.fileHandleForReading.availableData
          if chunk.isEmpty { break }
          buffer.append(chunk)
          while let newline = buffer.firstIndex(of: 10) {
            let line = Data(buffer[..<newline])
            buffer.removeSubrange(...newline)
            guard let object = try? JSONSerialization.jsonObject(with: line) as? [String: Any]
            else { continue }
            DispatchQueue.main.async { self?.receive(object, from: worker) }
          }
        }
        worker.waitUntilExit()
        DispatchQueue.main.async { self?.finished(worker, output: output) }
      }
    } catch {
      process = nil
      phase = "error"
      message = "无法启动本地分离环境，请重新安装后构建应用"
      try? FileManager.default.removeItem(at: output)
      publish()
    }
  }
  private func receive(_ event: [String: Any], from worker: Process) {
    guard process === worker, phase != "cancelling" else { return }
    if let value = event["phase"] as? String,
      ["decoding", "loading", "separating", "writing", "error"].contains(value)
    {
      phase = value
    }
    if let value = event["progress"] as? Double, value.isFinite { progress = min(1, max(0, value)) }
    if let value = event["message"] as? String { message = String(value.prefix(300)) }
    publish()
  }
  private func finished(_ worker: Process, output: URL) {
    guard process === worker else { return }
    process = nil
    if phase == "cancelling" {
      try? FileManager.default.removeItem(at: output)
      phase = "idle"
      message = "已取消"
      progress = 0
      folder = nil
    } else if worker.terminationStatus == 0 {
      do {
        try prepare(output)
        phase = "ready"
        message = "分离完成"
        progress = 1
      } catch {
        phase = "error"
        message = "分离文件不完整，请重新导入"
      }
    } else if phase != "error" {
      phase = "error"
      message = "分离未完成，请检查文件和本地运行环境"
    }
    if phase == "error" {
      try? FileManager.default.removeItem(at: output)
      folder = nil
    }
    publish()
  }
  private func prepare(_ output: URL) throws {
    struct Manifest: Decodable {
      struct Stem: Decodable {
        let id: String
        let peak: Double
      }
      let duration: Double
      let model: String
      let sampleRate: Double
      let frames: Int64
      let originalPeak: Double
      let stems: [Stem]
    }
    let manifest = try JSONDecoder().decode(
      Manifest.self, from: Data(contentsOf: output.appendingPathComponent("manifest.json")))
    guard manifest.model == "htdemucs_6s",
      manifest.duration.isFinite, manifest.duration > 0, manifest.duration <= 600.001,
      manifest.sampleRate == 44100, manifest.originalPeak.isFinite, manifest.originalPeak >= 0,
      Set(manifest.stems.map { $0.id }) == Set(StemMix.ids),
      manifest.stems.count == StemMix.ids.count,
      manifest.stems.allSatisfy({ $0.peak.isFinite && $0.peak >= 0 })
    else { throw URLError(.cannotDecodeContentData) }
    sampleRate = manifest.sampleRate
    duration = manifest.duration
    originalPeak = manifest.originalPeak
    peaks = Dictionary(uniqueKeysWithValues: manifest.stems.map { ($0.id, $0.peak) })
    for id in StemMix.ids + ["original"] {
      let file = try AVAudioFile(forReading: output.appendingPathComponent(id + ".wav"))
      guard file.length == manifest.frames, file.processingFormat.sampleRate == sampleRate,
        file.processingFormat.channelCount == 2
      else { throw URLError(.cannotDecodeContentData) }
      files[id] = file
    }
    for id in StemMix.ids { levels[id] = StemLevel() }
    try configurePlayback()
  }
  private func configurePlayback() throws {
    if let observer = routeObserver { NotificationCenter.default.removeObserver(observer) }
    audio?.stop()
    players.removeAll()
    let engine = AVAudioEngine()
    for (id, file) in files {
      let player = AVAudioPlayerNode()
      engine.attach(player)
      engine.connect(player, to: engine.mainMixerNode, format: file.processingFormat)
      players[id] = player
    }
    audio = engine
    routeObserver = NotificationCenter.default.addObserver(
      forName: .AVAudioEngineConfigurationChange,
      object: engine, queue: .main
    ) { [weak self] _ in
      self?.pause()
      self?.message = "输出设备已变化，点击播放继续试听"
      self?.publish()
    }
    updateVolumes()
  }
  private func updateVolumes() {
    let amplitudes = StemMix.amplitudes(levels)
    attenuation = StemMix.headroom(peaks: peaks, amplitudes: amplitudes, original: originalPeak)
    for id in StemMix.ids {
      players[id]?.volume = original ? 0 : Float((amplitudes[id] ?? 0) * attenuation)
    }
    players["original"]?.volume = original ? Float(attenuation) : 0
  }
  public func controls(_ rows: [[String: Any]], original: Bool) {
    guard phase == "ready", rows.count == StemMix.ids.count else { return }
    var next: [String: StemLevel] = [:]
    for row in rows {
      guard let id = row["id"] as? String, StemMix.ids.contains(id), next[id] == nil,
        let gain = row["gain"] as? Double, gain.isFinite, (-24...6).contains(gain),
        let muted = row["muted"] as? Bool, let solo = row["solo"] as? Bool
      else { return }
      next[id] = StemLevel(gain: gain, muted: muted, solo: solo)
    }
    levels = next
    self.original = original
    updateVolumes()
    publish()
  }
  public func togglePlayback() {
    guard phase == "ready" else { return }
    if playing { pause() } else { play() }
    publish()
  }
  private func play() {
    guard let engine = audio else { return }
    if position >= duration - 0.01 { position = 0 }
    let frame = AVAudioFramePosition(position * sampleRate)
    do {
      try engine.start()
      message = "分离完成"
      for (id, player) in players {
        guard let file = files[id], file.length > frame else { continue }
        player.stop()
        player.scheduleSegment(
          file, startingFrame: frame, frameCount: AVAudioFrameCount(file.length - frame), at: nil)
      }
      let time = AVAudioTime(hostTime: mach_absolute_time() + AVAudioTime.hostTime(forSeconds: 0.1))
      for player in players.values { player.play(at: time) }
      startedAt = ProcessInfo.processInfo.systemUptime + 0.1
      playing = true
      timer?.invalidate()
      timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
        guard let self else { return }
        if self.currentPosition >= self.duration {
          self.pause()
          self.position = self.duration
        }
        self.publish()
      }
    } catch {
      playing = false
      message = "无法打开音频输出设备，请检查系统声音设置"
    }
  }
  private func pause() {
    position = currentPosition
    playing = false
    players.values.forEach { $0.stop() }
    audio?.pause()
    timer?.invalidate()
    timer = nil
  }
  public func seek(_ seconds: Double) {
    guard phase == "ready", seconds.isFinite else { return }
    let resume = playing
    pause()
    position = min(duration, max(0, seconds))
    if resume { play() }
    publish()
  }
  public func cancel() {
    guard let worker = process, worker.isRunning else { return }
    phase = "cancelling"
    message = "正在取消"
    worker.terminate()
    publish()
  }
  private func stopPlayback() {
    if let observer = routeObserver {
      NotificationCenter.default.removeObserver(observer)
      routeObserver = nil
    }
    pause()
    audio?.stop()
    audio = nil
    players.removeAll()
  }
  public func close() {
    cancel()
    stopPlayback()
  }
}
