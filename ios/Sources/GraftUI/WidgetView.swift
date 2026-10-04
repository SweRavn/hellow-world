import GraftCore
import SwiftUI

/*
 Optional SwiftUI adapter over Graft's headless view tree (GraftCore's ViewNode and WidgetController).
 Apps on UIKit or another design system render ViewNode with their own views instead.
 */

func tokenColor(_ token: String) -> Color? {
    switch token {
    case "muted": return .secondary
    case "accent": return .accentColor
    case "positive": return .green
    case "negative": return .red
    case "warning": return .orange
    default: return nil
    }
}

/// Renders a headless view tree with native SwiftUI views.
public struct GraftView: View {
    let node: ViewNode

    public init(_ node: ViewNode) { self.node = node }

    public var body: some View {
        switch node {
        case .card(_, let title, let children):
            VStack(alignment: .leading, spacing: 10) {
                if let title { Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary) }
                Children(nodes: children)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 12).fill(Color(white: 0.5, opacity: 0.08)))
        case .column(_, let gap, let children):
            VStack(alignment: .leading, spacing: CGFloat(gap ?? 8)) { Children(nodes: children) }
        case .row(_, let gap, let align, let children):
            HStack(spacing: CGFloat(gap ?? 8)) {
                if align == "center" || align == "end" { Spacer(minLength: 0) }
                ForEach(Array(children.enumerated()), id: \.element.key) { i, child in
                    if align == "spaceBetween", i > 0 { Spacer(minLength: CGFloat(gap ?? 8)) }
                    GraftView(child)
                }
                if align == "center" || align == "start" { Spacer(minLength: 0) }
            }
        case .text(_, let text, let style, let color):
            Text(text)
                .font(style == "title" ? .headline : style == "caption" ? .caption : .body)
                .foregroundStyle(tokenColor(color) ?? .primary)
        case .metric(_, let label, let value, let caption, let color):
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.footnote).foregroundStyle(.secondary)
                Text(value).font(.title.bold()).monospacedDigit().foregroundStyle(tokenColor(color) ?? .primary)
                if let caption { Text(caption).font(.caption).foregroundStyle(.secondary) }
            }
        case .progress(_, let label, let value, let max, let fraction):
            VStack(alignment: .leading, spacing: 4) {
                if let label { Text(label).font(.footnote) }
                ProgressView(value: fraction).tint(value > max ? .red : .accentColor)
            }
        case .list(_, let items, let empty):
            VStack(alignment: .leading, spacing: 6) {
                if let empty { Text(empty).font(.footnote).foregroundStyle(.secondary) }
                Children(nodes: items)
            }
        case .barChart(_, let bars):
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(bars.enumerated()), id: \.offset) { _, bar in
                    HStack(spacing: 8) {
                        Text(bar.label).font(.footnote).lineLimit(1).frame(width: 96, alignment: .leading)
                        ProgressView(value: bar.fraction)
                        Text(displayText(.number((bar.value * 100).rounded() / 100))).font(.footnote).foregroundStyle(.secondary).monospacedDigit()
                    }
                }
            }
        case .badge(_, let text, let color):
            let c = tokenColor(color) ?? .primary
            Text(text).font(.caption)
                .padding(.horizontal, 8).padding(.vertical, 2)
                .foregroundStyle(c)
                .overlay(Capsule().stroke(c, lineWidth: 1))
        case .divider:
            Divider()
        case .input(let input):
            InputControl(input: input)
        }
    }
}

struct Children: View {
    let nodes: [ViewNode]
    var body: some View {
        ForEach(nodes, id: \.key) { GraftView($0) }
    }
}
