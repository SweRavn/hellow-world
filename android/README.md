# Graft for Android

Two modules:

- **`graft-core`**: pure Kotlin/JVM. Spec model, expression engine, validator, the `Graft` engine, `HttpGenerator`.
  It is tested against the shared vectors in `../spec/conformance` with `./gradlew :graft-core:test`.
- **`graft-compose`**: Jetpack Compose (Material 3). `GraftSlot`, `RenderWidget`, `VibeSheet`, `VibeButton` and
  `SharedPreferencesStore`. It is included in the build only when an Android SDK is available (`ANDROID_HOME` or `local.properties`).

## Usage

```kotlin
@Serializable data class Tx(val merchant: String, val amount: Double, val category: String, val date: String)

val graft = Graft(
    app = AppInfo("Budgetly", "Personal expense tracker"),
    generator = HttpGenerator("https://api.example.com/v1/generate") { mapOf("authorization" to "Bearer ${session.token}") },
    store = SharedPreferencesStore(context),
    theme = Theme(currency = "EUR", locale = "sv-SE"),
)
    .addDataSource("transactions", DataSource.of(
        "The user's card transactions, newest first",
        SchemaNode("array", items = SchemaNode("object", properties = mapOf(
            "merchant" to SchemaNode("string"),
            "amount" to SchemaNode("number", description = "Spend in EUR"),
            "category" to SchemaNode("string"),
            "date" to SchemaNode("string", format = "date-time"),
        ))),
    ) { repository.transactions() })
    .addSlot("home.top", SlotInfo("Home screen under the balance, full width", maxWidgets = 3))

// once, e.g. in your ViewModel
viewModelScope.launch { graft.init() }
// whenever app data changes
repository.changes.onEach { graft.notifyDataChanged() }.launchIn(viewModelScope)
```

```kotlin
Scaffold(floatingActionButton = { VibeButton(graft) }) { padding ->
    Column(Modifier.padding(padding)) {
        BalanceHeader()
        GraftSlot(graft, "home.top")
        TransactionList()
    }
}
```

Widgets use `MaterialTheme` colors and typography, so they match your app.
