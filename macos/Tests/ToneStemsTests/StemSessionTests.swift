import XCTest

@testable import ToneStems

final class StemSessionTests: XCTestCase {
  private var temporary: URL!
  override func setUpWithError() throws {
    temporary = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
    try Data().write(to: temporary.appendingPathComponent("955717e8-8726e21a.th"))
    let config = [
      "python": "/usr/bin/python3", "ffmpeg": "/usr/bin/true", "models": temporary.path,
    ]
    try JSONSerialization.data(withJSONObject: config).write(
      to: temporary.appendingPathComponent("runtime.json"))
  }
  override func tearDownWithError() throws { try FileManager.default.removeItem(at: temporary) }
  private func session(worker: String) throws -> StemSession {
    try worker.write(
      to: temporary.appendingPathComponent("worker.py"), atomically: true, encoding: .utf8)
    return StemSession(
      resources: temporary, outputRoot: temporary.appendingPathComponent("outputs"))
  }
  func testWorkerErrorIsReportedAndPartialFilesAreRemoved() throws {
    let s = try session(
      worker:
        "import sys\nprint('{\"phase\":\"error\",\"message\":\"音频不可读取\",\"progress\":0}', flush=True)\nsys.exit(1)\n"
    )
    XCTAssertTrue(s.available)
    let done = expectation(description: "failed worker cleaned up")
    s.onChange = { state in
      if state["phase"] as? String == "error", !s.busy {
        XCTAssertEqual(state["message"] as? String, "音频不可读取")
        XCTAssertNil(s.outputFolder)
        done.fulfill()
      }
    }
    s.load(temporary.appendingPathComponent("input.wav"), preview: true)
    wait(for: [done], timeout: 10)
    XCTAssertEqual(
      try FileManager.default.contentsOfDirectory(
        atPath: temporary.appendingPathComponent("outputs").path
      ).count, 0)
  }
  func testCancellationTerminatesWorkerAndRemovesPartialFiles() throws {
    let s = try session(
      worker:
        "import time\nprint('{\"phase\":\"separating\",\"progress\":0.1}', flush=True)\ntime.sleep(60)\n"
    )
    let done = expectation(description: "cancelled worker cleaned up")
    s.onChange = { state in
      if state["phase"] as? String == "separating" { s.cancel() }
      if state["phase"] as? String == "idle", !s.busy { done.fulfill() }
    }
    s.load(temporary.appendingPathComponent("input.wav"), preview: true)
    wait(for: [done], timeout: 10)
    XCTAssertFalse(s.busy)
    XCTAssertEqual(
      try FileManager.default.contentsOfDirectory(
        atPath: temporary.appendingPathComponent("outputs").path
      ).count, 0)
    s.close()
  }
  func testMissingRuntimeLeavesEQIndependentAndDoesNotStartWorker() {
    let s = StemSession(resources: temporary.appendingPathComponent("missing"))
    XCTAssertFalse(s.available)
    s.load(temporary, preview: true)
    XCTAssertFalse(s.busy)
  }
}
