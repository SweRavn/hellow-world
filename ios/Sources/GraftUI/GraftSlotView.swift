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

    @State private var data: [String: JSON]?
    @State private var editing: WidgetSpec?
    @State private var removing: WidgetSpec?

    public init(graft: Graft, slot: String, editable: Bool = true) {
        self.graft = graft
        self.slot = slot
        self.editable = editable
    }

    private struct RefreshKey: Equatable {
        let widgets: [WidgetSpec]
        let dataVersion: Int
    }

    public var body: some View {
        VStack(spacing: 12) {
            if let data {
                ForEach(graft.slotWidgets(slot)) { spec in
                    ZStack(alignment: .topTrailing) {
                        // .id(spec): an edited spec is a new view, so its input state starts fresh.
                        LiveWidgetView(graft: graft, spec: spec, data: data).id(spec)
                        if editable {
                            Menu {
                                Button("Change…") { editing = spec }
                                Button("Remove", role: .destructive) { removing = spec }
                            } label: {
                                Image(systemName: "ellipsis.circle").foregroundStyle(.secondary).padding(8)
                            }
                            .accessibilityLabel("Options for \(spec.title)")
                        }
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
        guard !graft.slotWidgets(slot).isEmpty else { return }
        // On failure keep the previous snapshot; with none, nothing is shown.
        if let snapshot = try? await graft.snapshot() { data = snapshot }
    }
}
