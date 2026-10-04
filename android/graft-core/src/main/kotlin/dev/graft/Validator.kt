package dev.graft

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/** Component catalog: prop name -> kind. Keep in sync with spec/README.md §2.1 and packages/core/src/catalog.ts. */
internal object Catalog {
    sealed interface Kind
    data object Expr : Kind
    data object Color : Kind
    data object Number : Kind
    data object Signed : Kind
    data object Bool : Kind
    data object StateRef : Kind
    data object Node : Kind
    data object Children : Kind
    data class Enum(val values: List<String>) : Kind

    data class Prop(val kind: Kind, val required: Boolean = false, val iterates: Boolean = false)

    private val children = Prop(Children)
    private val color = Prop(Color)

    val components: Map<String, Map<String, Prop>> = mapOf(
        "card" to mapOf("title" to Prop(Expr), "children" to children),
        "column" to mapOf("gap" to Prop(Number), "children" to children),
        "row" to mapOf("gap" to Prop(Number), "align" to Prop(Enum(listOf("start", "center", "end", "spaceBetween"))), "children" to children),
        "text" to mapOf("value" to Prop(Expr, required = true), "style" to Prop(Enum(listOf("title", "body", "caption"))), "color" to color),
        "metric" to mapOf("label" to Prop(Expr, true), "value" to Prop(Expr, true), "caption" to Prop(Expr), "color" to color),
        "progress" to mapOf("value" to Prop(Expr, true), "max" to Prop(Expr), "label" to Prop(Expr)),
        "list" to mapOf("items" to Prop(Expr, true), "template" to Prop(Node, required = true, iterates = true), "empty" to Prop(Expr), "limit" to Prop(Number)),
        "barChart" to mapOf("items" to Prop(Expr, true), "max" to Prop(Expr)),
        "badge" to mapOf("value" to Prop(Expr, true), "color" to color),
        "divider" to emptyMap(),
        "input" to mapOf(
            "kind" to Prop(Enum(listOf("text", "number", "slider", "toggle", "select", "date")), required = true),
            "bind" to Prop(StateRef, required = true),
            "label" to Prop(Expr), "placeholder" to Prop(Expr),
            "min" to Prop(Signed), "max" to Prop(Signed), "step" to Prop(Signed),
            "options" to Prop(Expr), "multiline" to Prop(Bool),
        ),
        "visible" to mapOf("when" to Prop(Expr, true), "children" to children),
    )
}

sealed interface ValidationResult {
    data class Ok(val spec: WidgetSpec) : ValidationResult
    data class Invalid(val errors: List<String>) : ValidationResult
}

private val RESERVED = setOf("item", "index")
private val IDENT = Regex("^[A-Za-z_][A-Za-z0-9_]*$")
private val ISO_DATE = Regex("^\\d{4}-\\d{2}-\\d{2}$")

/** Statically validates an untrusted widget spec against the manifest and component catalog. */
fun validateSpec(input: JsonElement, manifest: Manifest): ValidationResult {
    val errors = mutableListOf<String>()
    fun err(path: String, msg: String) {
        if (errors.size < 50) errors += "$path: $msg"
    }
    val spec = input as? JsonObject ?: return ValidationResult.Invalid(listOf("spec: must be an object"))

    val version = J.num(spec["specVersion"])
    if (version != SPEC_VERSION.toDouble()) err("specVersion", "unsupported specVersion ${spec["specVersion"]}; expected $SPEC_VERSION")
    if (J.str(spec["id"]).isNullOrEmpty()) err("id", "must be a non-empty string")
    if (J.str(spec["title"]).isNullOrEmpty()) err("title", "must be a non-empty string")
    val slot = J.str(spec["slot"])
    if (slot == null || slot !in manifest.slots) err("slot", "unknown slot \"$slot\"; available: ${manifest.slots.keys.joinToString()}")

    val known = manifest.dataSources.keys.toMutableSet()

    // Widget-local state: named, literal initial values that inputs read and write.
    val state = spec["state"] as? JsonObject
    if (spec["state"] != null) {
        if (state == null) err("state", "must be an object of name -> initial value")
        else {
            if (state.size > Limits.MAX_STATE_ENTRIES) err("state", "at most ${Limits.MAX_STATE_ENTRIES} state entries")
            for ((name, v) in state) {
                if (!IDENT.matches(name)) err("state.$name", "state names must be identifiers")
                val literal = J.isNull(v) || J.bool(v) != null || J.num(v) != null || (J.str(v)?.let { it.length <= Limits.MAX_TEXT_LENGTH } ?: false)
                if (!literal) err("state.$name", "initial value must be a literal string, number, boolean or null")
            }
            if ("state" in manifest.dataSources) err("state", "conflicts with a data source named \"state\"")
            known += "state"
        }
    }

    fun checkExpr(e: JsonElement, path: String, inIter: Boolean) {
        if (e is JsonArray) return e.forEachIndexed { i, x -> checkExpr(x, "$path[$i]", inIter) }
        if (e !is JsonObject) return
        val (op, args) = Operators.asCall(e) ?: run {
            err(path, "object literals are not allowed; an expression object must have exactly one operator key")
            return
        }
        val arity = Operators.arity[op] ?: run { err(path, "unknown operator \"$op\""); return }
        if (args.size !in arity) {
            err(path, "\"$op\" takes ${arity.first}${if (arity.last == Int.MAX_VALUE) "+" else if (arity.last != arity.first) "-${arity.last}" else ""} arguments, got ${args.size}")
            return
        }
        if (op == "var") {
            val p = J.str(args[0]) ?: run { err(path, "var path must be a string literal"); return }
            val head = p.substringBefore(".")
            val ok = if (head in RESERVED) inIter else head in known
            if (!ok) err(path, "unknown variable \"$head\"; available here: ${(known + if (inIter) RESERVED else emptySet()).joinToString()}")
            args.getOrNull(1)?.let { checkExpr(it, "$path.var[1]", inIter) }
            return
        }
        val iterArgs = Operators.iteratorArgs[op] ?: emptySet()
        args.forEachIndexed { i, x -> checkExpr(x, "$path.$op[$i]", inIter || i in iterArgs) }
    }

    when (val b = spec["bindings"]) {
        null -> {}
        !is JsonObject -> err("bindings", "must be an object")
        else -> {
            if (b.size > Limits.MAX_BINDINGS) err("bindings", "at most ${Limits.MAX_BINDINGS} bindings")
            for ((name, expr) in b) {
                if (name in RESERVED || name == "state" || name in manifest.dataSources || !IDENT.matches(name)) {
                    err("bindings.$name", "invalid binding name (must be an identifier, not a data source name, item, index or state)")
                }
                checkExpr(expr, "bindings.$name", false)
                known += name
            }
        }
    }

    /** Cross-prop rules for inputs: per-kind required props and state value types. */
    fun checkInput(n: JsonObject, path: String, inIter: Boolean) {
        if (inIter) err(path, "inputs cannot be inside list templates")
        val kind = J.str(n["kind"])
        val initial = J.str(n["bind"])?.let { state?.get(it) }
        val numeric = kind == "number" || kind == "slider"
        for (p in listOf("min", "max", "step")) if (p in n && !numeric) err("$path.$p", "only applies to number and slider inputs")
        if ("placeholder" in n && kind != "text" && kind != "number") err("$path.placeholder", "only applies to text and number inputs")
        if ("multiline" in n && kind != "text") err("$path.multiline", "only applies to text inputs")
        if (("options" in n) != (kind == "select")) err("$path.options", if (kind == "select") "select inputs need options" else "only applies to select inputs")
        val min = J.num(n["min"])
        val max = J.num(n["max"])
        if (kind == "slider" && (min == null || max == null)) err(path, "slider inputs need min and max")
        if (min != null && max != null && min > max) err("$path.min", "min must be <= max")
        J.num(n["step"])?.let { if (it <= 0) err("$path.step", "step must be > 0") }
        if (initial == null) return
        val isNull = J.isNull(initial)
        val ok = when (kind) {
            "toggle" -> J.bool(initial) != null
            "slider" -> J.num(initial) != null
            "number" -> isNull || J.num(initial) != null
            "date" -> isNull || J.str(initial)?.let { ISO_DATE.matches(it) } == true
            "select" -> isNull || J.str(initial) != null || J.num(initial) != null
            else -> isNull || J.str(initial) != null
        }
        if (!ok) {
            val want = mapOf("toggle" to "a boolean", "slider" to "a number", "number" to "a number or null",
                "date" to "\"YYYY-MM-DD\" or null", "select" to "a string, number or null", "text" to "a string or null")[kind]
            err("$path.bind", "state \"${J.str(n["bind"])}\" must start as ${want ?: "a compatible value"} for a $kind input")
        }
    }

    var nodes = 0
    fun checkNode(n: JsonElement?, path: String, inIter: Boolean, depth: Int) {
        if (++nodes > Limits.MAX_NODES) {
            if (nodes == Limits.MAX_NODES + 1) err(path, "too many nodes (max ${Limits.MAX_NODES})")
            return
        }
        if (depth > Limits.MAX_DEPTH) return err(path, "max depth ${Limits.MAX_DEPTH} exceeded")
        val obj = n as? JsonObject
        val type = J.str(obj?.get("type")) ?: return err(path, "node must be an object with a string `type`")
        val props = Catalog.components[type]
            ?: return err(path, "unknown component \"$type\"; available: ${Catalog.components.keys.joinToString()}")
        for ((prop, value) in obj!!) {
            if (prop == "type") continue
            val pd = props[prop] ?: run { err("$path.$prop", "unknown prop for $type"); null } ?: continue
            val p = "$path.$prop"
            when (val k = pd.kind) {
                Catalog.Children ->
                    (value as? JsonArray)?.forEachIndexed { i, c -> checkNode(c, "$p[$i]", inIter, depth + 1) }
                        ?: err(p, "must be an array of nodes")
                Catalog.Node -> checkNode(value, p, inIter || pd.iterates, depth + 1)
                Catalog.Number -> if ((J.num(value) ?: -1.0) < 0) err(p, "must be a non-negative number literal")
                Catalog.Signed -> if (J.num(value) == null) err(p, "must be a number literal")
                Catalog.Bool -> if (J.bool(value) == null) err(p, "must be true or false")
                Catalog.StateRef -> {
                    val ref = J.str(value)
                    if (ref == null || state == null || ref !in state) {
                        err(p, "must name a declared state entry; declared: ${state?.keys?.joinToString()?.ifEmpty { "none" } ?: "none (add a top-level \"state\" object)"}")
                    }
                }
                Catalog.Color -> {
                    val s = J.str(value)
                    if (s != null) {
                        if (s !in COLOR_TOKENS) err(p, "color must be one of ${COLOR_TOKENS.joinToString()}")
                    } else checkExpr(value, p, inIter)
                }
                is Catalog.Enum -> if (J.str(value) !in k.values) err(p, "must be one of ${k.values.joinToString()}")
                Catalog.Expr -> checkExpr(value, p, inIter)
            }
        }
        for ((prop, pd) in props) if (pd.required && prop !in obj) err("$path.$prop", "required prop \"$prop\" missing on $type")
        if (type == "list" && (J.num(obj["limit"]) ?: 0.0) > Limits.MAX_LIST_LIMIT) err("$path.limit", "limit must be <= ${Limits.MAX_LIST_LIMIT}")
        if (type == "input") checkInput(obj, path, inIter)
    }

    if (spec["root"] == null) err("root", "missing") else checkNode(spec["root"], "root", false, 1)
    return if (errors.isEmpty()) ValidationResult.Ok(WidgetSpec(spec)) else ValidationResult.Invalid(errors)
}
