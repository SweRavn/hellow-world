import GraftCore
import SwiftUI

/**
 Renders a widget spec against a data snapshot through a `WidgetController`, which owns the input
 state. Give it `.id(spec)` (as `GraftSlotView` does) so an edited spec starts with fresh state.
 */
public struct LiveWidgetView: View {
    let spec: WidgetSpec
    let data: [String: JSON]
    @StateObject private var controller: WidgetController

    public init(graft: Graft, spec: WidgetSpec, data: [String: JSON]) {
        self.spec = spec
        self.data = data
        _controller = StateObject(wrappedValue: graft.controller(spec, data: data))
    }

    public var body: some View {
        Group {
            if let view = controller.view {
                GraftView(view)
            } else {
                Text("“\(spec.title)” could not be shown.").font(.footnote).foregroundStyle(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .onChange(of: data) { controller.setData($0) }
    }
}

private let isoDay: DateFormatter = {
    // Local time zone both ways, so the picked calendar day is the stored day.
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.dateFormat = "yyyy-MM-dd"
    return f
}()

/// SwiftUI control for a headless input node: reads `input.value`, writes through `input.set(...)`.
/// That's all an input adapter needs, so swapping in your own design-system controls is a small job.
public struct InputControl: View {
    let input: InputNode
    /// The user's raw text ("1." or "1,5") is kept locally; Graft's state holds the coerced value.
    @State private var text: String?

    public init(input: InputNode) { self.input = input }

    private var textBinding: Binding<String> {
        Binding(
            get: { text ?? (input.value.isNull ? "" : displayText(input.value)) },
            set: { text = $0; input.set($0) }
        )
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            switch input.kind {
            case "text", "number":
                if let label = input.label { Text(label).font(.footnote).foregroundStyle(.secondary) }
                field
            case "slider":
                let lo = input.min ?? 0, hi = Swift.max(input.max ?? 1, lo)
                let binding = Binding<Double>(get: { input.value.number ?? lo }, set: { input.set($0) })
                HStack {
                    if let label = input.label { Text(label).font(.footnote).foregroundStyle(.secondary) }
                    Spacer()
                    Text(displayText(input.value)).font(.footnote).monospacedDigit()
                }
                if let step = input.step, step > 0 {
                    Slider(value: binding, in: lo...hi, step: step)
                } else {
                    Slider(value: binding, in: lo...hi)
                }
            case "toggle":
                Toggle(input.label ?? "", isOn: Binding(get: { input.value.bool ?? false }, set: { input.set($0) }))
            case "select":
                Picker(input.label ?? "", selection: Binding<JSON>(get: { input.value }, set: { input.set($0) })) {
                    Text("—").tag(JSON.null)
                    ForEach(input.options, id: \.self) { o in Text(o.label).tag(o.value) }
                }
                .pickerStyle(.menu)
            case "date":
                if let s = input.value.string, let date = isoDay.date(from: s) {
                    DatePicker(input.label ?? "", selection: Binding(get: { date }, set: { input.set(isoDay.string(from: $0)) }),
                               displayedComponents: .date)
                } else {
                    HStack {
                        if let label = input.label { Text(label) }
                        Spacer()
                        Button("Pick a date") { input.set(isoDay.string(from: Date())) }
                    }
                }
            default:
                EmptyView()
            }
        }
    }

    @ViewBuilder
    private var field: some View {
        if input.kind == "text", input.multiline {
            TextField(input.placeholder ?? "", text: textBinding, axis: .vertical).lineLimit(2...6).textFieldStyle(.roundedBorder)
        } else if input.kind == "number" {
            TextField(input.placeholder ?? "", text: textBinding).textFieldStyle(.roundedBorder)
                #if os(iOS)
                .keyboardType(.decimalPad)
                #endif
        } else {
            TextField(input.placeholder ?? "", text: textBinding).textFieldStyle(.roundedBorder)
        }
    }
}
