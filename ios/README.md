# Graft for iOS

Swift package with two products:

- **`GraftCore`** (Foundation only): an ordered JSON model with its own parser (spec bindings are order-sensitive),
  the expression engine, validator, `Graft` engine (`ObservableObject`), `HttpGenerator` and `UserDefaultsStore`.
- **`GraftUI`** (SwiftUI, iOS 16+): `GraftSlotView`, `WidgetView`, `VibeSheet` and `VibeButton`.

`swift test` runs the shared conformance vectors from `../spec/conformance`.

## Usage

```swift
import GraftCore
import GraftUI

struct Tx: Encodable { let merchant: String; let amount: Double; let category: String; let date: Date }

@MainActor
let graft: Graft = {
    let g = Graft(
        app: AppInfo("Budgetly", description: "Personal expense tracker"),
        generator: HttpGenerator(url: URL(string: "https://api.example.com/v1/generate")!) { ["authorization": "Bearer \(Session.token)"] },
        store: UserDefaultsStore(),
        theme: Theme(currency: "EUR", locale: "sv_SE")
    )
    g.addDataSource("transactions", .encodable("The user's card transactions, newest first",
        schema: SchemaNode("array", items: SchemaNode("object", properties: [
            "merchant": SchemaNode("string"),
            "amount": SchemaNode("number", description: "Spend in EUR"),
            "category": SchemaNode("string"),
            "date": SchemaNode("string", format: "date-time"),
        ]))) { await TransactionStore.shared.all })
    g.addSlot("home.top", SlotInfo("Home screen under the balance, full width", maxWidgets: 3))
    return g
}()

struct HomeView: View {
    @ObservedObject var store: TransactionStore
    var body: some View {
        ScrollView {
            BalanceHeader()
            GraftSlotView(graft: graft, slot: "home.top")
            TransactionList()
        }
        .toolbar { VibeButton(graft: graft) }
        .task { await graft.load() }
        .onChange(of: store.version) { _ in graft.notifyDataChanged() }
    }
}
```
