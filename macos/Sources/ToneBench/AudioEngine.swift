import AppKit
import CoreAudio
import ToneDSP

struct EQBand: Decodable {
  let enabled: Bool
  let kind: String
  let frequency: Double
  let gain: Double
  let q: Double

  var native: TBBand? {
    guard let type = ["PK": 0, "LSC": 1, "HSC": 2][kind],
      frequency.isFinite, (20...20000).contains(frequency),
      gain.isFinite, (-18...12).contains(gain), q.isFinite, (0.25...10).contains(q)
    else { return nil }
    return TBBand(kind: Int32(type), enabled: enabled, frequency: frequency, gain: gain, q: q)
  }
}
struct EQSettings: Decodable {
  let bands: [EQBand]
  let preamp: Double
  let bypass: Bool
  let autoPreamp: Bool

  func validated() throws -> [TBBand] {
    let native = bands.compactMap(\.native)
    guard bands.count <= 12, native.count == bands.count,
      preamp.isFinite, (-180...0).contains(preamp)
    else { throw AudioError("EQ 参数超出范围。") }
    return native
  }
}
struct AudioError: LocalizedError {
  let message: String
  init(_ message: String) { self.message = message }
  var errorDescription: String? { message }
}
private func checked(_ status: OSStatus, _ action: String) throws {
  guard status == noErr else { throw AudioError("\(action)失败（\(status)）。请检查系统音频录制权限及输出设备。") }
}
private func address(
  _ selector: AudioObjectPropertySelector,
  _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal
) -> AudioObjectPropertyAddress {
  AudioObjectPropertyAddress(
    mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain)
}
private func scalar<T>(
  _ id: AudioObjectID, _ selector: AudioObjectPropertySelector,
  _ initial: T, scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal
) throws -> T {
  var addr = address(selector, scope)
  var value = initial
  var size = UInt32(MemoryLayout<T>.size)
  try withUnsafeMutablePointer(to: &value) { pointer in
    try checked(AudioObjectGetPropertyData(id, &addr, 0, nil, &size, pointer), "读取音频设备")
  }
  return value
}
private func string(_ id: AudioObjectID, _ selector: AudioObjectPropertySelector) throws -> String {
  var addr = address(selector)
  var value: Unmanaged<CFString>?
  var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
  try checked(AudioObjectGetPropertyData(id, &addr, 0, nil, &size, &value), "读取设备名称")
  guard let value else { throw AudioError("设备名称为空。") }
  return value.takeRetainedValue() as String
}
private func streams(_ id: AudioObjectID, _ scope: AudioObjectPropertyScope) throws
  -> [AudioStreamID]
{
  var addr = address(kAudioDevicePropertyStreams, scope)
  var size: UInt32 = 0
  try checked(AudioObjectGetPropertyDataSize(id, &addr, 0, nil, &size), "读取音频通道")
  var result = [AudioStreamID](repeating: 0, count: Int(size) / MemoryLayout<AudioStreamID>.size)
  try result.withUnsafeMutableBytes { bytes in
    if let base = bytes.baseAddress {
      try checked(AudioObjectGetPropertyData(id, &addr, 0, nil, &size, base), "读取音频通道")
    }
  }
  return result
}
private func validateFormat(_ format: AudioStreamBasicDescription, _ rate: Double) throws {
  guard format.mFormatID == kAudioFormatLinearPCM,
    format.mFormatFlags & kAudioFormatFlagIsFloat != 0,
    format.mFormatFlags & kAudioFormatFlagIsBigEndian == 0,
    format.mBitsPerChannel == 32, format.mChannelsPerFrame == 2,
    abs(format.mSampleRate - rate) < 1,
    format.mBytesPerFrame == (format.mFormatFlags & kAudioFormatFlagIsNonInterleaved != 0 ? 4 : 8)
  else {
    throw AudioError("当前输出格式暂不支持。请使用 32–192 kHz 的双声道输出。")
  }
}

// Control operations stay on the main thread. The HAL callback is entirely C,
// with preallocated state and an atomic, single-producer/single-consumer queue.
final class AudioEngine {
  var onChange: (([String: Any]) -> Void)?
  var onSpectrum: (([String: Any]?) -> Void)?
  private let analysisQueue = DispatchQueue(label: "app.tonebench.spectrum", qos: .utility)
  private var spectrumTimer: DispatchSourceTimer?
  private var spectrumSession = UUID()
  private var tap: AudioObjectID = 0
  private var aggregate: AudioObjectID = 0
  private var output: AudioObjectID = 0
  private var io: AudioDeviceIOProcID?
  private var dsp: OpaquePointer?
  private var timer: Timer?
  private var listeners:
    [(AudioObjectID, AudioObjectPropertyAddress, AudioObjectPropertyListenerBlock)] = []
  private var sleepObserver: NSObjectProtocol?
  private var pending: EQSettings?
  private var startedAt = Date()
  private var callbackCount: UInt64 = 0
  private var phase = "stopped"
  private var message = ""
  private var outputName = ""
  private var rate = 48000.0
  private var clipped: UInt64 = 0

  init() {
    sleepObserver = NSWorkspace.shared.notificationCenter.addObserver(
      forName: NSWorkspace.willSleepNotification, object: nil, queue: .main
    ) { [weak self] _ in
      self?.stop(message: "Mac 已休眠，系统 EQ 已停止。")
    }
  }
  func publish() {
    if aggregate == 0 {
      if let device = try? scalar(
        AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyDefaultOutputDevice,
        AudioObjectID(0)), device != 0
      {
        outputName = (try? string(device, kAudioObjectPropertyName)) ?? ""
        rate = (try? scalar(device, kAudioDevicePropertyNominalSampleRate, 48000.0)) ?? 48000
      }
    }
    onChange?([
      "phase": phase, "message": message, "outputDevice": outputName,
      "sampleRate": rate, "clipped": clipped, "api": "Core Audio Tap",
    ])
  }
  func start(_ settings: EQSettings) {
    guard aggregate == 0 else {
      update(settings)
      return
    }
    phase = "starting"
    message = "等待系统音频权限与设备响应"
    publish()
    do {
      _ = try settings.validated()
      output = try scalar(
        AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyDefaultOutputDevice,
        AudioObjectID(0))
      guard output != 0 else { throw AudioError("未找到输出设备。") }
      let outputUID = try string(output, kAudioDevicePropertyDeviceUID)
      outputName = try string(output, kAudioObjectPropertyName)
      rate = try scalar(output, kAudioDevicePropertyNominalSampleRate, 48000.0)
      guard (32000...192000).contains(rate) else { throw AudioError("暂支持 32–192 kHz 输出。") }
      let deviceStreams = try streams(output, kAudioObjectPropertyScopeOutput)
      guard deviceStreams.count == 1 else { throw AudioError("首版支持单一双声道输出；当前设备有多个输出流。") }
      let hardwareFormat = try scalar(
        deviceStreams[0], kAudioStreamPropertyVirtualFormat, AudioStreamBasicDescription())
      try validateFormat(hardwareFormat, rate)

      // The tap remains unmuted until this app's HAL process object can
      // be resolved and excluded. No audio starts during construction.
      let description = CATapDescription(
        __excludingProcesses: [], andDeviceUID: outputUID, withStream: 0)
      description.name = "ToneBench System EQ"
      description.isPrivate = true
      description.muteBehavior = .unmuted
      try checked(AudioHardwareCreateProcessTap(description, &tap), "创建系统音频 Tap")
      let format = try scalar(tap, kAudioTapPropertyFormat, AudioStreamBasicDescription())
      try validateFormat(format, rate)
      let tapUID = try string(tap, kAudioTapPropertyUID)
      let composition: [String: Any] = [
        kAudioAggregateDeviceNameKey: "ToneBench Audio",
        kAudioAggregateDeviceUIDKey: "app.tonebench.audio.\(UUID().uuidString)",
        kAudioAggregateDeviceIsPrivateKey: true,
        kAudioAggregateDeviceMainSubDeviceKey: outputUID,
        kAudioAggregateDeviceSubDeviceListKey: [
          [
            kAudioSubDeviceUIDKey: outputUID,
            kAudioSubDeviceInputChannelsKey: 0,
            kAudioSubDeviceOutputChannelsKey: 2,
          ]
        ],
        kAudioAggregateDeviceTapListKey: [
          [kAudioSubTapUIDKey: tapUID, kAudioSubTapDriftCompensationKey: true]
        ],
        // Do not block AudioDeviceStart until another app plays.
        kAudioAggregateDeviceTapAutoStartKey: false,
      ]
      try checked(
        AudioHardwareCreateAggregateDevice(composition as CFDictionary, &aggregate), "创建音频处理设备")
      // Avoid implicitly capturing physical microphone inputs.
      let inputs = try streams(aggregate, kAudioObjectPropertyScopeInput)
      let outputs = try streams(aggregate, kAudioObjectPropertyScopeOutput)
      guard inputs.count == 1, outputs.count == 1 else {
        throw AudioError("当前设备通道布局暂不支持，系统 EQ 未开启。")
      }
      for stream in inputs + outputs {
        try validateFormat(
          try scalar(stream, kAudioStreamPropertyVirtualFormat, AudioStreamBasicDescription()), rate
        )
      }
      guard let processor = tb_create(rate) else { throw AudioError("无法创建 EQ 引擎。") }
      dsp = processor
      try checked(
        AudioDeviceCreateIOProcID(aggregate, tb_io_proc, UnsafeMutableRawPointer(processor), &io),
        "注册音频处理")
      var pid = getpid()
      var selfID: AudioObjectID = 0
      var pidAddress = address(kAudioHardwarePropertyTranslatePIDToProcessObject)
      var processSize = UInt32(MemoryLayout<AudioObjectID>.size)
      try checked(
        AudioObjectGetPropertyData(
          AudioObjectID(kAudioObjectSystemObject), &pidAddress,
          UInt32(MemoryLayout<pid_t>.size), &pid, &processSize, &selfID), "识别音频进程")
      guard selfID != kAudioObjectUnknown else { throw AudioError("无法排除自身音频进程，系统 EQ 未开启。") }
      description.__processes = [NSNumber(value: selfID)]
      description.muteBehavior = .mutedWhenTapped
      var tapAddress = address(kAudioTapPropertyDescription)
      var object = Unmanaged.passUnretained(description)
      try checked(
        AudioObjectSetPropertyData(
          tap, &tapAddress, 0, nil,
          UInt32(MemoryLayout<Unmanaged<CATapDescription>>.size), &object), "设置音频隔离")
      pending = settings
      try submit()
      try installListeners()
      startedAt = Date()
      callbackCount = 0
      clipped = 0
      try checked(AudioDeviceStart(aggregate, io), "开启系统音频")
      startSpectrum(processor, sampleRate: rate)
      timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
        self?.poll()
      }
      publish()
    } catch { fail(error.localizedDescription) }
  }
  func update(_ settings: EQSettings) {
    do {
      _ = try settings.validated()
      pending = settings
      try submit()
    } catch { fail(error.localizedDescription) }
  }
  private func submit() throws {
    guard let dsp, let settings = pending else { return }
    var bands = try settings.validated()
    let preamp =
      settings.autoPreamp ? tb_headroom(&bands, UInt32(bands.count), rate) : settings.preamp
    if tb_update(dsp, &bands, UInt32(bands.count), preamp, settings.bypass) { pending = nil }
  }
  private func poll() {
    guard let dsp else { return }
    do { try submit() } catch {
      fail(error.localizedDescription)
      return
    }
    let count = tb_callbacks(dsp)
    if tb_faults(dsp) > 0 {
      fail("音频格式或处理异常，系统 EQ 已停止。")
      return
    }
    if count == callbackCount && Date().timeIntervalSince(startedAt) > 3 {
      fail("未收到系统音频。请在系统设置 → 隐私与安全性中允许 ToneBench 录制系统音频，然后重试。")
      return
    }
    if count > 0 {
      phase = "running"
      message = ""
    }
    if count != callbackCount { startedAt = Date() }
    callbackCount = count
    clipped = tb_clipped(dsp)
    publish()
  }
  private func startSpectrum(_ processor: OpaquePointer, sampleRate: Double) {
    let session = UUID()
    spectrumSession = session
    let fftSize = tb_spectrum_fft_size(processor)
    var frequencies = [Float](repeating: 0, count: Int(TB_SPECTRUM_BINS))
    var before = frequencies
    var after = frequencies
    var lastFrame = Date()
    var cleared = false
    let source = DispatchSource.makeTimerSource(queue: analysisQueue)
    source.schedule(deadline: .now(), repeating: .milliseconds(50), leeway: .milliseconds(5))
    source.setEventHandler { [weak self] in
      if tb_read_spectrum(processor, &frequencies, &before, &after) {
        lastFrame = Date()
        cleared = false
        let data: [String: Any] = [
          "frequencies": frequencies, "before": before, "after": after,
          "sampleRate": sampleRate, "fftSize": fftSize,
        ]
        DispatchQueue.main.async { [weak self] in
          guard let self, self.spectrumSession == session else { return }
          self.onSpectrum?(data)
        }
      } else if !cleared && Date().timeIntervalSince(lastFrame) > 0.5 {
        cleared = true
        DispatchQueue.main.async { [weak self] in
          guard let self, self.spectrumSession == session else { return }
          self.onSpectrum?(nil)
        }
      }
    }
    spectrumTimer = source
    source.resume()
  }
  private func installListeners() throws {
    let watch: [(AudioObjectID, AudioObjectPropertySelector)] = [
      (AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyDefaultOutputDevice),
      (output, kAudioDevicePropertyDeviceIsAlive),
      (output, kAudioDevicePropertyNominalSampleRate),
      (output, kAudioDevicePropertyStreamConfiguration),
      (aggregate, kAudioDevicePropertyIOStoppedAbnormally),
    ]
    for (id, selector) in watch {
      var addr = address(
        selector,
        selector == kAudioDevicePropertyStreamConfiguration
          ? kAudioObjectPropertyScopeOutput : kAudioObjectPropertyScopeGlobal)
      let block: AudioObjectPropertyListenerBlock = { [weak self] _, _ in
        self?.stop(message: "输出设备或格式已更改，请重新开启系统 EQ。")
      }
      try checked(AudioObjectAddPropertyListenerBlock(id, &addr, .main, block), "监听输出设备变化")
      listeners.append((id, addr, block))
    }
  }
  private func fail(_ error: String) {
    stop()
    phase = "error"
    message = error
    publish()
  }
  func stop(message: String = "") {
    spectrumSession = UUID()
    spectrumTimer?.cancel()
    spectrumTimer = nil
    // Finish the single analysis consumer before freeing its processor.
    analysisQueue.sync {}
    onSpectrum?(nil)
    timer?.invalidate()
    timer = nil
    for (id, var addr, block) in listeners {
      AudioObjectRemovePropertyListenerBlock(id, &addr, .main, block)
    }
    listeners.removeAll()
    if aggregate != 0, let io {
      AudioDeviceStop(aggregate, io)
      AudioDeviceDestroyIOProcID(aggregate, io)
    }
    io = nil
    if aggregate != 0 {
      AudioHardwareDestroyAggregateDevice(aggregate)
      aggregate = 0
    }
    if tap != 0 {
      AudioHardwareDestroyProcessTap(tap)
      tap = 0
    }
    if let dsp { tb_destroy(dsp) }
    dsp = nil
    pending = nil
    phase = "stopped"
    self.message = message
    publish()
  }
}
