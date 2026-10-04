import Foundation

public let graftSpecVersion = 1

public enum Limits {
    public static let maxNodes = 200
    public static let maxDepth = 12
    public static let maxBindings = 50
    public static let maxListLimit = 100
    public static let maxSteps = 100_000
}

public let colorTokens = ["default", "muted", "accent", "positive", "negative", "warning"]

/// Operator arities, shared by evaluator and validator. Keep in sync with spec/README.md §3.
public enum Operators {
    static let n = Int.max
    public static let arity: [String: ClosedRange<Int>] = [
        "var": 1...2, "+": 1...n, "-": 1...2, "*": 1...n, "/": 2...2, "%": 2...2, "round": 1...2,
        "==": 2...2, "!=": 2...2, ">": 2...2, ">=": 2...2, "<": 2...2, "<=": 2...2,
        "and": 1...n, "or": 1...n, "not": 1...1, "if": 2...3, "??": 2...2,
        "count": 1...1, "sum": 1...2, "avg": 1...2, "min": 1...2, "max": 1...2,
        "filter": 2...2, "map": 2...2, "sort": 1...3, "take": 2...2, "first": 1...1, "last": 1...1,
        "group": 2...3, "pluck": 2...2, "concat": 1...n, "lower": 1...1, "upper": 1...1, "contains": 2...2,
        "format": 2...3, "now": 0...0, "toTime": 1...1, "startOf": 1...2, "addDays": 2...2, "object": 2...n,
    ]

    /// Argument indexes evaluated per element with `item`/`index` in scope.
    public static let iteratorArgs: [String: Set<Int>] = ["filter": [1], "map": [1], "group": [1, 2]]

    /// If `e` is an operator call returns (op, args); nil for literals.
    public static func asCall(_ e: JSON) -> (String, [JSON])? {
        guard case .object(let o) = e, o.count == 1, let first = o.entries.first else { return nil }
        if case .array(let a) = first.value { return (first.key, a) }
        return (first.key, [first.value])
    }
}

public struct EvalError: Error, CustomStringConvertible {
    public let description: String
}

public protocol GraftFormatter: Sendable {
    func format(_ value: JSON, kind: String, arg: JSON) -> String?
}

public struct ItemScope {
    public let item: JSON
    public let index: Int
    public init(item: JSON, index: Int) { self.item = item; self.index = index }
}

/// Evaluates Graft expressions. Type mismatches yield `.null`; throws only when the step budget is exceeded.
public final class Evaluator {
    let vars: [String: JSON]
    let formatter: GraftFormatter?
    let now: () -> Double
    let calendar: Calendar
    let maxSteps: Int
    private var steps = 0

    public init(vars: [String: JSON], formatter: GraftFormatter? = nil, now: @escaping () -> Double = { Date().timeIntervalSince1970 * 1000 },
                calendar: Calendar = .current, maxSteps: Int = Limits.maxSteps) {
        self.vars = vars
        self.formatter = formatter
        self.now = now
        self.calendar = calendar
        self.maxSteps = maxSteps
    }

    public func evaluate(_ expr: JSON, scope: ItemScope? = nil) throws -> JSON {
        steps = 0
        return try ev(expr, scope)
    }

    private func list(_ e: JSON) -> [JSON] { e.array ?? [] }

    private func field(_ el: JSON, _ f: JSON?) -> JSON {
        guard let f, !f.isNull else { return el }
        return getPath(el, stringify(f).split(separator: ".", omittingEmptySubsequences: false).map(String.init)) ?? .null
    }

    private func compare(_ a: JSON, _ b: JSON) -> Int? {
        if let x = a.number, let y = b.number { return x < y ? -1 : x > y ? 1 : 0 }
        if let x = a.string, let y = b.string { return x < y ? -1 : x > y ? 1 : 0 }
        return nil
    }

    private func ev(_ e: JSON, _ scope: ItemScope?) throws -> JSON {
        steps += 1
        if steps > maxSteps { throw EvalError(description: "expression step budget exceeded") }
        if case .array(let a) = e { return .array(try a.map { try ev($0, scope) }) }
        guard let call = Operators.asCall(e) else { return e }
        let (op, args) = call
        /// Evaluated argument i, or nil when absent.
        func opt(_ i: Int) throws -> JSON? {
            guard i < args.count else { return nil }
            return try ev(args[i], scope)
        }
        func a(_ i: Int) throws -> JSON { try opt(i) ?? .null }

        switch op {
        case "var":
            let path = stringify(try a(0))
            let segs = path.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
            let head = segs[0]
            var base: JSON?
            if head == "item", let scope { base = scope.item }
            else if head == "index", let scope { base = .number(Double(scope.index)) }
            else { base = vars[head] }
            if let v = getPath(base, Array(segs.dropFirst())) { return v }
            return try a(1)
        case "+":
            var s = 0.0
            for i in args.indices {
                let v = try a(i)
                if v.isNull { continue }
                guard let n = v.number else { return .null }
                s += n
            }
            return .number(s)
        case "*":
            var p = 1.0
            for i in args.indices {
                guard let n = try a(i).number else { return .null }
                p *= n
            }
            return .number(p)
        case "-":
            let x = try a(0).number
            if args.count == 1 { return x.map { .number(-$0) } ?? .null }
            guard let x, let y = try a(1).number else { return .null }
            return .number(x - y)
        case "/", "%":
            guard let x = try a(0).number, let y = try a(1).number, y != 0 else { return .null }
            return .number(op == "/" ? x / y : x.truncatingRemainder(dividingBy: y))
        case "round":
            guard let x = try a(0).number else { return .null }
            let d = try a(1).number ?? 0
            return .number(Evaluator.roundHalfAway(x, Int(d)))
        case "==": return .bool(deepEqual(try a(0), try a(1)))
        case "!=": return .bool(!deepEqual(try a(0), try a(1)))
        case ">", ">=", "<", "<=":
            guard let c = compare(try a(0), try a(1)) else { return .bool(false) }
            switch op {
            case ">": return .bool(c > 0)
            case ">=": return .bool(c >= 0)
            case "<": return .bool(c < 0)
            default: return .bool(c <= 0)
            }
        case "and":
            for i in args.indices {
                if try !a(i).truthy { return .bool(false) }
            }
            return .bool(true)
        case "or":
            for i in args.indices {
                if try a(i).truthy { return .bool(true) }
            }
            return .bool(false)
        case "not":
            let v = try a(0)
            return .bool(!v.truthy)
        case "if":
            if try a(0).truthy { return try a(1) }
            return try a(2)
        case "??":
            let v = try a(0)
            if v.isNull { return try a(1) }
            return v
        case "count": return .number(Double(try a(0).array?.count ?? 0))
        case "sum", "avg", "min", "max":
            let f = try opt(1)
            let nums = list(try a(0)).compactMap { field($0, f).number }
            if op == "sum" { return .number(nums.reduce(0, +)) }
            guard !nums.isEmpty else { return .null }
            switch op {
            case "avg": return .number(nums.reduce(0, +) / Double(nums.count))
            case "min": return .number(nums.min()!)
            default: return .number(nums.max()!)
            }
        case "filter":
            let items = list(try a(0))
            var out: [JSON] = []
            for (i, el) in items.enumerated() {
                if try ev(args[1], ItemScope(item: el, index: i)).truthy { out.append(el) }
            }
            return .array(out)
        case "map":
            var out: [JSON] = []
            for (i, el) in list(try a(0)).enumerated() { out.append(try ev(args[1], ItemScope(item: el, index: i))) }
            return .array(out)
        case "sort":
            let f = try opt(1)
            let sign = try opt(2)?.string == "desc" ? -1 : 1
            let keyed = list(try a(0)).enumerated().map { pair in (el: pair.element, i: pair.offset, k: field(pair.element, f)) }
            let sorted = keyed.sorted { x, y in
                let c: Int
                if let cc = compare(x.k, y.k) {
                    c = cc != 0 ? sign * cc : x.i - y.i
                } else {
                    let xn = x.k.isNull ? 1 : 0
                    let yn = y.k.isNull ? 1 : 0
                    c = xn != yn ? xn - yn : x.i - y.i
                }
                return c < 0
            }
            return .array(sorted.map(\.el))
        case "take":
            guard let n = try a(1).number else { return .array([]) }
            return .array(Array(list(try a(0)).prefix(max(0, Int(n.rounded(.down))))))
        case "first": return list(try a(0)).first ?? .null
        case "last": return list(try a(0)).last ?? .null
        case "group":
            var order: [JSON] = []
            var groups: [JSON: (count: Int, sum: Double)] = [:]
            for (i, el) in list(try a(0)).enumerated() {
                let s = ItemScope(item: el, index: i)
                let key = try ev(args[1], s)
                if groups[key] == nil { order.append(key); groups[key] = (0, 0) }
                groups[key]!.count += 1
                if args.count > 2, let v = try ev(args[2], s).number { groups[key]!.sum += v }
            }
            return .array(order.map { k in
                JSON.object(JSONObject([("key", k), ("count", JSON.number(Double(groups[k]!.count))), ("sum", JSON.number(groups[k]!.sum))]))
            })
        case "pluck":
            let f = try a(1)
            return .array(list(try a(0)).map { field($0, f) })
        case "concat":
            return .string(try args.indices.map { stringify(try a($0)) }.joined())
        case "lower": return try a(0).string.map { .string($0.lowercased()) } ?? .null
        case "upper": return try a(0).string.map { .string($0.uppercased()) } ?? .null
        case "contains":
            let h = try a(0), n = try a(1)
            if let s = h.string { return .bool(n.string.map { s.contains($0) } ?? false) }
            if let arr = h.array { return .bool(arr.contains { deepEqual($0, n) }) }
            return .bool(false)
        case "format":
            let v = try a(0)
            if v.isNull { return .string("") }
            let kind = stringify(try a(1))
            let arg = try a(2)
            return .string(formatter?.format(v, kind: kind, arg: arg) ?? stringify(v))
        case "now": return .number(now())
        case "toTime": return Evaluator.toTime(try a(0)).map { .number($0) } ?? .null
        case "startOf":
            let t: Double?
            if let given = try opt(1) { t = Evaluator.toTime(given) } else { t = now() }
            guard let t, let s = Evaluator.startOf(stringify(try a(0)), t, calendar) else { return .null }
            return .number(s)
        case "addDays":
            guard let t = Evaluator.toTime(try a(0)), let n = try a(1).number else { return .null }
            return .number(t + n * 86_400_000)
        case "object":
            var o = JSONObject()
            var i = 0
            while i + 1 < args.count {
                o[stringify(try a(i))] = try a(i + 1)
                i += 2
            }
            return .object(o)
        default:
            throw EvalError(description: "unknown operator \"\(op)\"")
        }
    }

    // MARK: helpers

    public static func roundHalfAway(_ x: Double, _ digits: Int) -> Double {
        let m = pow(10.0, Double(digits))
        let v = abs(x) * m
        let r = (v + 0.5 + v * Double.ulpOfOne * 4).rounded(.down) / m
        return x < 0 ? -r : r
    }

    private static let isoFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let iso = ISO8601DateFormatter()

    /// ISO-8601 string or epoch ms → epoch ms. Date-only strings are UTC, date-times without offset local (like JavaScript).
    public static func toTime(_ v: JSON) -> Double? {
        if let n = v.number { return n }
        guard let s = v.string, s.range(of: #"^\d{4}-\d{2}-\d{2}"#, options: .regularExpression) != nil else { return nil }
        if let d = isoFractional.date(from: s) ?? iso.date(from: s) { return d.timeIntervalSince1970 * 1000 }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        if s.count == 10 {
            f.dateFormat = "yyyy-MM-dd"
            f.timeZone = TimeZone(identifier: "UTC")
        } else {
            f.dateFormat = s.contains(".") ? "yyyy-MM-dd'T'HH:mm:ss.SSS" : (s.count == 16 ? "yyyy-MM-dd'T'HH:mm" : "yyyy-MM-dd'T'HH:mm:ss")
            f.timeZone = .current
        }
        return f.date(from: s).map { $0.timeIntervalSince1970 * 1000 }
    }

    public static func startOf(_ unit: String, _ t: Double, _ calendar: Calendar = .current) -> Double? {
        var cal = calendar
        cal.firstWeekday = 2 // Monday
        let date = Date(timeIntervalSince1970: t / 1000)
        let component: Calendar.Component
        switch unit {
        case "day": component = .day
        case "week": component = .weekOfYear
        case "month": component = .month
        case "year": component = .year
        default: return nil
        }
        return cal.dateInterval(of: component, for: date).map { $0.start.timeIntervalSince1970 * 1000 }
    }
}

func stringify(_ e: JSON) -> String {
    switch e {
    case .null: return ""
    case .string(let s): return s
    case .number(let n): return JSON.numberToString(n)
    case .bool(let b): return b ? "true" : "false"
    default: return e.serialized
    }
}

/// Spec equality: numbers compare numerically, no type coercion.
func deepEqual(_ a: JSON, _ b: JSON) -> Bool { a == b }

func getPath(_ root: JSON?, _ segments: [String]) -> JSON? {
    var cur = root
    for seg in segments {
        switch cur {
        case .array(let arr)?:
            guard !seg.isEmpty, seg.allSatisfy(\.isASCII), seg.allSatisfy(\.isNumber), let i = Int(seg), i < arr.count else { return nil }
            cur = arr[i]
        case .object(let o)?:
            guard let v = o[seg] else { return nil }
            cur = v
        default:
            return nil
        }
    }
    return cur
}

/// Evaluates bindings in declaration order; returns the root scope (data sources + bindings).
public func resolveBindings(_ bindings: JSONObject?, data: [String: JSON], formatter: GraftFormatter? = nil) throws -> [String: JSON] {
    var vars = data
    for (name, expr) in bindings?.entries ?? [] {
        vars[name] = try Evaluator(vars: vars, formatter: formatter).evaluate(expr)
    }
    return vars
}
