import GraftCore
import SwiftUI

/**
 Place this where generated widgets may appear. It re-renders when widgets change or when the host
 calls `graft.notifyDataChanged()`.

     VStack {
         BalanceHeader()
         GraftSlotView(graft: graft, slot: "home.top")
         TransactionList()
     }
 */
public struct GraftSlotView: View {
    @ObservedObject var graft: Graft
    let slot: String
    let editable: Bool

    @State private var bound: [Entry] = []
    @State private var editing: WidgetSpec?
    @State private var removing: WidgetSpec?

    public init(graft: Graft, slot: String, editable: Bool = true) {
        self.graft = graft
        self.slot = slot
        self.editable = editable
    }

    private struct Entry: Identifiable {
        let spec: WidgetSpec
        let widget: BoundWidget?
        var id: String { spec.id }
    }

    private struct RefreshKey: Equatable {
        let widgets: [WidgetSpec]
        let dataVersion: Int
    }

    public var body: some View {
        VStack(spacing: 12) {
            ForEach(bound) { entry in
                ZStack(alignment: .topTrailing) {
                    if let w = entry.widget {
                        WidgetView(w)
                    } else {
                        Text("“\(entry.spec.title)” could not be shown.").font(.footnote).foregroundStyle(.red)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    if editable {
                        Menu {
                            Button("Change…") { editing = entry.spec }
                            Button("Remove", role: .destructive) { removing = entry.spec }
                        } label: {
                            Image(systemName: "ellipsis.circle").foregroundStyle(.secondary).padding(8)
                        }
                        .accessibilityLabel("Options for \(entry.spec.title)")
                    }
                }
            }
        }
        .task(id: RefreshKey(widgets: graft.slotWidgets(slot), dataVersion: graft.dataVersion)) { await refresh() }
        .sheet(item: $editing) { spec in VibeSheet(graft: graft, slot: slot, edit: spec) }
        .confirmationDialog("Remove “\(removing?.title ?? "")”?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button("Remove", role: .destructive) {
                if let id = removing?.id { Task { await graft.remove(id) } }
                removing = nil
            }
        }
    }

    private func refresh() async {
        let specs = graft.slotWidgets(slot)
        guard !specs.isEmpty, let data = try? await graft.snapshot() else {
            bound = specs.map { Entry(spec: $0, widget: nil) }
            return
        }
        bound = specs.map { spec in Entry(spec: spec, widget: try? graft.bind(spec, data: data)) }
    }
}
