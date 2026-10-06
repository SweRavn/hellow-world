package dev.graft

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonObject
import java.net.HttpURLConnection
import java.net.URL

/** A piece of app data exposed to generated widgets. Call [Graft.notifyDataChanged] when it changes. */
class DataSource(
    val description: String,
    val schema: SchemaNode,
    /** Optional small, non-sensitive example sent to the generator. */
    val sample: JsonElement? = null,
    val get: suspend () -> JsonElement,
) {
    companion object {
        /** Exposes any @Serializable value, e.g. `DataSource.of("Orders", schema) { repo.orders() }`. */
        inline fun <reified T> of(description: String, schema: SchemaNode, sample: T? = null, noinline get: suspend () -> T) =
            DataSource(description, schema, sample?.let { GraftJson.encodeToJsonElement(it) }) { GraftJson.encodeToJsonElement(get()) }
    }
}

@Serializable
data class GenerateRequest(
    val prompt: String,
    val manifest: Manifest,
    val specVersion: Int = SPEC_VERSION,
    val slot: String? = null,
    val existing: JsonObject? = null,
)

/** Turns a request into an (untrusted) widget spec, usually by calling your backend. */
fun interface Generator {
    suspend fun generate(request: GenerateRequest): JsonElement
}

/** Persists accepted widgets. Implement it to sync per user through your backend. */
interface WidgetStore {
    suspend fun load(): List<JsonElement>
    suspend fun save(widgets: List<WidgetSpec>)
}

class MemoryStore : WidgetStore {
    private var saved: List<JsonElement> = emptyList()
    override suspend fun load() = saved
    override suspend fun save(widgets: List<WidgetSpec>) {
        saved = widgets.map { it.json }
    }
}

class GraftException(message: String, val details: List<String> = emptyList()) : Exception(message)

/** Calls a Graft generator backend (see server/ in the repo) over HTTP. */
class HttpGenerator(
    private val url: String,
    private val headers: suspend () -> Map<String, String> = { emptyMap() },
) : Generator {
    override suspend fun generate(request: GenerateRequest): JsonElement {
        val extraHeaders = headers()
        return withContext(Dispatchers.IO) {
            val conn = URL(url).openConnection() as HttpURLConnection
            try {
                conn.requestMethod = "POST"
                conn.doOutput = true
                conn.connectTimeout = 15_000
                conn.readTimeout = 180_000
                conn.setRequestProperty("content-type", "application/json")
                extraHeaders.forEach { (k, v) -> conn.setRequestProperty(k, v) }
                conn.outputStream.use { it.write(GraftJson.encodeToString(GenerateRequest.serializer(), request).toByteArray()) }
                val ok = conn.responseCode in 200..299
                val text = (if (ok) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() } ?: "{}"
                val body = runCatching { GraftJson.parseToJsonElement(text).jsonObject }.getOrDefault(JsonObject(emptyMap()))
                body["spec"]?.takeIf { ok } ?: throw GraftException(
                    J.str(body["error"]) ?: "generator returned HTTP ${conn.responseCode}",
                    (body["details"] as? JsonArray)?.mapNotNull { J.str(it) } ?: emptyList(),
                )
            } finally {
                conn.disconnect()
            }
        }
    }
}

/** A spec bound to a data snapshot and the widget's current input [state], ready to render. */
class BoundWidget(
    val spec: WidgetSpec,
    val state: Map<String, JsonElement>,
    private val vars: Map<String, JsonElement>,
    private val formatter: Formatter,
) {
    fun eval(expr: JsonElement?, scope: ItemScope? = null): JsonElement =
        if (expr == null) JsonNull else Evaluator(vars, formatter).evaluate(expr, scope)
}

/**
 * Platform-neutral Graft engine. The Compose module renders [widgets] into `GraftSlot`s.
 *
 *     val graft = Graft(AppInfo("Budgetly"), HttpGenerator("https://api.example.com/graft/generate"))
 *     graft.addDataSource("transactions", DataSource.of("Card transactions", schema) { repo.transactions() })
 *     graft.addSlot("home.top", SlotInfo("Top of the home screen"))
 *     graft.init()
 *     val spec = graft.propose("show food spend this month")   // preview, then
 *     graft.accept(spec)
 */
class Graft(
    private val app: AppInfo,
    private val generator: Generator,
    private val store: WidgetStore = MemoryStore(),
    private val theme: Theme? = null,
    val formatter: Formatter = DefaultFormatter(theme),
) {
    private val sources = LinkedHashMap<String, DataSource>()
    private val slots = LinkedHashMap<String, SlotInfo>()
    private val _widgets = MutableStateFlow<List<WidgetSpec>>(emptyList())
    private val _dataVersion = MutableStateFlow(0L)

    /** All accepted widgets. */
    val widgets: StateFlow<List<WidgetSpec>> = _widgets.asStateFlow()

    /** Incremented by [notifyDataChanged]; renderers re-snapshot data when it changes. */
    val dataVersion: StateFlow<Long> = _dataVersion.asStateFlow()

    fun addDataSource(name: String, source: DataSource) = apply {
        require(Regex("^[A-Za-z_][A-Za-z0-9_]*$").matches(name) && name != "state") { "invalid data source name \"$name\"" }
        sources[name] = source
    }

    fun addSlot(id: String, info: SlotInfo) = apply { slots[id] = info }

    val slotIds: List<String> get() = slots.keys.toList()

    fun notifyDataChanged() = _dataVersion.update { it + 1 }

    /** Loads persisted widgets, dropping any that no longer validate. */
    suspend fun init() {
        val m = manifest()
        _widgets.value = store.load().mapNotNull { (validateSpec(it, m) as? ValidationResult.Ok)?.spec }
    }

    fun manifest() = Manifest(
        app = app,
        dataSources = sources.mapValues { (_, s) -> DataSourceInfo(s.description, s.schema, s.sample) },
        slots = slots.toMap(),
        theme = theme,
    )

    /** Generates and validates a widget. Does not persist it: preview it, then call [accept]. */
    suspend fun propose(prompt: String, slot: String? = null, edit: WidgetSpec? = null): WidgetSpec {
        val m = manifest()
        val raw = generator.generate(GenerateRequest(prompt, m, SPEC_VERSION, slot, edit?.json))
        var spec = when (val r = validateSpec(raw, m)) {
            is ValidationResult.Ok -> r.spec
            is ValidationResult.Invalid -> throw GraftException("The generated widget was invalid", r.errors)
        }
        if (edit != null) spec = spec.with("id", JsonPrimitive(edit.id))
        else if (_widgets.value.any { it.id == spec.id }) spec = spec.with("id", JsonPrimitive("${spec.id}_${System.currentTimeMillis().toString(36)}"))
        if (spec.prompt == null) spec = spec.with("prompt", JsonPrimitive(prompt))
        return spec
    }

    suspend fun accept(spec: WidgetSpec) {
        if (validateSpec(spec.json, manifest()) is ValidationResult.Invalid) throw GraftException("Widget is invalid")
        _widgets.update { list -> if (list.any { it.id == spec.id }) list.map { if (it.id == spec.id) spec else it } else list + spec }
        store.save(_widgets.value)
    }

    suspend fun remove(id: String) {
        _widgets.update { list -> list.filterNot { it.id == id } }
        store.save(_widgets.value)
    }

    fun widgetsFor(slot: String, all: List<WidgetSpec> = _widgets.value): List<WidgetSpec> {
        val list = all.filter { it.slot == slot }
        return slots[slot]?.maxWidgets?.let { list.takeLast(it) } ?: list
    }

    /** Headless controller for one widget: view tree + input getters/setters for any UI toolkit. */
    fun controller(spec: WidgetSpec, data: Map<String, JsonElement>, state: Map<String, JsonElement> = Inputs.initialState(spec)) =
        WidgetController(this, spec, data, state)

    suspend fun snapshot(): Map<String, JsonElement> = sources.mapValues { (_, s) -> s.get() }

    /**
     * Resolves bindings against a data snapshot and the widget's input [state] (defaults to its
     * initial values). Throws [EvalException] if the budget is exceeded.
     */
    fun bind(spec: WidgetSpec, data: Map<String, JsonElement>, state: Map<String, JsonElement> = Inputs.initialState(spec)): BoundWidget {
        val scope = if (spec.state != null) data + ("state" to JsonObject(state)) else data
        return BoundWidget(spec, state, resolveBindings(spec.bindings, scope, formatter), formatter)
    }
}
