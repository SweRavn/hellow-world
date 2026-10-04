import Foundation
import XCTest
@testable import GraftCore

/// Runs the shared vectors in spec/conformance so iOS agrees with the TypeScript reference.
final class ConformanceTests: XCTestCase {
    private func load(_ name: String) throws -> JSON {
        let dir = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("spec/conformance")
        return try JSON.parse(Data(contentsOf: dir.appendingPathComponent(name)))
    }

    func testExpressions() throws {
        let file = try load("expressions.json")
        var data: [String: JSON] = [:]
        for (k, v) in file["data"]!.object!.entries { data[k] = v }
        var failures: [String] = []
        for c in file["cases"]!.array! {
            let name = c["name"]!.string!
            do {
                let vars = try resolveBindings(c["bindings"]?.object, data: data)
                let got = try Evaluator(vars: vars).evaluate(c["expr"]!)
                if got != c["expect"]! { failures.append("\(name): expected \(c["expect"]!.serialized), got \(got.serialized)") }
            } catch {
                failures.append("\(name): threw \(error)")
            }
        }
        XCTAssert(failures.isEmpty, failures.joined(separator: "\n"))
    }

    func testValidation() throws {
        let file = try load("validation.json")
        let manifest = try JSONDecoder().decode(Manifest.self, from: Data(file["manifest"]!.serialized.utf8))
        var failures: [String] = []
        for c in file["cases"]!.array! {
            let name = c["name"]!.string!
            let valid = c["valid"]!.bool!
            switch validateSpec(c["spec"]!, manifest: manifest) {
            case .ok:
                if !valid { failures.append("\(name): expected invalid") }
            case .invalid(let errors):
                if valid { failures.append("\(name): expected valid, got \(errors)") }
                if let want = c["error"]?.string?.lowercased(), !errors.contains(where: { $0.lowercased().contains(want) }) {
                    failures.append("\(name): errors \(errors) lack \"\(want)\"")
                }
            }
        }
        XCTAssert(failures.isEmpty, failures.joined(separator: "\n"))
    }

    func testJSONPreservesKeyOrder() throws {
        let v = try JSON.parse(#"{"b":1,"a":{"z":[1,2.5,"x\né"],"y":null},"c":true}"#)
        XCTAssertEqual(v.object!.keys, ["b", "a", "c"])
        XCTAssertEqual(v.serialized, #"{"b":1,"a":{"z":[1,2.5,"x\né"],"y":null},"c":true}"#)
    }

    func testStepBudget() {
        let big = JSON.array((0..<1000).map { JSON.number(Double($0)) })
        let expr: JSON = ["map": [big, ["map": [big, ["+": [["var": "item"], 1]]]]]]
        XCTAssertThrowsError(try Evaluator(vars: [:]).evaluate(expr))
    }
}
