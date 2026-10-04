import GraftCore
import SwiftUI

/// Receives (state name, coerced value) when the user changes an input; nil renders inputs read-only.
struct InputHandlerKey: EnvironmentKey {
    static let defaultValue: ((String, JSON) -> Void)? = nil
}

extension EnvironmentValues {
    var graftInput: ((String, JSON) -> Void)? {
        get { self[InputHandlerKey.self] }
        set { self[InputHandlerKey.self] = newValue }
    }
}

/**
 Renders a widget spec against a data snapshot and owns its input state, so formulas recompute as the
 user types. Give it `.id(spec)` (as `GraftSlotView` does) so an edited spec starts with fresh state.
 */
public struct LiveWidgetView: View {
    @ObservedObject var graft: Graft
    let spec: WidgetSpec
    let data: [String: JSON]
    @State private var state: [String: JSON]

    public init(graft: Graft, spec: WidgetSpec, data: [String: JSON]) {
        self.graft = graft
        self.spec = spec
        self.data = data
        _state = State(initialValue: Inputs.initialState(spec))
    }

    public var body: some View {
        if let bound = try? graft.bind(spec, data: data, state: state) {
            WidgetView(bound) { name, value in state[name] = value }
        } else {
            Text("“\(spec.title)” could not be shown.").font(.footnote).foregroundStyle(.red)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private let isoDay: DateFormatter = {
    // Local time zone both ways, so the picked calendar day is the stored day.
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.dateFormat = "yyyy-MM-dd"
    return f
}()

/// Renders an `input` node with the native SwiftUI control for its kind.
struct InputView: View {
    let widget: BoundWidget
    let node: JSONObject
    let label: String?
    let placeholder: String?
    let options: JSON

    @Environment(\.graftInput) private var onInput
    @State private var text: String?

    private var kind: String { node["kind"]?.string ?? "" }
    private var name: String { node["bind"]?.string ?? "" }
    private var value: JSON { widget.state[name] ?? .null }
    private var bounds: InputBounds { InputBounds(node) }

    private func set(_ raw: JSON) { onInput?(name, Inputs.coerce(kind, raw, bounds: bounds)) }

    /// The user's raw text ("1." or "1,5") is kept locally; state holds the coerced value.
    private var textBinding: Binding<String> {
        Binding(
            get: { text ?? (value.isNull ? "" : display(value)) },
            set: { text = $0; set(.string($0)) }
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            switch kind {
            case "text", "number":
                if let label { Text(label).font(.footnote).foregroundStyle(.secondary) }
                field
            case "slider":
                let lo = bounds.min ?? 0, hi = Swift.max(bounds.max ?? 1, bounds.min ?? 0)
                let binding = Binding<Double>(get: { value.number ?? lo }, set: { set(.number($0)) })
                HStack {
                    if let label { Text(label).font(.footnote).foregroundStyle(.secondary) }
                    Spacer()
                    Text(display(value)).font(.footnote).monospacedDigit()
                }
                if let step = bounds.step, step > 0 {
                    Slider(value: binding, in: lo...hi, step: step)
                } else {
                    Slider(value: binding, in: lo...hi)
                }
            case "toggle":
                Toggle(label ?? "", isOn: Binding(get: { value.bool ?? false }, set: { set(.bool($0)) }))
            case "select":
                Picker(label ?? "", selection: Binding<JSON>(get: { value }, set: { set($0) })) {
                    Text("—").tag(JSON.null)
                    ForEach(Inputs.options(options), id: \.self) { o in Text(o.label).tag(o.value) }
                }
                .pickerStyle(.menu)
            case "date":
                if let s = value.string, let date = isoDay.date(from: s) {
                    DatePicker(label ?? "", selection: Binding(get: { date }, set: { set(.string(isoDay.string(from: $0))) }),
                               displayedComponents: .date)
                } else {
                    HStack {
                        if let label { Text(label) }
                        Spacer()
                        Button("Pick a date") { set(.string(isoDay.string(from: Date()))) }
                    }
                }
            default:
                EmptyView()
            }
        }
        .disabled(onInput == nil)
    }

    @ViewBuilder
    private var field: some View {
        if kind == "text", node["multiline"]?.bool == true {
            TextField(placeholder ?? "", text: textBinding, axis: .vertical).lineLimit(2...6).textFieldStyle(.roundedBorder)
        } else if kind == "number" {
            TextField(placeholder ?? "", text: textBinding).textFieldStyle(.roundedBorder)
                #if os(iOS)
                .keyboardType(.decimalPad)
                #endif
        } else {
            TextField(placeholder ?? "", text: textBinding).textFieldStyle(.roundedBorder)
        }
    }
}
