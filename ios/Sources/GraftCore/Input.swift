import Foundation

/// Numeric bounds for number and slider inputs.
public struct InputBounds: Sendable {
    public var min: Double?
    public var max: Double?
    public var step: Double?
    public init(min: Double? = nil, max: Double? = nil, step: Double? = nil) {
        self.min = min
        self.max = max
        self.step = step
    }
    public init(_ node: JSONObject) {
        self.init(min: node["min"]?.number, max: node["max"]?.number, step: node["step"]?.number)
    }
}

public struct SelectOption: Hashable, Sendable {
    public let label: String
    public let value: JSON
}

/// Input semantics shared by every renderer; matches spec/conformance/inputs.json.
public enum Inputs {
    /// Starting state of a widget: its declared initial values.
    public static func initialState(_ spec: WidgetSpec) -> [String: JSON] {
        var out: [String: JSON] = [:]
        for (k, v) in spec.state?.entries ?? [] { out[k] = v }
        return out
    }

    /// Math.round semantics (half up), matching the TypeScript and Kotlin implementations.
    private static func roundHalfUp(_ x: Double) -> Double { (x + 0.5).rounded(.down) }
    private static func clean(_ x: Double) -> Double { roundHalfUp(x * 1e10) / 1e10 }

    private static func parseNumber(_ raw: JSON) -> Double? {
        if let n = raw.number { return n }
        guard var s = raw.string?.trimmingCharacters(in: .whitespaces) else { return nil }
        if let r = s.range(of: ",") { s.replaceSubrange(r, with: ".") }
        guard !s.isEmpty, s.range(of: #"^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$"#, options: .regularExpression) != nil,
              let d = Double(s), d.isFinite else { return nil }
        return d
    }

    /// Converts a raw value from a platform control into the value stored in widget state.
    public static func coerce(_ kind: String, _ raw: JSON, bounds: InputBounds = InputBounds()) -> JSON {
        switch kind {
        case "text":
            switch raw {
            case .null: return .null
            case .array, .object: return .string("")
            default: return .string(String(stringify(raw).prefix(Limits.maxTextLength)))
            }
        case "number":
            return parseNumber(raw).map { .number($0) } ?? .null
        case "slider":
            let lo = bounds.min ?? 0, hi = bounds.max ?? 1
            var n = parseNumber(raw) ?? lo
            if let step = bounds.step, step > 0 { n = lo + roundHalfUp((n - lo) / step) * step }
            return .number(clean(Swift.min(hi, Swift.max(lo, n))))
        case "toggle":
            return .bool(raw.bool ?? raw.truthy)
        case "select":
            return raw.string != nil || raw.number != nil ? raw : .null
        case "date":
            guard let s = raw.string, let r = s.range(of: #"^\d{4}-\d{2}-\d{2}"#, options: .regularExpression) else { return .null }
            let date = String(s[r])
            let parts = date.split(separator: "-").compactMap { Int($0) }
            guard parts.count == 3, (1...12).contains(parts[1]), (1...31).contains(parts[2]) else { return .null }
            return .string(date)
        default:
            return .null
        }
    }

    /// Normalizes select options: strings/numbers become {label, value}; objects need a value.
    public static func options(_ options: JSON) -> [SelectOption] {
        guard let list = options.array else { return [] }
        return list.prefix(Limits.maxListLimit).compactMap { o in
            if o.string != nil || o.number != nil { return SelectOption(label: stringify(o), value: o) }
            guard let obj = o.object, let v = obj["value"], v.string != nil || v.number != nil else { return nil }
            let l = obj["label"]
            let label = (l?.string != nil || l?.number != nil) ? stringify(l!) : stringify(v)
            return SelectOption(label: label, value: v)
        }
    }
}
