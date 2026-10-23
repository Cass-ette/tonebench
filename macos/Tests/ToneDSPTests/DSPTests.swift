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
}
