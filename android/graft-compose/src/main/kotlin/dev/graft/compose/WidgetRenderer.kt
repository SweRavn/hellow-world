package dev.graft.compose

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.border
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.graft.BoundWidget
import dev.graft.ItemScope
import dev.graft.Limits
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

/** Semantic color tokens → Material 3 colors, so widgets follow the host theme. */
@Composable
internal fun tokenColor(v: JsonElement): Color {
    val c = MaterialTheme.colorScheme
    return when ((v as? JsonPrimitive)?.takeIf { it.isString }?.content) {
        "muted" -> c.onSurfaceVariant
        "accent" -> c.primary
        "positive" -> Color(0xFF15803D)
        "negative" -> c.error
        "warning" -> Color(0xFFB45309)
        else -> Color.Unspecified
    }
}

private fun str(v: JsonElement): String = when {
    v is JsonNull -> ""
    v is JsonPrimitive && v.isString -> v.content
    v is JsonPrimitive -> v.doubleOrNull?.let { d -> if (d == Math.rint(d) && kotlin.math.abs(d) < 1e15) d.toLong().toString() else d.toString() } ?: v.content
    else -> v.toString()
}

private fun num(v: JsonElement): Double? = (v as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull?.takeIf { it.isFinite() }

private fun truthy(v: JsonElement): Boolean = when {
    v is JsonNull -> false
    v is JsonArray -> v.isNotEmpty()
    v is JsonPrimitive && v.isString -> v.content.isNotEmpty()
    v is JsonPrimitive -> v.content != "false" && num(v) != 0.0
    else -> true
}

/** Renders a bound widget spec with Material 3 components. */
@Composable
fun RenderWidget(widget: BoundWidget, modifier: Modifier = Modifier) {
    Box(modifier) { Node(widget, widget.spec.root, null) }
}

@Composable
private fun Node(w: BoundWidget, n: JsonObject, scope: ItemScope?) {
    // Expression errors (e.g. step budget) degrade to an empty value instead of crashing composition.
    fun ev(key: String): JsonElement = runCatching { w.eval(n[key], scope) }.getOrDefault(JsonNull)
    val children = (n["children"] as? JsonArray)?.mapNotNull { it as? JsonObject } ?: emptyList()
    val gap = num(n["gap"] ?: JsonNull)?.dp ?: 8.dp

    when ((n["type"] as JsonPrimitive).content) {
        "card" -> Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                val title = ev("title")
                if (title !is JsonNull) {
                    Text(str(title), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                children.forEach { Node(w, it, scope) }
            }
        }
        "column" -> Column(verticalArrangement = Arrangement.spacedBy(gap)) { children.forEach { Node(w, it, scope) } }
        "row" -> {
            val arrangement = when ((n["align"] as? JsonPrimitive)?.content) {
                "center" -> Arrangement.spacedBy(gap, Alignment.CenterHorizontally)
                "end" -> Arrangement.spacedBy(gap, Alignment.End)
                "spaceBetween" -> Arrangement.SpaceBetween
                else -> Arrangement.spacedBy(gap)
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = arrangement, verticalAlignment = Alignment.CenterVertically) {
                children.forEach { Node(w, it, scope) }
            }
        }
        "text" -> {
            val style = when ((n["style"] as? JsonPrimitive)?.content) {
                "title" -> MaterialTheme.typography.titleMedium
                "caption" -> MaterialTheme.typography.bodySmall
                else -> MaterialTheme.typography.bodyMedium
            }
            Text(str(ev("value")), style = style, color = tokenColor(ev("color")))
        }
        "metric" -> Column {
            Text(str(ev("label")), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(str(ev("value")), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, color = tokenColor(ev("color")))
            val caption = ev("caption")
            if (caption !is JsonNull && str(caption).isNotEmpty()) {
                Text(str(caption), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        "progress" -> Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            val label = ev("label")
            if (label !is JsonNull) Text(str(label), style = MaterialTheme.typography.bodySmall)
            val value = num(ev("value")) ?: 0.0
            val max = num(ev("max")) ?: 1.0
            val fraction = if (max > 0) (value / max).coerceIn(0.0, 1.0).toFloat() else 0f
            LinearProgressIndicator(
                progress = { fraction },
                modifier = Modifier.fillMaxWidth(),
                color = if (value > max) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
            )
        }
        "list" -> Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            val items = ev("items") as? JsonArray ?: JsonArray(emptyList())
            val limit = minOf(num(n["limit"] ?: JsonNull)?.toInt() ?: Limits.MAX_LIST_LIMIT, Limits.MAX_LIST_LIMIT)
            if (items.isEmpty()) {
                val empty = ev("empty")
                if (empty !is JsonNull) Text(str(empty), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            val template = n["template"] as? JsonObject
            if (template != null) items.take(limit).forEachIndexed { i, item -> Node(w, template, ItemScope(item, i)) }
        }
        "barChart" -> Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            val rows = ((ev("items") as? JsonArray) ?: JsonArray(emptyList())).take(Limits.MAX_LIST_LIMIT).map {
                val o = it as? JsonObject
                str(o?.get("label") ?: JsonNull) to (num(o?.get("value") ?: JsonNull) ?: 0.0)
            }
            val max = num(ev("max")) ?: (rows.maxOfOrNull { it.second } ?: 0.0)
            rows.forEach { (label, value) ->
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(label, Modifier.width(96.dp), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
                    LinearProgressIndicator(
                        progress = { if (max > 0) (value / max).coerceIn(0.0, 1.0).toFloat() else 0f },
                        modifier = Modifier.weight(1f),
                    )
                    Text(str(JsonPrimitive(Math.round(value * 100) / 100.0)), style = MaterialTheme.typography.bodySmall)
                }
            }
        }
        "badge" -> {
            val color = tokenColor(ev("color")).takeIf { it != Color.Unspecified } ?: MaterialTheme.colorScheme.onSurface
            Text(
                str(ev("value")),
                color = color,
                style = MaterialTheme.typography.labelSmall,
                modifier = Modifier.border(1.dp, color, RoundedCornerShape(50)).padding(horizontal = 8.dp, vertical = 2.dp),
            )
        }
        "divider" -> HorizontalDivider()
        "visible" -> if (truthy(ev("when"))) Column(verticalArrangement = Arrangement.spacedBy(8.dp)) { children.forEach { Node(w, it, scope) } }
        else -> Unit // unreachable for validated specs
    }
}
