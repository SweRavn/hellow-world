package dev.graft

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.temporal.ChronoUnit
import java.time.temporal.TemporalAdjusters
import java.time.DayOfWeek
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.pow

/** Operator arities, shared by evaluator and validator. Keep in sync with spec/README.md §3. */
object Operators {
    private const val N = Int.MAX_VALUE
    val arity: Map<String, IntRange> = mapOf(
        "var" to 1..2, "+" to 1..N, "-" to 1..2, "*" to 1..N, "/" to 2..2, "%" to 2..2, "round" to 1..2,
        "==" to 2..2, "!=" to 2..2, ">" to 2..2, ">=" to 2..2, "<" to 2..2, "<=" to 2..2,
        "and" to 1..N, "or" to 1..N, "not" to 1..1, "if" to 2..3, "??" to 2..2,
        "count" to 1..1, "sum" to 1..2, "avg" to 1..2, "min" to 1..2, "max" to 1..2,
        "filter" to 2..2, "map" to 2..2, "sort" to 1..3, "take" to 2..2, "first" to 1..1, "last" to 1..1,
        "group" to 2..3, "pluck" to 2..2, "concat" to 1..N, "lower" to 1..1, "upper" to 1..1, "contains" to 2..2,
        "format" to 2..3, "now" to 0..0, "toTime" to 1..1, "startOf" to 1..2, "addDays" to 2..2, "object" to 2..N,
    )

    /** Argument indexes evaluated per element with `item`/`index` in scope. */
    val iteratorArgs: Map<String, Set<Int>> = mapOf("filter" to setOf(1), "map" to setOf(1), "group" to setOf(1, 2))

    /** If [e] is an operator call returns (op, args), else null (a literal). */
    fun asCall(e: JsonElement): Pair<String, List<JsonElement>>? {
        if (e !is JsonObject || e.size != 1) return null
        val (op, raw) = e.entries.first()
        return op to (raw as? JsonArray ?: listOf(raw))
    }
}

class EvalException(message: String) : RuntimeException(message)

fun interface Formatter {
    fun format(value: JsonElement, kind: String, arg: JsonElement): String?
}

data class ItemScope(val item: JsonElement, val index: Int)

class Evaluator(
    /** Root scope: data sources and bindings by name. */
    private val vars: Map<String, JsonElement>,
    private val formatter: Formatter? = null,
    private val now: () -> Long = System::currentTimeMillis,
    private val zone: ZoneId = ZoneId.systemDefault(),
    private val maxSteps: Int = Limits.MAX_STEPS,
) {
    private var steps = 0

    fun evaluate(expr: JsonElement, scope: ItemScope? = null): JsonElement {
        steps = 0
        return ev(expr, scope)
    }

    private fun list(e: JsonElement): List<JsonElement> = e as? JsonArray ?: emptyList()

    private fun field(el: JsonElement, f: JsonElement?): JsonElement =
        if (J.isNull(f)) el else J.getPath(el, J.stringify(f).split(".")) ?: JsonNull

    private fun compare(a: JsonElement, b: JsonElement): Int? {
        val na = J.num(a)
        val nb = J.num(b)
        if (na != null && nb != null) return na.compareTo(nb)
        val sa = J.str(a)
        val sb = J.str(b)
        if (sa != null && sb != null) return sa.compareTo(sb).coerceIn(-1, 1)
        return null
    }

    private fun ev(e: JsonElement, scope: ItemScope?): JsonElement {
        if (++steps > maxSteps) throw EvalException("expression step budget exceeded")
        if (e is JsonArray) return JsonArray(e.map { ev(it, scope) })
        val (op, args) = Operators.asCall(e) ?: return e
        fun a(i: Int): JsonElement = args.getOrNull(i)?.let { ev(it, scope) } ?: JsonNull
        fun iter(el: JsonElement, i: Int) = ItemScope(el, i)

        return when (op) {
            "var" -> {
                val path = J.stringify(a(0))
                val segs = path.split(".")
                val head = segs[0]
                val base: JsonElement? = when {
                    head == "item" && scope != null -> scope.item
                    head == "index" && scope != null -> J.of(scope.index.toDouble())
                    else -> vars[head]
                }
                J.getPath(base, segs.drop(1)) ?: if (args.size > 1) a(1) else JsonNull
            }
            "+" -> {
                var s = 0.0
                for (i in args.indices) {
                    val v = a(i)
                    if (J.isNull(v)) continue
                    s += J.num(v) ?: return JsonNull
                }
                J.of(s)
            }
            "*" -> {
                var p = 1.0
                for (i in args.indices) p *= J.num(a(i)) ?: return JsonNull
                J.of(p)
            }
            "-" -> {
                val x = J.num(a(0))
                if (args.size == 1) return J.of(x?.let { -it })
                val y = J.num(a(1))
                J.of(if (x == null || y == null) null else x - y)
            }
            "/", "%" -> {
                val x = J.num(a(0))
                val y = J.num(a(1))
                if (x == null || y == null || y == 0.0) JsonNull else J.of(if (op == "/") x / y else x % y)
            }
            "round" -> {
                val x = J.num(a(0)) ?: return JsonNull
                val d = if (args.size > 1) J.num(a(1)) ?: 0.0 else 0.0
                J.of(roundHalfAway(x, d.toInt()))
            }
            "==" -> J.of(J.deepEqual(a(0), a(1)))
            "!=" -> J.of(!J.deepEqual(a(0), a(1)))
            ">", ">=", "<", "<=" -> {
                val c = compare(a(0), a(1)) ?: return J.of(false)
                J.of(when (op) { ">" -> c > 0; ">=" -> c >= 0; "<" -> c < 0; else -> c <= 0 })
            }
            "and" -> J.of(args.indices.all { J.truthy(a(it)) })
            "or" -> J.of(args.indices.any { J.truthy(a(it)) })
            "not" -> J.of(!J.truthy(a(0)))
            "if" -> if (J.truthy(a(0))) a(1) else a(2)
            "??" -> a(0).let { if (J.isNull(it)) a(1) else it }
            "count" -> J.of((a(0) as? JsonArray)?.size?.toDouble() ?: 0.0)
            "sum", "avg", "min", "max" -> {
                val f = if (args.size > 1) a(1) else null
                val nums = list(a(0)).mapNotNull { J.num(field(it, f)) }
                when {
                    op == "sum" -> J.of(nums.sum())
                    nums.isEmpty() -> JsonNull
                    op == "avg" -> J.of(nums.average())
                    op == "min" -> J.of(nums.min())
                    else -> J.of(nums.max())
                }
            }
            "filter" -> JsonArray(list(a(0)).filterIndexed { i, el -> J.truthy(ev(args[1], iter(el, i))) })
            "map" -> JsonArray(list(a(0)).mapIndexed { i, el -> ev(args[1], iter(el, i)) })
            "sort" -> {
                val f = if (args.size > 1) a(1) else null
                val sign = if (args.size > 2 && J.str(a(2)) == "desc") -1 else 1
                val keyed = list(a(0)).mapIndexed { i, el -> Triple(el, i, field(el, f)) }
                JsonArray(keyed.sortedWith { x, y ->
                    val c = compare(x.third, y.third)
                    if (c == null) {
                        val xn = if (J.isNull(x.third)) 1 else 0
                        val yn = if (J.isNull(y.third)) 1 else 0
                        if (xn != yn) xn - yn else x.second - y.second
                    } else if (c != 0) sign * c else x.second - y.second
                }.map { it.first })
            }
            "take" -> {
                val n = J.num(a(1)) ?: return JsonArray(emptyList())
                JsonArray(list(a(0)).take(maxOf(0, floor(n).toInt())))
            }
            "first" -> list(a(0)).firstOrNull() ?: JsonNull
            "last" -> list(a(0)).lastOrNull() ?: JsonNull
            "group" -> {
                data class G(val key: JsonElement, var count: Int, var sum: Double)
                val groups = LinkedHashMap<String, G>()
                list(a(0)).forEachIndexed { i, el ->
                    val key = ev(args[1], iter(el, i))
                    val g = groups.getOrPut(key.toString()) { G(key, 0, 0.0) }
                    g.count++
                    if (args.size > 2) J.num(ev(args[2], iter(el, i)))?.let { g.sum += it }
                }
                JsonArray(groups.values.map {
                    JsonObject(mapOf("key" to it.key, "count" to J.of(it.count.toDouble()), "sum" to J.of(it.sum)))
                })
            }
            "pluck" -> {
                val f = a(1)
                JsonArray(list(a(0)).map { field(it, f) })
            }
            "concat" -> J.of(args.indices.joinToString("") { J.stringify(a(it)) })
            "lower" -> J.of(J.str(a(0))?.lowercase())
            "upper" -> J.of(J.str(a(0))?.uppercase())
            "contains" -> {
                val h = a(0)
                val n = a(1)
                J.of(when {
                    J.str(h) != null -> J.str(n)?.let { J.str(h)!!.contains(it) } ?: false
                    h is JsonArray -> h.any { J.deepEqual(it, n) }
                    else -> false
                })
            }
            "format" -> {
                val v = a(0)
                if (J.isNull(v)) J.of("")
                else J.of(formatter?.format(v, J.stringify(a(1)), if (args.size > 2) a(2) else JsonNull) ?: J.stringify(v))
            }
            "now" -> J.of(now().toDouble())
            "toTime" -> J.of(toTime(a(0), zone)?.toDouble())
            "startOf" -> {
                val t = if (args.size > 1) toTime(a(1), zone) else now()
                J.of(t?.let { startOf(J.stringify(a(0)), it, zone)?.toDouble() })
            }
            "addDays" -> {
                val t = toTime(a(0), zone)
                val n = J.num(a(1))
                J.of(if (t == null || n == null) null else t + n * 86_400_000.0)
            }
            "object" -> JsonObject(buildMap {
                var i = 0
                while (i + 1 < args.size) {
                    put(J.stringify(a(i)), a(i + 1)); i += 2
                }
            })
            else -> throw EvalException("unknown operator \"$op\"")
        }
    }

    companion object {
        fun roundHalfAway(x: Double, digits: Int): Double {
            val m = 10.0.pow(digits)
            val v = abs(x) * m
            val r = floor(v + 0.5 + v * Math.ulp(1.0) * 4) / m
            return if (x < 0) -r else r
        }

        private val datePrefix = Regex("^\\d{4}-\\d{2}-\\d{2}")

        fun toTime(v: JsonElement, zone: ZoneId = ZoneId.systemDefault()): Long? {
            J.num(v)?.let { return it.toLong() }
            val s = J.str(v)?.takeIf { datePrefix.containsMatchIn(it) } ?: return null
            return runCatching { OffsetDateTime.parse(s).toInstant().toEpochMilli() }
                .recoverCatching { Instant.parse(s).toEpochMilli() }
                // Like JavaScript: date-only strings are UTC, date-times without offset are local.
                .recoverCatching { LocalDate.parse(s).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli() }
                .recoverCatching { LocalDateTime.parse(s).atZone(zone).toInstant().toEpochMilli() }
                .getOrNull()
        }

        fun startOf(unit: String, t: Long, zone: ZoneId = ZoneId.systemDefault()): Long? {
            val day = Instant.ofEpochMilli(t).atZone(zone).truncatedTo(ChronoUnit.DAYS)
            val start = when (unit) {
                "day" -> day
                "week" -> day.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
                "month" -> day.withDayOfMonth(1)
                "year" -> day.withDayOfYear(1)
                else -> return null
            }
            return start.toInstant().toEpochMilli()
        }
    }
}

/** Evaluates bindings in declaration order; returns the root scope (data sources + bindings). */
fun resolveBindings(
    bindings: JsonObject?,
    data: Map<String, JsonElement>,
    formatter: Formatter? = null,
): Map<String, JsonElement> {
    val vars = LinkedHashMap(data)
    bindings?.forEach { (name, expr) -> vars[name] = Evaluator(vars.toMap(), formatter).evaluate(expr) }
    return vars
}
