import GraftCore
import SwiftUI

/// The end-user "vibe" sheet: describe a feature → preview → add it to the app. Present it with `.sheet`.
public struct VibeSheet: View {
    @ObservedObject var graft: Graft
    let edit: WidgetSpec?
    let slotLabels: [String: String]
    @Environment(\.dismiss) private var dismiss

    @State private var prompt = ""
    @State private var selectedSlot: String?
    @State private var current: WidgetSpec?
    @State private var preview: WidgetSpec?
    @State private var previewData: [String: JSON] = [:]
    @State private var busy = false
    @State private var error: String?

    public init(graft: Graft, slot: String? = nil, edit: WidgetSpec? = nil, slotLabels: [String: String] = [:]) {
        self.graft = graft
        self.edit = edit
        self.slotLabels = slotLabels
        _selectedSlot = State(initialValue: edit?.slot ?? slot)
        _current = State(initialValue: edit)
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Describe what you want to see. You'll get a preview before anything is added.")
                        .font(.footnote).foregroundStyle(.secondary)
                    TextField(preview == nil && edit == nil ? "e.g. Show how much I spent on food this month" : "What should change?",
                              text: $prompt, axis: .vertical)
                        .lineLimit(3...6)
                        .textFieldStyle(.roundedBorder)
                        .disabled(busy)
                    if edit == nil, graft.slotIds.count > 1 {
                        Picker("Where", selection: $selectedSlot) {
                            Text("Let AI choose").tag(String?.none)
                            ForEach(graft.slotIds, id: \.self) { id in Text(slotLabels[id] ?? id).tag(String?.some(id)) }
                        }
                    }
                    if busy { ProgressView("Building your widget…") }
                    if let error { Text(error).font(.footnote).foregroundStyle(.red) }
                    if let preview {
                        // Live preview: the user can try the widget's inputs before adding it.
                        LiveWidgetView(graft: graft, spec: preview, data: previewData).id(preview)
                            .padding(8)
                            .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Color.accentColor, style: StrokeStyle(lineWidth: 1, dash: [4])))
                    }
                    HStack {
                        Spacer()
                        Button(preview == nil ? "Generate" : "Refine") { Task { await generate() } }
                            .buttonStyle(.bordered)
                            .disabled(busy || prompt.trimmingCharacters(in: .whitespaces).isEmpty)
                        if let preview {
                            Button(edit == nil ? "Add" : "Save") { Task { await accept(preview) } }
                                .buttonStyle(.borderedProminent)
                                .disabled(busy)
                        }
                    }
                }
                .padding()
            }
            .navigationTitle(edit.map { "Change “\($0.title)”" } ?? "Add a feature")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(busy) } }
        }
        .interactiveDismissDisabled(busy)
    }

    private func generate() async {
        busy = true
        error = nil
        defer { busy = false }
        do {
            let spec = try await graft.propose(prompt.trimmingCharacters(in: .whitespacesAndNewlines), slot: selectedSlot, edit: current)
            previewData = try await graft.snapshot()
            preview = spec
            current = spec
            prompt = ""
        } catch let e as GraftError {
            error = "\(e.message). Try rephrasing."
        } catch {
            self.error = "Something went wrong. Please try again."
        }
    }

    private func accept(_ spec: WidgetSpec) async {
        busy = true
        defer { busy = false }
        do {
            try await graft.accept(spec)
            dismiss()
        } catch {
            self.error = "Could not save the widget."
        }
    }
}

/// A button that opens `VibeSheet`, e.g. in a toolbar or as an overlay.
public struct VibeButton: View {
    @ObservedObject var graft: Graft
    let label: String
    let slotLabels: [String: String]
    @State private var open = false

    public init(graft: Graft, label: String = "Add feature", slotLabels: [String: String] = [:]) {
        self.graft = graft
        self.label = label
        self.slotLabels = slotLabels
    }

    public var body: some View {
        Button { open = true } label: { Label(label, systemImage: "sparkles") }
            .sheet(isPresented: $open) { VibeSheet(graft: graft, slotLabels: slotLabels) }
    }
}
