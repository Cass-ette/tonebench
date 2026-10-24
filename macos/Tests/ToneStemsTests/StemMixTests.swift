import XCTest

@testable import ToneStems

final class StemMixTests: XCTestCase {
  func testSoloAndMuteAndGain() {
    let values = StemMix.amplitudes([
      "vocals": StemLevel(gain: 6, solo: true),
      "drums": StemLevel(solo: true), "bass": StemLevel(muted: true, solo: true),
    ])
    XCTAssertEqual(values["vocals"]!, pow(10, 6.0 / 20), accuracy: 1e-8)
    XCTAssertEqual(values["drums"], 1)
    XCTAssertEqual(values["bass"], 0)
    XCTAssertEqual(values["other"], 0)
    XCTAssertEqual(values["guitar"], 0)
    XCTAssertEqual(values["piano"], 0)
  }
  func testHeadroomProtectsBoostedSumAndMatchesOriginal() {
    let peaks = [
      "vocals": 0.9, "drums": 0.8, "bass": 0.5, "guitar": 0.6, "piano": 0.7, "other": 0.7,
    ]
    let amplitudes = StemMix.amplitudes([
      "vocals": StemLevel(gain: 6), "guitar": StemLevel(gain: 6), "piano": StemLevel(gain: 6),
    ])
    let scalar = StemMix.headroom(peaks: peaks, amplitudes: amplitudes, original: 0.99)
    let bound = StemMix.ids.reduce(0.0) { $0 + peaks[$1]! * amplitudes[$1]! }
    XCTAssertLessThanOrEqual(scalar * bound, 0.890001)
    XCTAssertLessThanOrEqual(scalar * 0.99, 0.89)
  }
  func testGuitarAndPianoCanBeAdjustedWithoutChangingOtherGains() {
    let values = StemMix.amplitudes(["guitar": StemLevel(gain: -6), "piano": StemLevel(gain: 3)])
    XCTAssertEqual(values["guitar"]!, pow(10, -6.0 / 20), accuracy: 1e-8)
    XCTAssertEqual(values["piano"]!, pow(10, 3.0 / 20), accuracy: 1e-8)
    XCTAssertEqual(values["vocals"], 1)
    let solo = StemMix.amplitudes(["piano": StemLevel(solo: true)])
    XCTAssertEqual(solo["piano"], 1)
    XCTAssertTrue(solo.filter { $0.key != "piano" }.values.allSatisfy { $0 == 0 })
  }
  func testBadGainAndAllMutedRemainFinite() {
    let gains = StemMix.amplitudes(["vocals": StemLevel(gain: .nan)])
    XCTAssertEqual(gains["vocals"], 1)
    let silence = Dictionary(uniqueKeysWithValues: StemMix.ids.map { ($0, StemLevel(muted: true)) })
    let amplitudes = StemMix.amplitudes(silence)
    XCTAssertTrue(amplitudes.values.allSatisfy { $0 == 0 })
    XCTAssertEqual(StemMix.headroom(peaks: [:], amplitudes: amplitudes, original: 0), 0.89)
  }
  func testQuietSourcesCanBoostWithoutExceedingPlayerVolumeRange() {
    let amplitudes = StemMix.amplitudes(["vocals": StemLevel(gain: 6)])
    let scalar = StemMix.headroom(peaks: ["vocals": 0.01], amplitudes: amplitudes, original: 0.01)
    XCTAssertLessThanOrEqual(amplitudes["vocals"]! * scalar, 0.890001)
    XCTAssertEqual(amplitudes["vocals"]! / amplitudes["drums"]!, pow(10, 6.0 / 20), accuracy: 1e-8)
  }
}
