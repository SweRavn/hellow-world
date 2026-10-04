import GraftCore
import SwiftUI

/// Renders a bound widget spec with native SwiftUI views.
/// Renders a bound widget. Use `LiveWidgetView` for working inputs; here, input changes go to `onInput`.
public struct WidgetView: View {
    let widget: BoundWidget
    let onInput: ((String, JSON) -> Void)?

    public init(_ widget: BoundWidget, onInput: ((String, JSON) -> Void)? = nil) {
        self.widget = widget
        self.onInput = onInput
    }

    public var body: some View {
        NodeView(widget: widget, node: widget.spec.root, scope: nil)
            .environment(\.graftInput, onInput)
    }
}

func tokenColor(_ v: JSON) -> Color? {
    switch v.string {
    case "muted": return .secondary
    case "accent": return .accentColor
    case "positive": return .green
    case "negative": return .red
    case "warning": return .orange
    default: return nil
    }
}

func display(_ v: JSON) -> String {
    switch v {
    case .null: return ""
    case .string(let s): return s
    case .number(let n): return JSON.numberToString(n)
    case .bool(let b): return b ? "true" : "false"
    default: return v.serialized
    }
}

struct NodeView: View {
    let widget: BoundWidget
    let node: JSONObject
    let scope: ItemScope?

    private func ev(_ key: String) -> JSON { widget.eval(node[key], scope: scope) }
    private var children: [JSONObject] { node["children"]?.array?.compactMap(\.object) ?? [] }
    private var gap: CGFloat { CGFloat(node["gap"]?.number ?? 8) }

    @ViewBuilder
    private func kids() -> some View {
        ForEach(Array(children.enumerated()), id: \.offset) { _, child in
            NodeView(widget: widget, node: child, scope: scope)
        }
    }

    var body: some View {
        switch node["type"]?.string ?? "" {
        case "card":
            VStack(alignment: .leading, spacing: 10) {
                let title = ev("title")
                if !title.isNull {
                    Text(display(title)).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                }
                kids()
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 12).fill(Color(white: 0.5, opacity: 0.08)))
        case "column":
            VStack(alignment: .leading, spacing: gap) { kids() }
        case "row":
            HStack(spacing: gap) {
                let align = node["align"]?.string
                if align == "center" || align == "end" { Spacer(minLength: 0) }
                if align == "spaceBetween" {
                    ForEach(Array(children.enumerated()), id: \.offset) { i, child in
                        if i > 0 { Spacer(minLength: gap) }
                        NodeView(widget: widget, node: child, scope: scope)
                    }
                } else {
                    kids()
                }
                if align == "center" || align == nil || align == "start" { Spacer(minLength: 0) }
            }
        case "text":
            Text(display(ev("value")))
                .font(node["style"]?.string == "title" ? .headline : node["style"]?.string == "caption" ? .caption : .body)
                .foregroundStyle(tokenColor(ev("color")) ?? .primary)
        case "metric":
            VStack(alignment: .leading, spacing: 2) {
                Text(display(ev("label"))).font(.footnote).foregroundStyle(.secondary)
                Text(display(ev("value"))).font(.title.bold()).monospacedDigit()
                    .foregroundStyle(tokenColor(ev("color")) ?? .primary)
                let caption = display(ev("caption"))
                if !caption.isEmpty { Text(caption).font(.caption).foregroundStyle(.secondary) }
            }
        case "progress":
            let value = ev("value").number ?? 0
            let max = ev("max").number ?? 1
            VStack(alignment: .leading, spacing: 4) {
                let label = ev("label")
                if !label.isNull { Text(display(label)).font(.footnote) }
                ProgressView(value: Swift.max(0, Swift.min(value, max)), total: Swift.max(max, .leastNonzeroMagnitude))
                    .tint(value > max ? .red : .accentColor)
            }
        case "list":
            let items = ev("items").array ?? []
            let limit = Swift.min(Int(node["limit"]?.number ?? Double(Limits.maxListLimit)), Limits.maxListLimit)
            VStack(alignment: .leading, spacing: 6) {
                if items.isEmpty, !ev("empty").isNull {
                    Text(display(ev("empty"))).font(.footnote).foregroundStyle(.secondary)
                }
                if let template = node["template"]?.object {
                    ForEach(Array(items.prefix(limit).enumerated()), id: \.offset) { i, item in
                        NodeView(widget: widget, node: template, scope: ItemScope(item: item, index: i))
                    }
                }
            }
        case "barChart":
            let rows = (ev("items").array ?? []).prefix(Limits.maxListLimit).map { item in
                (label: display(item["label"] ?? .null), value: item["value"]?.number ?? 0)
            }
            let max = ev("max").number ?? rows.map(\.value).max() ?? 0
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    HStack(spacing: 8) {
                        Text(row.label).font(.footnote).lineLimit(1).frame(width: 96, alignment: .leading)
                        ProgressView(value: max > 0 ? Swift.min(Swift.max(row.value / max, 0), 1) : 0)
                        Text(JSON.numberToString((row.value * 100).rounded() / 100)).font(.footnote).foregroundStyle(.secondary).monospacedDigit()
                    }
                }
            }
        case "badge":
            let color = tokenColor(ev("color")) ?? .primary
            Text(display(ev("value"))).font(.caption)
                .padding(.horizontal, 8).padding(.vertical, 2)
                .foregroundStyle(color)
                .overlay(Capsule().stroke(color, lineWidth: 1))
        case "divider":
            Divider()
        case "input":
            let label = ev("label"), placeholder = ev("placeholder")
            InputView(widget: widget, node: node, label: label.isNull ? nil : display(label),
                      placeholder: placeholder.isNull ? nil : display(placeholder), options: ev("options"))
        case "visible":
            if ev("when").truthy {
                VStack(alignment: .leading, spacing: 8) { kids() }
            }
        default:
            EmptyView() // unreachable for validated specs
        }
    }
}
