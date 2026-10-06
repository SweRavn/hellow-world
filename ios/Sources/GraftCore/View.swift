import Foundation

/*
 Headless view layer. Graft evaluates a widget into a tree of plain, display-ready nodes; any UI
 framework (SwiftUI, UIKit, ...) renders it with its own components. Input nodes carry a getter
 (`value`) and a setter (`set`). Canonical shape: spec/README.md §7; GraftUI is one adapter.
 */

public struct Bar: Hashable, Sendable {
    public let label: String
    public let value: Double
    public let fraction: Double
}

/// An input in the view tree: read `value`, write through `set`.
public struct InputNode {
    public let key: String
    public let kind: String
    /// Name of the state entry this input edits.
    public let name: String
    public let label: String?
    public let placeholder: String?
    public let min: Double?
    public let max: Double?
    public let step: Double?
    public let multiline: Bool
    /// Choices for `select`; empty for other kinds.
    public let options: [SelectOption]
    /// Getter: the current (coerced) value.
    public let value: JSON
    let setter: (JSON) -> Void

    /// Setter: pass the raw value from your control; Graft coerces it, updates state and recomputes.
    public func set(_ raw: JSON) { setter(raw) }
    public func set(_ raw: String) { setter(.string(raw)) }
    public func set(_ raw: Double) { setter(.number(raw)) }
    public func set(_ raw: Bool) { setter(.bool(raw)) }
}

public indirect enum ViewNode {
    case card(key: String, title: String?, children: [ViewNode])
    case column(key: String, gap: Double?, children: [ViewNode])
    case row(key: String, gap: Double?, align: String, children: [ViewNode])
    case text(key: String, text: String, style: String, color: String)
    case metric(key: String, label: String, value: String, caption: String?, color: String)
    case progress(key: String, label: String?, value: Double, max: Double, fraction: Double)
    case list(key: String, items: [ViewNode], empty: String?)
    case barChart(key: String, bars: [Bar])
    case badge(key: String, text: String, color: String)
    case divider(key: String)
    case input(InputNode)

    /// Stable identity (the node's path in the spec). Use it as the id in your UI framework.
    public var key: String {
        switch self {
        case .card(let k, _, _), .column(let k, _, _), .row(let k, _, _, _), .text(let k, _, _, _),
             .metric(let k, _, _, _, _), .progress(let k, _, _, _, _), .list(let k, _, _), .barChart(let k, _),
             .badge(let k, _, _), .divider(let k):
            return k
        case .input(let i):
            return i.key
        }
    }
}

/// Display text for any value: null → "", numbers in shortest form, objects as JSON.
public func displayText(_ v: JSON) -> String { stringify(v) }

/// Evaluates a bound widget into a view tree. `onSet` receives (state name, coerced value) from input
/// setters. Expression errors inside a prop degrade to null.
public func resolveView(_ w: BoundWidget, onSet: ((String, JSON) -> Void)? = nil) -> ViewNode {
    func ev(_ n: JSONObject, _ key: String, _ scope: ItemScope?) -> JSON { w.eval(n[key], scope: scope) }
    func opt(_ v: JSON) -> String? { v.isNull ? nil : displayText(v) }
    func color(_ v: JSON) -> String { v.string.flatMap { colorTokens.contains($0) ? $0 : nil } ?? "default" }
    func frac(_ value: Double, _ max: Double) -> Double { max > 0 ? Swift.min(1, Swift.max(0, value / max)) : 0 }

    func kids(_ n: JSONObject, _ scope: ItemScope?, _ key: String) -> [ViewNode] {
        (n["children"]?.array ?? []).enumerated().flatMap { pair in many(pair.element.object ?? JSONObject(), scope, "\(key).\(pair.offset)") }
    }

    // `visible` has no node of its own: when true its children are spliced into the parent.
    func many(_ n: JSONObject, _ scope: ItemScope?, _ key: String) -> [ViewNode] {
        if n["type"]?.string == "visible" { return ev(n, "when", scope).truthy ? kids(n, scope, key) : [] }
        return [one(n, scope, key)]
    }

    func one(_ n: JSONObject, _ scope: ItemScope?, _ key: String) -> ViewNode {
        switch n["type"]?.string ?? "" {
        case "card":
            return .card(key: key, title: opt(ev(n, "title", scope)), children: kids(n, scope, key))
        case "column":
            return .column(key: key, gap: n["gap"]?.number, children: kids(n, scope, key))
        case "row":
            return .row(key: key, gap: n["gap"]?.number, align: n["align"]?.string ?? "start", children: kids(n, scope, key))
        case "text":
            return .text(key: key, text: displayText(ev(n, "value", scope)), style: n["style"]?.string ?? "body", color: color(ev(n, "color", scope)))
        case "metric":
            let caption = ev(n, "caption", scope)
            return .metric(key: key, label: displayText(ev(n, "label", scope)), value: displayText(ev(n, "value", scope)),
                           caption: caption.isNull || caption.string == "" ? nil : displayText(caption), color: color(ev(n, "color", scope)))
        case "progress":
            let value = ev(n, "value", scope).number ?? 0
            let max = ev(n, "max", scope).number ?? 1
            return .progress(key: key, label: opt(ev(n, "label", scope)), value: value, max: max, fraction: frac(value, max))
        case "list":
            let arr = ev(n, "items", scope).array ?? []
            let limit = Swift.min(Int(n["limit"]?.number ?? Double(Limits.maxListLimit)), Limits.maxListLimit)
            let template = n["template"]?.object ?? JSONObject()
            var items: [ViewNode] = []
            for (i, item) in arr.prefix(limit).enumerated() {
                items += many(template, ItemScope(item: item, index: i), "\(key).\(i)")
            }
            return .list(key: key, items: items, empty: arr.isEmpty ? opt(ev(n, "empty", scope)) : nil)
        case "barChart":
            let rows = (ev(n, "items", scope).array ?? []).prefix(Limits.maxListLimit).map { item in
                (label: displayText(item["label"] ?? .null), value: item["value"]?.number ?? 0)
            }
            let max = ev(n, "max", scope).number ?? Swift.max(0, rows.map { $0.value }.max() ?? 0)
            return .barChart(key: key, bars: rows.map { Bar(label: $0.label, value: $0.value, fraction: frac($0.value, max)) })
        case "badge":
            return .badge(key: key, text: displayText(ev(n, "value", scope)), color: color(ev(n, "color", scope)))
        case "divider":
            return .divider(key: key)
        case "input":
            let kind = n["kind"]?.string ?? ""
            let name = n["bind"]?.string ?? ""
            let bounds = InputBounds(n)
            return .input(InputNode(
                key: key, kind: kind, name: name, label: opt(ev(n, "label", scope)), placeholder: opt(ev(n, "placeholder", scope)),
                min: bounds.min, max: bounds.max, step: bounds.step, multiline: n["multiline"]?.bool == true,
                options: kind == "select" ? Inputs.options(ev(n, "options", scope)) : [],
                value: w.state[name] ?? .null,
                setter: { raw in onSet?(name, Inputs.coerce(kind, raw, bounds: bounds)) }
            ))
        default:
            return .column(key: key, gap: nil, children: []) // unreachable for validated specs
        }
    }

    let roots = many(w.spec.root, nil, "root")
    return roots.count == 1 ? roots[0] : .column(key: "root", gap: nil, children: roots)
}

extension ViewNode {
    /// Canonical JSON form of a view tree (setters dropped), as used by the conformance vectors.
    public var json: JSON {
        func s(_ v: String?) -> JSON { v.map { .string($0) } ?? .null }
        func d(_ v: Double?) -> JSON { v.map { .number($0) } ?? .null }
        func arr(_ nodes: [ViewNode]) -> JSON { .array(nodes.map(\.json)) }
        let fields: [(String, JSON)]
        switch self {
        case .card(let k, let title, let children):
            fields = [("type", "card"), ("key", s(k)), ("title", s(title)), ("children", arr(children))]
        case .column(let k, let gap, let children):
            fields = [("type", "column"), ("key", s(k)), ("gap", d(gap)), ("children", arr(children))]
        case .row(let k, let gap, let align, let children):
            fields = [("type", "row"), ("key", s(k)), ("gap", d(gap)), ("align", s(align)), ("children", arr(children))]
        case .text(let k, let text, let style, let color):
            fields = [("type", "text"), ("key", s(k)), ("text", s(text)), ("style", s(style)), ("color", s(color))]
        case .metric(let k, let label, let value, let caption, let color):
            fields = [("type", "metric"), ("key", s(k)), ("label", s(label)), ("value", s(value)), ("caption", s(caption)), ("color", s(color))]
        case .progress(let k, let label, let value, let max, let fraction):
            fields = [("type", "progress"), ("key", s(k)), ("label", s(label)), ("value", d(value)), ("max", d(max)), ("fraction", d(fraction))]
        case .list(let k, let items, let empty):
            fields = [("type", "list"), ("key", s(k)), ("items", arr(items)), ("empty", s(empty))]
        case .barChart(let k, let bars):
            fields = [("type", "barChart"), ("key", s(k)), ("bars", .array(bars.map {
                JSON.object(JSONObject([("label", s($0.label)), ("value", d($0.value)), ("fraction", d($0.fraction))]))
            }))]
        case .badge(let k, let text, let color):
            fields = [("type", "badge"), ("key", s(k)), ("text", s(text)), ("color", s(color))]
        case .divider(let k):
            fields = [("type", "divider"), ("key", s(k))]
        case .input(let i):
            fields = [("type", "input"), ("key", s(i.key)), ("kind", s(i.kind)), ("name", s(i.name)), ("label", s(i.label)),
                      ("placeholder", s(i.placeholder)), ("min", d(i.min)), ("max", d(i.max)), ("step", d(i.step)),
                      ("multiline", .bool(i.multiline)),
                      ("options", .array(i.options.map { JSON.object(JSONObject([("label", s($0.label)), ("value", $0.value)])) })),
                      ("value", i.value)]
        }
        return .object(JSONObject(fields))
    }
}

/// Headless controller for one widget: owns its input state, recomputes the view tree when an input is
/// set or the data changes, and publishes it. Observe it from SwiftUI, or subscribe from UIKit.
/// Use it from the main thread, like any UI model.
public final class WidgetController: ObservableObject {
    public let spec: WidgetSpec
    private let graft: Graft
    private var data: [String: JSON]
    private var listeners: [UUID: (ViewNode?) -> Void] = [:]

    /// Current view tree, or nil when the widget can't be computed (see `error`).
    @Published public private(set) var view: ViewNode?
    @Published public private(set) var error: String?
    @Published public private(set) var state: [String: JSON]

    public init(graft: Graft, spec: WidgetSpec, data: [String: JSON], state: [String: JSON]? = nil) {
        self.graft = graft
        self.spec = spec
        self.data = data
        self.state = state ?? Inputs.initialState(spec)
        recompute()
    }

    /// Sets an input value by state name (already coerced, e.g. via `Inputs.coerce`).
    public func set(_ name: String, _ value: JSON) {
        state[name] = value
        recompute()
    }

    public func setData(_ data: [String: JSON]) {
        self.data = data
        recompute()
    }

    /// Closure-based observation for non-SwiftUI code. Returns a cancel function.
    @discardableResult
    public func subscribe(_ listener: @escaping (ViewNode?) -> Void) -> () -> Void {
        let id = UUID()
        listeners[id] = listener
        return { [weak self] in self?.listeners[id] = nil }
    }

    private func recompute() {
        do {
            let bound = try graft.bind(spec, data: data, state: state)
            view = resolveView(bound) { [weak self] name, value in self?.set(name, value) }
            error = nil
        } catch {
            view = nil
            self.error = "too much data to compute"
        }
        for l in listeners.values { l(view) }
    }
}

extension Graft {
    /// Headless controller for one widget: view tree + input getters/setters for any UI framework.
    public func controller(_ spec: WidgetSpec, data: [String: JSON], state: [String: JSON]? = nil) -> WidgetController {
        WidgetController(graft: self, spec: spec, data: data, state: state)
    }
}
