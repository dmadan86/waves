// Apple's on-device recogniser (SpeechAnalyzer/SpeechTranscriber, macOS 26) over a list of WAV files.
// usage: asr <locale> <list of wav paths> <out.jsonl>
import Foundation
import Speech
import AVFoundation

@main
struct ASR {
  static func main() async throws {
    setvbuf(stdout, nil, _IOLBF, 0)
    let args = CommandLine.arguments
    let locale = Locale(identifier: args[1])
    let paths = try String(contentsOfFile: args[2], encoding: .utf8).split(separator: "\n").map(String.init)
    let outURL = URL(fileURLWithPath: args[3])
    let supported = await SpeechTranscriber.supportedLocale(equivalentTo: locale)
    print("supported", String(describing: supported))
    guard let loc = supported else { exit(1) }
    let probe = SpeechTranscriber(locale: loc, preset: .transcription)
    if let req = try await AssetInventory.assetInstallationRequest(supporting: [probe]) {
      print("installing assets"); try await req.downloadAndInstall()
    }
    FileManager.default.createFile(atPath: outURL.path, contents: nil)
    let fh = try FileHandle(forWritingTo: outURL)
    for p in paths {
      var text = ""
      do {
        let transcriber = SpeechTranscriber(locale: loc, preset: .transcription)
        let analyzer = SpeechAnalyzer(modules: [transcriber])
        let file = try AVAudioFile(forReading: URL(fileURLWithPath: p))
        async let collected: String = {
          var s = ""
          for try await r in transcriber.results { s += String(r.text.characters) }
          return s
        }()
        if let last = try await analyzer.analyzeSequence(from: file) {
          try await analyzer.finalizeAndFinish(through: last)
        } else { await analyzer.cancelAndFinishNow() }
        text = try await collected
      } catch { print("err", error) }
      let line = try JSONSerialization.data(withJSONObject: ["path": p, "text": text])
      fh.write(line); fh.write("\n".data(using: .utf8)!)
    }
    print("done")
  }
}
