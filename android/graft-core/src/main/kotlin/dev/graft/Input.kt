package dev.graft

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlin.math.roundToLong

/** Numeric bounds for number and slider inputs. */
data class InputBounds(val min: Double? = null, val max: Double? = null, val step: Double? = null) {
    companion object {
        fun of(node: JsonObject) = InputBounds(J.num(node["min"]), J.num(node["max"]), J.num(node["step"]))
    }
}

data class SelectOption(val label: String, val value: JsonElement)

/** Input semantics shared by every renderer; matches spec/conformance/inputs.json. */
object Inputs {
    private val NUMBER = Regex("^[-+]?(\\d+\\.?\\d*|\\.\\d+)([eE][-+]?\\d+)?$")
    private val DATE = Regex("^(\\d{4})-(\\d{2})-(\\d{2})")

    /** Starting state of a widget: its declared initial values. */
    fun initialState(spec: WidgetSpec): Map<String, JsonElement> = spec.state?.toMap() ?: emptyMap()

    private fun clean(x: Double) = (x * 1e10).roundToLong() / 1e10

    private fun parseNumber(raw: JsonElement): Double? {
        J.num(raw)?.let { return it }
        val s = J.str(raw)?.trim()?.replaceFirst(",", ".") ?: return null
        if (s.isEmpty() || !NUMBER.matches(s)) return null
        return s.toDoubleOrNull()?.takeIf { it.isFinite() }
    }

    /** Converts a raw value from a platform control into the value stored in widget state. */
    fun coerce(kind: String, raw: JsonElement, bounds: InputBounds = InputBounds()): JsonElement = when (kind) {
        "text" -> when {
            J.isNull(raw) -> JsonNull
            raw is JsonObject || raw is kotlinx.serialization.json.JsonArray -> J.of("")
            else -> J.of(J.stringify(raw).take(Limits.MAX_TEXT_LENGTH))
        }
        "number" -> J.of(parseNumber(raw))
        "slider" -> {
            val min = bounds.min ?: 0.0
            val max = bounds.max ?: 1.0
            var n = parseNumber(raw) ?: min
            bounds.step?.takeIf { it > 0 }?.let { n = min + Math.round((n - min) / it) * it }
            J.of(clean(n.coerceIn(min, max)))
        }
        "toggle" -> J.of(J.bool(raw) ?: J.truthy(raw))
        "select" -> if (J.str(raw) != null || J.num(raw) != null) raw else JsonNull
        "date" -> {
            val m = J.str(raw)?.let { DATE.find(it) }
            val month = m?.groupValues?.get(2)?.toInt() ?: 0
            val day = m?.groupValues?.get(3)?.toInt() ?: 0
            if (m != null && month in 1..12 && day in 1..31) J.of(m.value) else JsonNull
        }
        else -> JsonNull
    }

    /** Normalizes select options: strings/numbers become {label, value}; objects need a value. */
    fun options(options: JsonElement): List<SelectOption> {
        val list = options as? kotlinx.serialization.json.JsonArray ?: return emptyList()
        return list.take(Limits.MAX_LIST_LIMIT).mapNotNull { o ->
            when {
                J.str(o) != null || J.num(o) != null -> SelectOption(J.stringify(o), o)
                o is JsonObject -> o["value"]?.takeIf { J.str(it) != null || J.num(it) != null }?.let { v ->
                    val l = o["label"]
                    SelectOption(if (J.str(l) != null || J.num(l) != null) J.stringify(l) else J.stringify(v), v)
                }
                else -> null
            }
        }
    }
}
