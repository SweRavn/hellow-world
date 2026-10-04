package dev.graft

import kotlinx.serialization.json.JsonElement
import java.text.NumberFormat
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Currency
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToLong

/** `format` operator backed by java.text / java.time, using the manifest theme's locale and currency. */
class DefaultFormatter(theme: Theme? = null, private val zone: ZoneId = ZoneId.systemDefault()) : Formatter {
    private val locale: Locale = theme?.locale?.let(Locale::forLanguageTag) ?: Locale.getDefault()
    private val currency: String = theme?.currency ?: "USD"

    override fun format(value: JsonElement, kind: String, arg: JsonElement): String? {
        val n = J.num(value)
        return runCatching {
            when (kind) {
                "number" -> n?.let {
                    NumberFormat.getNumberInstance(locale).apply {
                        val d = J.num(arg)?.toInt()
                        minimumFractionDigits = d ?: 0
                        maximumFractionDigits = d ?: 2
                    }.format(it)
                }
                "currency" -> n?.let {
                    NumberFormat.getCurrencyInstance(locale).apply { this.currency = Currency.getInstance(J.str(arg) ?: this@DefaultFormatter.currency) }.format(it)
                }
                "percent" -> n?.let { NumberFormat.getPercentInstance(locale).apply { maximumFractionDigits = 1 }.format(it) }
                "date", "datetime" -> Evaluator.toTime(value, zone)?.let {
                    val f = if (kind == "date") DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM)
                    else DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
                    f.withLocale(locale).format(Instant.ofEpochMilli(it).atZone(zone))
                }
                "relative" -> Evaluator.toTime(value, zone)?.let { relative(it - System.currentTimeMillis()) }
                else -> null
            }
        }.getOrNull()
    }

    // Simple English relative time; override Formatter for full localisation (e.g. android.text.format.DateUtils).
    private fun relative(diffMs: Long): String {
        val units = listOf("year" to 31_536_000_000L, "month" to 2_592_000_000L, "day" to 86_400_000L, "hour" to 3_600_000L, "minute" to 60_000L)
        for ((u, ms) in units) {
            if (abs(diffMs) >= ms) {
                val k = (diffMs.toDouble() / ms).roundToLong()
                val a = abs(k)
                if (u == "day" && a == 1L) return if (k < 0) "yesterday" else "tomorrow"
                val label = "$a $u${if (a == 1L) "" else "s"}"
                return if (k < 0) "$label ago" else "in $label"
            }
        }
        return "just now"
    }
}
