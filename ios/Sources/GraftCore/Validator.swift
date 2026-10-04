import Foundation

// MARK: - Manifest (host app → generator). See spec/README.md §1.

public final class SchemaNode: Codable, Sendable {
    public let type: String
    public let description: String?
    public let format: String?
    public let `enum`: [JSON]?
    public let items: SchemaNode?
    public let properties: [String: SchemaNode]?

    public init(_ type: String, description: String? = nil, format: String? = nil, enum: [JSON]? = nil,
                items: SchemaNode? = nil, properties: [String: SchemaNode]? = nil) {
        self.type = type
        self.description = description
        self.format = format
        self.enum = `enum`
        self.items = items
        self.properties = properties
    }
}

public struct DataSourceInfo: Codable, Sendable {
    public let description: String
    public let schema: SchemaNode
    public let sample: JSON?
}

public struct SlotInfo: Codable, Sendable {
    public let description: String
    public let maxWidgets: Int?
    public init(_ description: String, maxWidgets: Int? = nil) {
        self.description = description
        self.maxWidgets = maxWidgets
    }
}

public struct AppInfo: Codable, Sendable {
    public let name: String
    public let description: String?
    public init(_ name: String, description: String? = nil) {
        self.name = name
        self.description = description
    }
}

public struct Theme: Codable, Sendable {
    public let currency: String?
    public let locale: String?
    public init(currency: String? = nil, locale: String? = nil) {
        self.currency = currency
        self.locale = locale
    }
}

public struct Manifest: Codable, Sendable {
    public let app: AppInfo
    public let dataSources: [String: DataSourceInfo]
    public let slots: [String: SlotInfo]
    public let theme: Theme?
}

// MARK: - Widget spec

/// A validated widget spec, kept as ordered JSON. Obtain one through `validateSpec`.
public struct WidgetSpec: Hashable, Identifiable, Sendable {
    public let json: JSONObject
    fileprivate init(_ json: JSONObject) { self.json = json }

    public var id: String { json["id"]?.string ?? "" }
    public var title: String { json["title"]?.string ?? "" }
    public var slot: String { json["slot"]?.string ?? "" }
    public var prompt: String? { json["prompt"]?.string }
    public var bindings: JSONObject? { json["bindings"]?.object }
    public var root: JSONObject { json["root"]?.object ?? JSONObject() }

    func with(_ key: String, _ value: JSON) -> WidgetSpec {
        var o = json
        o[key] = value
        return WidgetSpec(o)
    }
}

// MARK: - Component catalog. Keep in sync with spec/README.md §2.1.

enum PropKind: Equatable {
    case expr, color, number, node, children
    case oneOf([String])
}

struct PropDef {
    let kind: PropKind
    var required = false
    var iterates = false
}

let components: [String: [String: PropDef]] = [
    "card": ["title": PropDef(kind: .expr), "children": PropDef(kind: .children)],
    "column": ["gap": PropDef(kind: .number), "children": PropDef(kind: .children)],
    "row": ["gap": PropDef(kind: .number), "align": PropDef(kind: .oneOf(["start", "center", "end", "spaceBetween"])), "children": PropDef(kind: .children)],
    "text": ["value": PropDef(kind: .expr, required: true), "style": PropDef(kind: .oneOf(["title", "body", "caption"])), "color": PropDef(kind: .color)],
    "metric": ["label": PropDef(kind: .expr, required: true), "value": PropDef(kind: .expr, required: true), "caption": PropDef(kind: .expr), "color": PropDef(kind: .color)],
    "progress": ["value": PropDef(kind: .expr, required: true), "max": PropDef(kind: .expr), "label": PropDef(kind: .expr)],
    "list": ["items": PropDef(kind: .expr, required: true), "template": PropDef(kind: .node, required: true, iterates: true), "empty": PropDef(kind: .expr), "limit": PropDef(kind: .number)],
    "barChart": ["items": PropDef(kind: .expr, required: true), "max": PropDef(kind: .expr)],
    "badge": ["value": PropDef(kind: .expr, required: true), "color": PropDef(kind: .color)],
    "divider": [:],
    "visible": ["when": PropDef(kind: .expr, required: true), "children": PropDef(kind: .children)],
]

// MARK: - Validation

public enum ValidationResult {
    case ok(WidgetSpec)
    case invalid([String])
}

private let reserved: Set<String> = ["item", "index"]

private func isIdentifier(_ s: String) -> Bool {
    s.range(of: "^[A-Za-z_][A-Za-z0-9_]*$", options: .regularExpression) != nil
}

/// Statically validates an untrusted widget spec against the manifest and component catalog.
public func validateSpec(_ input: JSON, manifest: Manifest) -> ValidationResult {
    var errors: [String] = []
    func err(_ path: String, _ msg: String) { if errors.count < 50 { errors.append("\(path): \(msg)") } }

    guard case .object(let spec) = input else { return .invalid(["spec: must be an object"]) }
    if spec["specVersion"]?.number != Double(graftSpecVersion) {
        err("specVersion", "unsupported specVersion \(spec["specVersion"]?.serialized ?? "null"); expected \(graftSpecVersion)")
    }
    if (spec["id"]?.string ?? "").isEmpty { err("id", "must be a non-empty string") }
    if (spec["title"]?.string ?? "").isEmpty { err("title", "must be a non-empty string") }
    let slot = spec["slot"]?.string
    if slot == nil || manifest.slots[slot!] == nil {
        err("slot", "unknown slot \"\(slot ?? "null")\"; available: \(manifest.slots.keys.sorted().joined(separator: ", "))")
    }

    var known = Set(manifest.dataSources.keys)

    func checkExpr(_ e: JSON, _ path: String, _ inIter: Bool) {
        if case .array(let a) = e {
            for (i, x) in a.enumerated() { checkExpr(x, "\(path)[\(i)]", inIter) }
            return
        }
        guard case .object = e else { return }
        guard let call = Operators.asCall(e) else {
            err(path, "object literals are not allowed; an expression object must have exactly one operator key")
            return
        }
        let (op, args) = call
        guard let arity = Operators.arity[op] else { err(path, "unknown operator \"\(op)\""); return }
        guard arity.contains(args.count) else {
            let range = arity.upperBound == Int.max ? "\(arity.lowerBound)+" : arity.lowerBound == arity.upperBound ? "\(arity.lowerBound)" : "\(arity.lowerBound)-\(arity.upperBound)"
            err(path, "\"\(op)\" takes \(range) arguments, got \(args.count)")
            return
        }
        if op == "var" {
            guard let p = args[0].string else { err(path, "var path must be a string literal"); return }
            let head = String(p.split(separator: ".", maxSplits: 1, omittingEmptySubsequences: false)[0])
            let ok = reserved.contains(head) ? inIter : known.contains(head)
            if !ok {
                let avail = (known.sorted() + (inIter ? ["item", "index"] : [])).joined(separator: ", ")
                err(path, "unknown variable \"\(head)\"; available here: \(avail)")
            }
            if args.count > 1 { checkExpr(args[1], "\(path).var[1]", inIter) }
            return
        }
        let iterArgs = Operators.iteratorArgs[op] ?? []
        for (i, x) in args.enumerated() { checkExpr(x, "\(path).\(op)[\(i)]", inIter || iterArgs.contains(i)) }
    }

    if let b = spec["bindings"] {
        if case .object(let bindings) = b {
            if bindings.count > Limits.maxBindings { err("bindings", "at most \(Limits.maxBindings) bindings") }
            for (name, expr) in bindings.entries {
                if reserved.contains(name) || manifest.dataSources[name] != nil || !isIdentifier(name) {
                    err("bindings.\(name)", "invalid binding name (must be an identifier, not a data source name, item or index)")
                }
                checkExpr(expr, "bindings.\(name)", false)
                known.insert(name)
            }
        } else {
            err("bindings", "must be an object")
        }
    }

    var nodes = 0
    func checkNode(_ n: JSON?, _ path: String, _ inIter: Bool, _ depth: Int) {
        nodes += 1
        if nodes > Limits.maxNodes {
            if nodes == Limits.maxNodes + 1 { err(path, "too many nodes (max \(Limits.maxNodes))") }
            return
        }
        if depth > Limits.maxDepth { err(path, "max depth \(Limits.maxDepth) exceeded"); return }
        guard case .object(let obj)? = n, let type = obj["type"]?.string else {
            err(path, "node must be an object with a string `type`")
            return
        }
        guard let props = components[type] else {
            err(path, "unknown component \"\(type)\"; available: \(components.keys.sorted().joined(separator: ", "))")
            return
        }
        for (prop, value) in obj.entries where prop != "type" {
            let p = "\(path).\(prop)"
            guard let pd = props[prop] else { err(p, "unknown prop for \(type)"); continue }
            switch pd.kind {
            case .children:
                if case .array(let kids) = value {
                    for (i, c) in kids.enumerated() { checkNode(c, "\(p)[\(i)]", inIter, depth + 1) }
                } else {
                    err(p, "must be an array of nodes")
                }
            case .node:
                checkNode(value, p, inIter || pd.iterates, depth + 1)
            case .number:
                if (value.number ?? -1) < 0 { err(p, "must be a non-negative number literal") }
            case .color:
                if let s = value.string {
                    if !colorTokens.contains(s) { err(p, "color must be one of \(colorTokens.joined(separator: ", "))") }
                } else {
                    checkExpr(value, p, inIter)
                }
            case .oneOf(let values):
                if !values.contains(value.string ?? "\u{0}") { err(p, "must be one of \(values.joined(separator: ", "))") }
            case .expr:
                checkExpr(value, p, inIter)
            }
        }
        for (prop, pd) in props where pd.required && obj[prop] == nil {
            err("\(path).\(prop)", "required prop \"\(prop)\" missing on \(type)")
        }
        if type == "list", (obj["limit"]?.number ?? 0) > Double(Limits.maxListLimit) {
            err("\(path).limit", "limit must be <= \(Limits.maxListLimit)")
        }
    }

    if spec["root"] == nil { err("root", "missing") } else { checkNode(spec["root"], "root", false, 1) }
    return errors.isEmpty ? .ok(WidgetSpec(spec)) : .invalid(errors)
}
