package dev.graft

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/*
 * Headless view layer. Graft evaluates a widget into a tree of plain, display-ready nodes; any UI
 * toolkit (Compose, Android views, ...) renders it with its own components. Input nodes carry a getter
 * (`value`) and a setter (`set`). Canonical shape: spec/README.md §7; graft-compose is one adapter.
 */

data class Bar(val label: String, val value: Double, val fraction: Double)

sealed interface ViewNode {
    /** Stable identity (the node's path in the spec). Use it as the key in your UI toolkit. */
    val key: String

    data class Card(override val key: String, val title: String?, val children: List<ViewNode>) : ViewNode
    data class Column(override val key: String, val gap: Double?, val children: List<ViewNode>) : ViewNode
    data class Row(override val key: String, val gap: Double?, val align: String, val children: List<ViewNode>) : ViewNode
    data class Text(override val key: String, val text: String, val style: String, val color: String) : ViewNode
    data class Metric(override val key: String, val label: String, val value: String, val caption: String?, val color: String) : ViewNode
    data class Progress(override val key: String, val label: String?, val value: Double, val max: Double, val fraction: Double) : ViewNode
    data class ListNode(override val key: String, val items: List<ViewNode>, val empty: String?) : ViewNode
    data class BarChart(override val key: String, val bars: List<Bar>) : ViewNode
    data class Badge(override val key: String, val text: String, val color: String) : ViewNode
    data class Divider(override val key: String) : ViewNode

    class Input(
        override val key: String,
        val kind: String,
        /** Name of the state entry this input edits. */
        val name: String,
        val label: String?,
        val placeholder: String?,
        val min: Double?,
        val max: Double?,
        val step: Double?,
        val multiline: Boolean,
        /** Choices for `select`; empty for other kinds. */
        val options: List<SelectOption>,
        /** Getter: the current (coerced) value. */
        val value: JsonElement,
        private val setter: (JsonElement) -> Unit,
    ) : ViewNode {
        /** Setter: pass the raw value from your control; Graft coerces it, updates state and recomputes. */
        fun set(raw: JsonElement) = setter(raw)
        fun set(raw: String) = setter(JsonPrimitive(raw))
        fun set(raw: Number) = setter(JsonPrimitive(raw))
        fun set(raw: Boolean) = setter(JsonPrimitive(raw))
    }
}

/** Display text for any value: null → "", numbers in shortest form, objects as JSON. */
fun displayText(v: JsonElement): String = J.stringify(v)

/**
 * Evaluates a bound widget into a view tree. [onSet] receives (state name, coerced value) from input
 * setters. Expression errors inside a prop degrade to null.
 */
fun resolveView(w: BoundWidget, onSet: ((String, JsonElement) -> Unit)? = null): ViewNode {
    fun ev(n: JsonObject, key: String, scope: ItemScope?): JsonElement =
        runCatching { w.eval(n[key], scope) }.getOrDefault(JsonNull)
    fun opt(v: JsonElement): String? = if (J.isNull(v)) null else displayText(v)
    fun color(v: JsonElement) = J.str(v)?.takeIf { it in COLOR_TOKENS } ?: "default"
    fun lit(n: JsonObject, key: String) = J.num(n[key])
    fun frac(value: Double, max: Double) = if (max > 0) (value / max).coerceIn(0.0, 1.0) else 0.0

    lateinit var many: (JsonObject, ItemScope?, String) -> List<ViewNode>
    fun kids(n: JsonObject, scope: ItemScope?, key: String): List<ViewNode> =
        (n["children"] as? JsonArray).orEmpty().withIndex().flatMap { (i, c) -> many(c as JsonObject, scope, "$key.$i") }

    fun one(n: JsonObject, scope: ItemScope?, key: String): ViewNode = when (J.str(n["type"])) {
        "card" -> ViewNode.Card(key, opt(ev(n, "title", scope)), kids(n, scope, key))
        "column" -> ViewNode.Column(key, lit(n, "gap"), kids(n, scope, key))
        "row" -> ViewNode.Row(key, lit(n, "gap"), J.str(n["align"]) ?: "start", kids(n, scope, key))
        "text" -> ViewNode.Text(key, displayText(ev(n, "value", scope)), J.str(n["style"]) ?: "body", color(ev(n, "color", scope)))
        "metric" -> {
            val caption = ev(n, "caption", scope)
            ViewNode.Metric(
                key, displayText(ev(n, "label", scope)), displayText(ev(n, "value", scope)),
                if (J.isNull(caption) || J.str(caption) == "") null else displayText(caption), color(ev(n, "color", scope)),
            )
        }
        "progress" -> {
            val value = J.num(ev(n, "value", scope)) ?: 0.0
            val max = J.num(ev(n, "max", scope)) ?: 1.0
            ViewNode.Progress(key, opt(ev(n, "label", scope)), value, max, frac(value, max))
        }
        "list" -> {
            val arr = ev(n, "items", scope) as? JsonArray ?: JsonArray(emptyList())
            val limit = minOf(lit(n, "limit")?.toInt() ?: Limits.MAX_LIST_LIMIT, Limits.MAX_LIST_LIMIT)
            val template = n["template"] as JsonObject
            ViewNode.ListNode(
                key,
                arr.take(limit).withIndex().flatMap { (i, item) -> many(template, ItemScope(item, i), "$key.$i") },
                if (arr.isEmpty()) opt(ev(n, "empty", scope)) else null,
            )
        }
        "barChart" -> {
            val rows = ((ev(n, "items", scope) as? JsonArray) ?: JsonArray(emptyList())).take(Limits.MAX_LIST_LIMIT).map {
                val o = it as? JsonObject
                displayText(o?.get("label") ?: JsonNull) to (J.num(o?.get("value")) ?: 0.0)
            }
            val max = J.num(ev(n, "max", scope)) ?: maxOf(0.0, rows.maxOfOrNull { it.second } ?: 0.0)
            ViewNode.BarChart(key, rows.map { (l, v) -> Bar(l, v, frac(v, max)) })
        }
        "badge" -> ViewNode.Badge(key, displayText(ev(n, "value", scope)), color(ev(n, "color", scope)))
        "divider" -> ViewNode.Divider(key)
        "input" -> {
            val kind = J.str(n["kind"])!!
            val name = J.str(n["bind"])!!
            val bounds = InputBounds.of(n)
            ViewNode.Input(
                key, kind, name, opt(ev(n, "label", scope)), opt(ev(n, "placeholder", scope)),
                bounds.min, bounds.max, bounds.step, J.bool(n["multiline"]) == true,
                if (kind == "select") Inputs.options(ev(n, "options", scope)) else emptyList(),
                w.state[name] ?: JsonNull,
            ) { raw -> onSet?.invoke(name, Inputs.coerce(kind, raw, bounds)) }
        }
        else -> ViewNode.Column(key, null, emptyList()) // unreachable for validated specs
    }

    // `visible` has no node of its own: when true its children are spliced into the parent.
    many = { n, scope, key ->
        if (J.str(n["type"]) == "visible") {
            if (!J.truthy(ev(n, "when", scope))) emptyList() else kids(n, scope, key)
        } else listOf(one(n, scope, key))
    }

    val roots = many(w.spec.root, null, "root")
    return roots.singleOrNull() ?: ViewNode.Column("root", null, roots)
}

/** Canonical JSON form of a view tree (setters dropped), as used by the conformance vectors. */
fun ViewNode.toJson(): JsonObject {
    fun s(v: String?) = J.of(v)
    fun d(v: Double?) = J.of(v)
    val fields: Map<String, JsonElement> = when (this) {
        is ViewNode.Card -> mapOf("title" to s(title), "children" to JsonArray(children.map { it.toJson() }))
        is ViewNode.Column -> mapOf("gap" to d(gap), "children" to JsonArray(children.map { it.toJson() }))
        is ViewNode.Row -> mapOf("gap" to d(gap), "align" to s(align), "children" to JsonArray(children.map { it.toJson() }))
        is ViewNode.Text -> mapOf("text" to s(text), "style" to s(style), "color" to s(color))
        is ViewNode.Metric -> mapOf("label" to s(label), "value" to s(value), "caption" to s(caption), "color" to s(color))
        is ViewNode.Progress -> mapOf("label" to s(label), "value" to d(value), "max" to d(max), "fraction" to d(fraction))
        is ViewNode.ListNode -> mapOf("items" to JsonArray(items.map { it.toJson() }), "empty" to s(empty))
        is ViewNode.BarChart -> mapOf("bars" to JsonArray(bars.map {
            JsonObject(mapOf("label" to s(it.label), "value" to d(it.value), "fraction" to d(it.fraction)))
        }))
        is ViewNode.Badge -> mapOf("text" to s(text), "color" to s(color))
        is ViewNode.Divider -> emptyMap()
        is ViewNode.Input -> mapOf(
            "kind" to s(kind), "name" to s(name), "label" to s(label), "placeholder" to s(placeholder),
            "min" to d(min), "max" to d(max), "step" to d(step), "multiline" to J.of(multiline),
            "options" to JsonArray(options.map { JsonObject(mapOf("label" to s(it.label), "value" to it.value)) }),
            "value" to value,
        )
    }
    val type = when (this) {
        is ViewNode.Card -> "card"; is ViewNode.Column -> "column"; is ViewNode.Row -> "row"; is ViewNode.Text -> "text"
        is ViewNode.Metric -> "metric"; is ViewNode.Progress -> "progress"; is ViewNode.ListNode -> "list"
        is ViewNode.BarChart -> "barChart"; is ViewNode.Badge -> "badge"; is ViewNode.Divider -> "divider"; is ViewNode.Input -> "input"
    }
    return JsonObject(mapOf("type" to s(type), "key" to s(key)) + fields)
}

/**
 * Headless controller for one widget: owns its input state, recomputes the view tree when an input is
 * set or the data changes, and publishes it as [view]. Collect it from any UI toolkit.
 */
class WidgetController(
    private val graft: Graft,
    val spec: WidgetSpec,
    data: Map<String, JsonElement>,
    state: Map<String, JsonElement> = Inputs.initialState(spec),
) {
    private var data = data
    private val _state = MutableStateFlow(state)
    private val _view = MutableStateFlow<ViewNode?>(null)
    private val _error = MutableStateFlow<String?>(null)

    /** Current view tree, or null when the widget can't be computed (see [error]). */
    val view: StateFlow<ViewNode?> = _view.asStateFlow()
    val error: StateFlow<String?> = _error.asStateFlow()
    val state: StateFlow<Map<String, JsonElement>> = _state.asStateFlow()

    init {
        recompute()
    }

    /** Sets an input value by state name (already coerced, e.g. via [Inputs.coerce]). */
    fun set(name: String, value: JsonElement) {
        _state.value = _state.value + (name to value)
        recompute()
    }

    fun setData(data: Map<String, JsonElement>) {
        this.data = data
        recompute()
    }

    private fun recompute() {
        try {
            _view.value = resolveView(graft.bind(spec, data, _state.value), ::set)
            _error.value = null
        } catch (e: EvalException) {
            _view.value = null
            _error.value = "too much data to compute"
        }
    }
}
