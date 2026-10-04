package dev.graft

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull

/** Small helpers over kotlinx.serialization's JSON tree, matching the semantics in spec/README.md. */
internal object J {
    fun isNull(e: JsonElement?) = e == null || e is JsonNull

    fun num(e: JsonElement?): Double? =
        (e as? JsonPrimitive)?.takeIf { !it.isString && it !is JsonNull }?.doubleOrNull?.takeIf { it.isFinite() }

    fun str(e: JsonElement?): String? = (e as? JsonPrimitive)?.takeIf { it.isString }?.content

    fun bool(e: JsonElement?): Boolean? = (e as? JsonPrimitive)?.takeIf { !it.isString && it !is JsonNull }?.booleanOrNull

    fun of(d: Double?): JsonElement = if (d == null) JsonNull else JsonPrimitive(d)
    fun of(s: String?): JsonElement = if (s == null) JsonNull else JsonPrimitive(s)
    fun of(b: Boolean): JsonElement = JsonPrimitive(b)

    fun truthy(e: JsonElement?): Boolean = when {
        isNull(e) -> false
        e is JsonArray -> e.isNotEmpty()
        e is JsonObject -> true
        bool(e) != null -> bool(e)!!
        num(e) != null -> num(e) != 0.0
        str(e) != null -> str(e)!!.isNotEmpty()
        else -> true
    }

    /** Shortest round-trip formatting, matching JavaScript's String(number) for common values. */
    fun numberToString(d: Double): String =
        if (d == Math.rint(d) && kotlin.math.abs(d) < 1e15) d.toLong().toString() else d.toString()

    fun stringify(e: JsonElement?): String = when {
        isNull(e) -> ""
        str(e) != null -> str(e)!!
        num(e) != null -> numberToString(num(e)!!)
        bool(e) != null -> bool(e).toString()
        else -> e.toString()
    }

    fun deepEqual(a: JsonElement?, b: JsonElement?): Boolean {
        if (isNull(a) || isNull(b)) return isNull(a) && isNull(b)
        val na = num(a)
        val nb = num(b)
        if (na != null || nb != null) return na != null && nb != null && na == nb
        return when (a) {
            is JsonArray -> b is JsonArray && a.size == b.size && a.indices.all { deepEqual(a[it], b[it]) }
            is JsonObject -> b is JsonObject && a.keys == b.keys && a.keys.all { deepEqual(a[it], b[it]) }
            else -> a == b
        }
    }

    fun getPath(root: JsonElement?, segments: List<String>): JsonElement? {
        var cur = root
        for (seg in segments) {
            cur = when (cur) {
                is JsonArray -> seg.toIntOrNull()?.takeIf { seg.all(Char::isDigit) }?.let { cur.getOrNull(it) } ?: return null
                is JsonObject -> cur[seg] ?: return null
                else -> return null
            }
        }
        return cur
    }
}
