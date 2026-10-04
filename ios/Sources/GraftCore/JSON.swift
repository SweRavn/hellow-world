import Foundation

/// JSON value with **ordered** objects. Order matters: spec bindings are evaluated in declaration order,
/// which `JSONDecoder`/`JSONSerialization` do not preserve, so Graft ships its own small parser.
public enum JSON: Hashable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSON])
    case object(JSONObject)

    public subscript(key: String) -> JSON? {
        if case .object(let o) = self { return o[key] }
        return nil
    }

    public var string: String? { if case .string(let s) = self { return s }; return nil }
    public var number: Double? { if case .number(let n) = self, n.isFinite { return n }; return nil }
    public var bool: Bool? { if case .bool(let b) = self { return b }; return nil }
    public var array: [JSON]? { if case .array(let a) = self { return a }; return nil }
    public var object: JSONObject? { if case .object(let o) = self { return o }; return nil }
    public var isNull: Bool { if case .null = self { return true }; return false }

    /// Truthiness per spec §3: false, null, 0, "", [] are falsy.
    public var truthy: Bool {
        switch self {
        case .null: return false
        case .bool(let b): return b
        case .number(let n): return n != 0
        case .string(let s): return !s.isEmpty
        case .array(let a): return !a.isEmpty
        case .object: return true
        }
    }
}

/// Insertion-ordered JSON object. Equality ignores order.
public struct JSONObject: Hashable, Sendable {
    public private(set) var keys: [String] = []
    private var dict: [String: JSON] = [:]

    public init() {}
    public init(_ pairs: [(String, JSON)]) { for (k, v) in pairs { self[k] = v } }

    public subscript(key: String) -> JSON? {
        get { dict[key] }
        set {
            if dict[key] == nil, newValue != nil { keys.append(key) }
            if newValue == nil { keys.removeAll { $0 == key } }
            dict[key] = newValue
        }
    }

    public var count: Int { keys.count }
    public var entries: [(key: String, value: JSON)] { keys.map { (key: $0, value: dict[$0]!) } }

    public static func == (a: JSONObject, b: JSONObject) -> Bool { a.dict == b.dict }
    public func hash(into h: inout Hasher) { h.combine(dict) }
}

extension JSON: ExpressibleByNilLiteral, ExpressibleByBooleanLiteral, ExpressibleByFloatLiteral,
    ExpressibleByIntegerLiteral, ExpressibleByStringLiteral, ExpressibleByArrayLiteral, ExpressibleByDictionaryLiteral {
    public init(nilLiteral: ()) { self = .null }
    public init(booleanLiteral v: Bool) { self = .bool(v) }
    public init(floatLiteral v: Double) { self = .number(v) }
    public init(integerLiteral v: Int) { self = .number(Double(v)) }
    public init(stringLiteral v: String) { self = .string(v) }
    public init(arrayLiteral v: JSON...) { self = .array(v) }
    public init(dictionaryLiteral v: (String, JSON)...) { self = .object(JSONObject(v)) }
}

// MARK: - Parsing & serialization

public struct JSONParseError: Error, CustomStringConvertible {
    public let description: String
}

extension JSON {
    public static func parse(_ text: String) throws -> JSON { try parse(Data(text.utf8)) }

    public static func parse(_ data: Data) throws -> JSON {
        var p = Parser(bytes: [UInt8](data))
        p.skipWS()
        let v = try p.value(depth: 0)
        p.skipWS()
        guard p.i == p.bytes.count else { throw JSONParseError(description: "trailing characters at \(p.i)") }
        return v
    }

    /// Compact JSON text.
    public var serialized: String {
        switch self {
        case .null: return "null"
        case .bool(let b): return b ? "true" : "false"
        case .number(let n): return n.isFinite ? JSON.numberToString(n) : "null"
        case .string(let s): return JSON.quote(s)
        case .array(let a): return "[" + a.map(\.serialized).joined(separator: ",") + "]"
        case .object(let o): return "{" + o.entries.map { JSON.quote($0.key) + ":" + $0.value.serialized }.joined(separator: ",") + "}"
        }
    }

    /// Shortest round-trip formatting, matching JavaScript's String(number) for common values.
    public static func numberToString(_ d: Double) -> String {
        if d == d.rounded(), abs(d) < 1e15 { return String(Int64(d)) }
        return String(d)
    }

    static func quote(_ s: String) -> String {
        var out = "\""
        for u in s.unicodeScalars {
            switch u {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            case _ where u.value < 0x20: out += String(format: "\\u%04x", u.value)
            default: out.unicodeScalars.append(u)
            }
        }
        return out + "\""
    }

    private struct Parser {
        let bytes: [UInt8]
        var i = 0

        mutating func skipWS() {
            while i < bytes.count, [0x20, 0x0A, 0x0D, 0x09].contains(bytes[i]) { i += 1 }
        }

        func fail(_ msg: String) -> JSONParseError { JSONParseError(description: "\(msg) at \(i)") }

        mutating func value(depth: Int) throws -> JSON {
            guard depth < 256 else { throw fail("nesting too deep") }
            guard i < bytes.count else { throw fail("unexpected end") }
            switch bytes[i] {
            case UInt8(ascii: "{"):
                i += 1
                var o = JSONObject()
                skipWS()
                if i < bytes.count, bytes[i] == UInt8(ascii: "}") { i += 1; return .object(o) }
                while true {
                    skipWS()
                    guard i < bytes.count, bytes[i] == UInt8(ascii: "\"") else { throw fail("expected key") }
                    let k = try string()
                    skipWS()
                    guard i < bytes.count, bytes[i] == UInt8(ascii: ":") else { throw fail("expected ':'") }
                    i += 1
                    skipWS()
                    o[k] = try value(depth: depth + 1)
                    skipWS()
                    guard i < bytes.count else { throw fail("unexpected end") }
                    if bytes[i] == UInt8(ascii: ",") { i += 1; continue }
                    if bytes[i] == UInt8(ascii: "}") { i += 1; return .object(o) }
                    throw fail("expected ',' or '}'")
                }
            case UInt8(ascii: "["):
                i += 1
                var a: [JSON] = []
                skipWS()
                if i < bytes.count, bytes[i] == UInt8(ascii: "]") { i += 1; return .array(a) }
                while true {
                    skipWS()
                    a.append(try value(depth: depth + 1))
                    skipWS()
                    guard i < bytes.count else { throw fail("unexpected end") }
                    if bytes[i] == UInt8(ascii: ",") { i += 1; continue }
                    if bytes[i] == UInt8(ascii: "]") { i += 1; return .array(a) }
                    throw fail("expected ',' or ']'")
                }
            case UInt8(ascii: "\""):
                return .string(try string())
            case UInt8(ascii: "t"): return try literal("true", .bool(true))
            case UInt8(ascii: "f"): return try literal("false", .bool(false))
            case UInt8(ascii: "n"): return try literal("null", .null)
            default:
                return try number()
            }
        }

        mutating func literal(_ word: String, _ v: JSON) throws -> JSON {
            let w = Array(word.utf8)
            guard i + w.count <= bytes.count, Array(bytes[i..<i + w.count]) == w else { throw fail("invalid literal") }
            i += w.count
            return v
        }

        mutating func number() throws -> JSON {
            let start = i
            while i < bytes.count, "+-0123456789.eE".utf8.contains(bytes[i]) { i += 1 }
            guard let s = String(bytes: bytes[start..<i], encoding: .utf8), let d = Double(s) else { throw fail("invalid number") }
            return .number(d)
        }

        mutating func string() throws -> String {
            i += 1 // opening quote
            var scalars = String.UnicodeScalarView()
            var raw: [UInt8] = []
            func flush() {
                if !raw.isEmpty { scalars.append(contentsOf: String(decoding: raw, as: UTF8.self).unicodeScalars); raw.removeAll() }
            }
            while i < bytes.count {
                let c = bytes[i]
                if c == UInt8(ascii: "\"") { i += 1; flush(); return String(scalars) }
                if c == UInt8(ascii: "\\") {
                    flush()
                    i += 1
                    guard i < bytes.count else { break }
                    let e = bytes[i]
                    i += 1
                    switch e {
                    case UInt8(ascii: "n"): scalars.append("\n")
                    case UInt8(ascii: "t"): scalars.append("\t")
                    case UInt8(ascii: "r"): scalars.append("\r")
                    case UInt8(ascii: "b"): scalars.append("\u{08}")
                    case UInt8(ascii: "f"): scalars.append("\u{0C}")
                    case UInt8(ascii: "u"):
                        var code = try hex4()
                        if (0xD800..<0xDC00).contains(code), i + 1 < bytes.count, bytes[i] == UInt8(ascii: "\\"), bytes[i + 1] == UInt8(ascii: "u") {
                            i += 2
                            let low = try hex4()
                            code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00)
                        }
                        scalars.append(Unicode.Scalar(code) ?? "\u{FFFD}")
                    default: scalars.append(Unicode.Scalar(e))
                    }
                } else {
                    raw.append(c)
                    i += 1
                }
            }
            throw fail("unterminated string")
        }

        mutating func hex4() throws -> UInt32 {
            guard i + 4 <= bytes.count, let s = String(bytes: bytes[i..<i + 4], encoding: .ascii), let v = UInt32(s, radix: 16) else {
                throw fail("invalid \\u escape")
            }
            i += 4
            return v
        }
    }
}

extension JSON: Codable {
    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let d = try? c.decode(Double.self) { self = .number(d) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSON].self) { self = .array(a) }
        else {
            // Note: Codable dictionaries are unordered. Use JSON.parse when order matters (widget specs).
            let d = try c.decode([String: JSON].self)
            self = .object(JSONObject(d.sorted { $0.key < $1.key }.map { ($0.key, $0.value) }))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let b): try c.encode(b)
        case .number(let n): try c.encode(n)
        case .string(let s): try c.encode(s)
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(Dictionary(uniqueKeysWithValues: o.entries.map { ($0.key, $0.value) }))
        }
    }
}
