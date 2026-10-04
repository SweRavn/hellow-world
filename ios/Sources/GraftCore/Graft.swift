import Foundation

/// A piece of app data exposed to generated widgets. Call `graft.notifyDataChanged()` when it changes.
public struct DataSource {
    public let description: String
    public let schema: SchemaNode
    /// Optional small, non-sensitive example sent to the generator.
    public let sample: JSON?
    public let get: () async throws -> JSON

    public init(_ description: String, schema: SchemaNode, sample: JSON? = nil, get: @escaping () async throws -> JSON) {
        self.description = description
        self.schema = schema
        self.sample = sample
        self.get = get
    }

    /// Exposes any Encodable value: `DataSource.encodable("Orders", schema: s) { await repo.orders }`.
    public static func encodable<T: Encodable>(_ description: String, schema: SchemaNode, sample: T? = nil,
                                               get: @escaping () async throws -> T) -> DataSource {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        func toJSON(_ v: T) throws -> JSON { try JSON.parse(encoder.encode(v)) }
        return DataSource(description, schema: schema, sample: try? sample.map(toJSON)) { try toJSON(try await get()) }
    }
}

public struct GenerateRequest: Encodable, Sendable {
    public let prompt: String
    public let manifest: Manifest
    public let specVersion: Int
    public let slot: String?
    public let existing: JSON?
}

/// Turns a request into an (untrusted) widget spec, usually by calling your backend.
public protocol Generator: Sendable {
    func generate(_ request: GenerateRequest) async throws -> JSON
}

/// Persists accepted widgets. Implement it to sync per user through your backend.
public protocol WidgetStore: Sendable {
    func load() async -> [JSON]
    func save(_ widgets: [WidgetSpec]) async
}

public actor MemoryStore: WidgetStore {
    private var saved: [JSON] = []
    public init() {}
    public func load() -> [JSON] { saved }
    public func save(_ widgets: [WidgetSpec]) { saved = widgets.map { .object($0.json) } }
}

/// Persists widgets in UserDefaults.
public struct UserDefaultsStore: WidgetStore, @unchecked Sendable {
    let defaults: UserDefaults
    let key: String
    public init(defaults: UserDefaults = .standard, key: String = "graft.widgets") {
        self.defaults = defaults
        self.key = key
    }
    public func load() async -> [JSON] {
        guard let s = defaults.string(forKey: key), let v = try? JSON.parse(s) else { return [] }
        return v.array ?? []
    }
    public func save(_ widgets: [WidgetSpec]) async {
        defaults.set(JSON.array(widgets.map { .object($0.json) }).serialized, forKey: key)
    }
}

public struct GraftError: Error, LocalizedError {
    public let message: String
    public let details: [String]
    public init(_ message: String, details: [String] = []) {
        self.message = message
        self.details = details
    }
    public var errorDescription: String? { message }
}

/// Calls a Graft generator backend (see server/ in the repo) over HTTP.
public struct HttpGenerator: Generator {
    let url: URL
    let headers: @Sendable () async -> [String: String]

    public init(url: URL, headers: @escaping @Sendable () async -> [String: String] = { [:] }) {
        self.url = url
        self.headers = headers
    }

    public func generate(_ request: GenerateRequest) async throws -> JSON {
        var req = URLRequest(url: url, timeoutInterval: 180)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        for (k, v) in await headers() { req.setValue(v, forHTTPHeaderField: k) }
        req.httpBody = try JSONEncoder().encode(request)
        let (data, response) = try await URLSession.shared.data(for: req)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let body = (try? JSON.parse(data)) ?? .null
        if (200..<300).contains(status), let spec = body["spec"] { return spec }
        throw GraftError(body["error"]?.string ?? "generator returned HTTP \(status)",
                         details: body["details"]?.array?.compactMap(\.string) ?? [])
    }
}

/// A spec bound to a data snapshot, ready to render.
public struct BoundWidget {
    public let spec: WidgetSpec
    /// Current input values, by state name.
    public let state: [String: JSON]
    let vars: [String: JSON]
    let formatter: GraftFormatter

    /// Evaluates a prop expression. Errors (step budget) degrade to `.null` so rendering never crashes.
    public func eval(_ expr: JSON?, scope: ItemScope? = nil) -> JSON {
        guard let expr else { return .null }
        return (try? Evaluator(vars: vars, formatter: formatter).evaluate(expr, scope: scope)) ?? .null
    }
}

/**
 Platform-neutral Graft engine; GraftUI renders `widgets` into `GraftSlotView`s.

     let graft = Graft(app: AppInfo("Budgetly"), generator: HttpGenerator(url: backendURL), store: UserDefaultsStore())
     graft.addDataSource("transactions", .encodable("Card transactions", schema: schema) { await store.transactions })
     graft.addSlot("home.top", SlotInfo("Top of the home screen"))
     await graft.load()
 */
@MainActor
public final class Graft: ObservableObject {
    @Published public private(set) var widgets: [WidgetSpec] = []
    /// Incremented by `notifyDataChanged()`; views re-snapshot data when it changes.
    @Published public private(set) var dataVersion = 0

    private let app: AppInfo
    private let generator: Generator
    private let store: WidgetStore
    private let theme: Theme?
    public let formatter: GraftFormatter
    private var sources: [(String, DataSource)] = []
    private var slots: [(String, SlotInfo)] = []

    public init(app: AppInfo, generator: Generator, store: WidgetStore = MemoryStore(), theme: Theme? = nil, formatter: GraftFormatter? = nil) {
        self.app = app
        self.generator = generator
        self.store = store
        self.theme = theme
        self.formatter = formatter ?? DefaultFormatter(theme: theme)
    }

    @discardableResult
    public func addDataSource(_ name: String, _ source: DataSource) -> Self {
        precondition(name.range(of: "^[A-Za-z_][A-Za-z0-9_]*$", options: .regularExpression) != nil && name != "state",
                     "invalid data source name \(name)")
        sources.removeAll { $0.0 == name }
        sources.append((name, source))
        return self
    }

    @discardableResult
    public func addSlot(_ id: String, _ info: SlotInfo) -> Self {
        slots.removeAll { $0.0 == id }
        slots.append((id, info))
        return self
    }

    public var slotIds: [String] { slots.map(\.0) }

    public func notifyDataChanged() { dataVersion += 1 }

    /// Loads persisted widgets, dropping any that no longer validate.
    public func load() async {
        let m = manifest()
        widgets = await store.load().compactMap {
            if case .ok(let s) = validateSpec($0, manifest: m) { return s }
            return nil
        }
    }

    public func manifest() -> Manifest {
        Manifest(
            app: app,
            dataSources: Dictionary(uniqueKeysWithValues: sources.map { ($0.0, DataSourceInfo(description: $0.1.description, schema: $0.1.schema, sample: $0.1.sample)) }),
            slots: Dictionary(uniqueKeysWithValues: slots),
            theme: theme
        )
    }

    /// Generates and validates a widget. Does not persist it: preview it, then call `accept`.
    public func propose(_ prompt: String, slot: String? = nil, edit: WidgetSpec? = nil) async throws -> WidgetSpec {
        let m = manifest()
        let raw = try await generator.generate(GenerateRequest(
            prompt: prompt, manifest: m, specVersion: graftSpecVersion, slot: slot, existing: edit.map { .object($0.json) }))
        var spec: WidgetSpec
        switch validateSpec(raw, manifest: m) {
        case .ok(let s): spec = s
        case .invalid(let errors): throw GraftError("The generated widget was invalid", details: errors)
        }
        if let edit {
            spec = spec.with("id", .string(edit.id))
        } else if widgets.contains(where: { $0.id == spec.id }) {
            spec = spec.with("id", .string("\(spec.id)_\(String(Int(Date().timeIntervalSince1970 * 1000), radix: 36))"))
        }
        if spec.prompt == nil { spec = spec.with("prompt", .string(prompt)) }
        return spec
    }

    public func accept(_ spec: WidgetSpec) async throws {
        if case .invalid(let e) = validateSpec(.object(spec.json), manifest: manifest()) { throw GraftError("Widget is invalid", details: e) }
        if let i = widgets.firstIndex(where: { $0.id == spec.id }) { widgets[i] = spec } else { widgets.append(spec) }
        await store.save(widgets)
    }

    public func remove(_ id: String) async {
        widgets.removeAll { $0.id == id }
        await store.save(widgets)
    }

    public func slotWidgets(_ slot: String) -> [WidgetSpec] {
        let list = widgets.filter { $0.slot == slot }
        guard let max = slots.first(where: { $0.0 == slot })?.1.maxWidgets else { return list }
        return Array(list.suffix(max))
    }

    public func snapshot() async throws -> [String: JSON] {
        var out: [String: JSON] = [:]
        for (name, s) in sources { out[name] = try await s.get() }
        return out
    }

    /// Resolves bindings against a data snapshot and the widget's input `state` (defaults to its initial
    /// values). Throws `EvalError` if the budget is exceeded.
    nonisolated public func bind(_ spec: WidgetSpec, data: [String: JSON], state: [String: JSON]? = nil) throws -> BoundWidget {
        let state = state ?? Inputs.initialState(spec)
        var scope = data
        if spec.state != nil {
            scope["state"] = .object(JSONObject(state.sorted { $0.key < $1.key }.map { ($0.key, $0.value) }))
        }
        return BoundWidget(spec: spec, state: state, vars: try resolveBindings(spec.bindings, data: scope, formatter: formatter), formatter: formatter)
    }
}

/// `format` operator backed by Foundation formatters, using the manifest theme's locale and currency.
public struct DefaultFormatter: GraftFormatter {
    let locale: Locale
    let currency: String

    public init(theme: Theme?) {
        locale = theme?.locale.map(Locale.init(identifier:)) ?? .current
        currency = theme?.currency ?? "USD"
    }

    public func format(_ value: JSON, kind: String, arg: JSON) -> String? {
        let f = NumberFormatter()
        f.locale = locale
        switch kind {
        case "number":
            guard let n = value.number else { return nil }
            f.numberStyle = .decimal
            if let d = arg.number { f.minimumFractionDigits = Int(d); f.maximumFractionDigits = Int(d) } else { f.maximumFractionDigits = 2 }
            return f.string(from: NSNumber(value: n))
        case "currency":
            guard let n = value.number else { return nil }
            f.numberStyle = .currency
            f.currencyCode = arg.string ?? currency
            return f.string(from: NSNumber(value: n))
        case "percent":
            guard let n = value.number else { return nil }
            f.numberStyle = .percent
            f.maximumFractionDigits = 1
            return f.string(from: NSNumber(value: n))
        case "date", "datetime":
            guard let t = Evaluator.toTime(value) else { return nil }
            let df = DateFormatter()
            df.locale = locale
            df.dateStyle = .medium
            df.timeStyle = kind == "date" ? .none : .short
            return df.string(from: Date(timeIntervalSince1970: t / 1000))
        case "relative":
            guard let t = Evaluator.toTime(value) else { return nil }
            let rf = RelativeDateTimeFormatter()
            rf.locale = locale
            rf.dateTimeStyle = .named
            return rf.localizedString(for: Date(timeIntervalSince1970: t / 1000), relativeTo: Date())
        default:
            return nil
        }
    }
}
