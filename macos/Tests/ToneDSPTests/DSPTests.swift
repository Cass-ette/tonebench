import CoreAudio
import ToneDSP
import XCTest

final class DSPTests: XCTestCase {
  private func render(
    rate: Double, bands: [TBBand], frequency: Double, preamp: Double = 0,
    bypass: Bool = false
  ) -> (Double, Double) {
    let processor = tb_create(rate)!
    defer { tb_destroy(processor) }
    var filters = bands
    XCTAssertTrue(tb_update(processor, &filters, UInt32(filters.count), preamp, bypass))
    let count = Int(rate)
    let amplitude = 0.01
    let left = (0..<count).map { Float(amplitude * sin(2 * .pi * frequency * Double($0) / rate)) }
    let right = left.map { -$0 * 0.5 }
    var outLeft = [Float](repeating: 0, count: count)
    var outRight = outLeft
    tb_process(processor, left, right, &outLeft, &outRight, UInt32(count))
    let range = (count / 2)..<count
    let inputPower = range.reduce(0.0) { $0 + Double(left[$1] * left[$1]) }
    let power = range.reduce(0.0) { $0 + Double(outLeft[$1] * outLeft[$1]) }
    let rightPower = range.reduce(0.0) { $0 + Double(outRight[$1] * outRight[$1]) }
    XCTAssertEqual(tb_faults(processor), 0)
    XCTAssertEqual(tb_clipped(processor), 0)
    return (10 * log10(power / inputPower), 10 * log10(rightPower / power))
  }
  private func band(_ kind: Int32 = 0, frequency: Double = 1000, gain: Double = 6) -> TBBand {
    TBBand(kind: kind, enabled: true, frequency: frequency, gain: gain, q: 1)
  }
  func testPeakGainAndStereoAtDeviceRates() {
    for rate in [44100.0, 48000, 96000, 192000] {
      let result = render(rate: rate, bands: [band()], frequency: 1000)
      XCTAssertEqual(result.0, 6, accuracy: 0.002)
      XCTAssertEqual(result.1, -6.0206, accuracy: 0.002)
    }
  }
  func testShelvesCascadeDisabledAndMatchedBypass() {
    XCTAssertEqual(render(rate: 48000, bands: [band(1)], frequency: 20).0, 6, accuracy: 0.01)
    XCTAssertEqual(render(rate: 48000, bands: [band(2)], frequency: 20000).0, 6, accuracy: 0.01)
    XCTAssertEqual(
      render(rate: 48000, bands: [band(), band()], frequency: 1000, preamp: -12.5).0, -0.5,
      accuracy: 0.002)
    XCTAssertEqual(
      render(rate: 48000, bands: [band()], frequency: 1000, preamp: -6.5, bypass: true).0, -6.5,
      accuracy: 0.002)
    var disabled = band()
    disabled.enabled = false
    XCTAssertEqual(render(rate: 48000, bands: [disabled], frequency: 1000).0, 0, accuracy: 0.002)
  }
  func testHeadroomAndValidation() {
    for rate in [44100.0, 48000, 96000] {
      var bands = [band(), band()]
      XCTAssertEqual(tb_headroom(&bands, 2, rate), -12.5, accuracy: 0.1)
    }
    let p = tb_create(48000)!
    defer { tb_destroy(p) }
    var invalid = band()
    invalid.q = .nan
    XCTAssertFalse(tb_update(p, &invalid, 1, 0, false))
    XCTAssertFalse(tb_update(p, nil, 13, 0, false))
    XCTAssertFalse(tb_update(p, nil, 0, 1, false))
    XCTAssertNil(tb_create(.nan))
  }
  func testUpdatesCrossfadeAndQueueRecovers() {
    let p = tb_create(48000)!
    defer { tb_destroy(p) }
    var bands = [band(gain: -12)]
    XCTAssertTrue(tb_update(p, &bands, 1, 0, false))
    let input = [Float](repeating: 0.1, count: 2048)
    var l = input
    var r = input
    tb_process(p, input, input, &l, &r, 2048)
    bands[0].gain = 12
    for _ in 0..<31 { XCTAssertTrue(tb_update(p, &bands, 1, -12.5, false)) }
    XCTAssertFalse(tb_update(p, &bands, 1, -12.5, false))
    tb_process(p, input, input, &l, &r, 2048)
    XCTAssertTrue(l.allSatisfy { $0.isFinite && abs($0) < 1 })
    XCTAssertTrue(zip(l, l.dropFirst()).allSatisfy { abs($0 - $1) < 0.02 })
    XCTAssertTrue(tb_update(p, &bands, 1, -12.5, true))
    tb_process(p, input, input, &l, &r, 2048)
    XCTAssertEqual(l.last!, 0.1 * pow(10, -12.5 / 20), accuracy: 0.00001)
  }
  func testHALInterleavedStereoAndInvalidBufferRecovery() {
    let processor = tb_create(44100)!
    defer { tb_destroy(processor) }
    XCTAssertTrue(tb_update(processor, nil, 0, -6, true))
    var input: [Float] = [0.1, -0.2, 0.3, -0.4]
    var output = [Float](repeating: 1, count: 4)
    input.withUnsafeMutableBytes { inputBytes in
      output.withUnsafeMutableBytes { outputBytes in
        var incoming = AudioBufferList(
          mNumberBuffers: 1,
          mBuffers: AudioBuffer(
            mNumberChannels: 2, mDataByteSize: 16, mData: inputBytes.baseAddress))
        var outgoing = AudioBufferList(
          mNumberBuffers: 1,
          mBuffers: AudioBuffer(
            mNumberChannels: 2, mDataByteSize: 16, mData: outputBytes.baseAddress))
        var timestamp = AudioTimeStamp()
        withUnsafePointer(to: &timestamp) { time in
          XCTAssertEqual(
            tb_io_proc(
              0, time, &incoming, time, &outgoing, time, UnsafeMutableRawPointer(processor)), noErr)
        }
      }
    }
    for i in input.indices {
      XCTAssertEqual(output[i], input[i] * Float(pow(10, -6.0 / 20)), accuracy: 0.000001)
    }
    XCTAssertEqual(tb_callbacks(processor), 1)
    XCTAssertEqual(tb_faults(processor), 0)
    output.withUnsafeMutableBytes { outputBytes in
      var incoming = AudioBufferList(
        mNumberBuffers: 1, mBuffers: AudioBuffer(mNumberChannels: 2, mDataByteSize: 16, mData: nil))
      var outgoing = AudioBufferList(
        mNumberBuffers: 1,
        mBuffers: AudioBuffer(mNumberChannels: 2, mDataByteSize: 16, mData: outputBytes.baseAddress)
      )
      var timestamp = AudioTimeStamp()
      withUnsafePointer(to: &timestamp) { time in
        XCTAssertEqual(
          tb_io_proc(0, time, &incoming, time, &outgoing, time, UnsafeMutableRawPointer(processor)),
          noErr)
      }
    }
    XCTAssertEqual(output, [0, 0, 0, 0])
    XCTAssertEqual(tb_faults(processor), 1)
  }
  func testSpectrumFrequencyLevelStereoAndEQAtDeviceRates() {
    for rate in [32000.0, 44100, 48000, 96000, 192000] {
      let p = tb_create(rate)!
      defer { tb_destroy(p) }
      let size = Int(tb_spectrum_fft_size(p))
      // Bin-aligned tone: its Hann-corrected peak must equal -20 dBFS.
      let frequency = 173 * rate / Double(size)
      var filters = [band(frequency: frequency, gain: 6)]
      XCTAssertTrue(tb_update(p, &filters, 1, -2, false))
      var frequencies = [Float](repeating: 0, count: Int(TB_SPECTRUM_BINS))
      var before = frequencies
      var after = frequencies
      XCTAssertFalse(tb_read_spectrum(p, &frequencies, &before, &after))
      for block in 0..<(size / 512 + 8) {
        let left = (0..<512).map { Float(0.1 * sin(2 * .pi * frequency * Double(block * 512 + $0) / rate)) }
        let right = left.map { -$0 } // Inverted stereo must not cancel.
        var l = left, r = right
        tb_process(p, left, right, &l, &r, 512)
      }
      XCTAssertTrue(tb_read_spectrum(p, &frequencies, &before, &after))
      let peak = before.indices.max { before[$0] < before[$1] }!
      XCTAssertEqual(Double(frequencies[peak]), frequency, accuracy: frequency * 0.025)
      XCTAssertEqual(before[peak], -20, accuracy: 0.02)
      XCTAssertEqual(after[peak] - before[peak], 4, accuracy: 0.02)
      XCTAssertTrue(before.allSatisfy { $0.isFinite })
      XCTAssertFalse(tb_read_spectrum(p, &frequencies, &before, &after))
      let zero = [Float](repeating: 0, count: 512)
      var l = zero, r = zero
      for _ in 0..<(size / 512 * 2) { tb_process(p, zero, zero, &l, &r, 512) }
      XCTAssertTrue(tb_read_spectrum(p, &frequencies, &before, &after))
      XCTAssertTrue(before.allSatisfy { $0 == -120 })
      XCTAssertTrue(after.allSatisfy { $0 == -120 })
    }
  }
  func testSpectrumRingOverflowDoesNotBlockAudioAndRecovers() {
    let p = tb_create(48000)!
    defer { tb_destroy(p) }
    let input = [Float](repeating: 0.05, count: 512)
    var l = input, r = input
    for _ in 0..<180 { tb_process(p, input, input, &l, &r, 512) }
    XCTAssertEqual(l.last!, 0.05)
    var f = [Float](repeating: 0, count: Int(TB_SPECTRUM_BINS))
    var a = f, b = f
    XCTAssertTrue(tb_read_spectrum(p, &f, &a, &b))
    tb_process(p, input, input, &l, &r, 512)
    XCTAssertTrue(tb_read_spectrum(p, &f, &a, &b))
    XCTAssertEqual(tb_faults(p), 0)
  }
}
