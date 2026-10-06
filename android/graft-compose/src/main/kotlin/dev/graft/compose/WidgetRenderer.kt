package dev.graft.compose

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.graft.Graft
import dev.graft.displayText
import dev.graft.ViewNode
import dev.graft.WidgetSpec
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive

/*
 * Optional Jetpack Compose adapter over Graft's headless view tree (graft-core's ViewNode and
 * WidgetController). Apps on another toolkit render ViewNode with their own components instead.
 */

/** Semantic color tokens → Material 3 colors, so widgets follow the host theme. */
@Composable
internal fun tokenColor(token: String): Color {
    val c = MaterialTheme.colorScheme
    return when (token) {
        "muted" -> c.onSurfaceVariant
        "accent" -> c.primary
        "positive" -> Color(0xFF15803D)
        "negative" -> c.error
        "warning" -> Color(0xFFB45309)
        else -> Color.Unspecified
    }
}

/**
 * Renders a widget spec against a data snapshot through a [dev.graft.WidgetController], which owns the
 * input state. State is kept while [spec] stays the same and resets when it changes (e.g. after an edit).
 */
@Composable
fun LiveWidget(graft: Graft, spec: WidgetSpec, data: Map<String, JsonElement>, modifier: Modifier = Modifier) {
    val controller = remember(spec) { graft.controller(spec, data) }
    LaunchedEffect(controller, data) { controller.setData(data) }
    val view by controller.view.collectAsState()
    val current = view
    if (current != null) GraftView(current, modifier)
    else Text("“${spec.title}” could not be shown.", modifier, color = MaterialTheme.colorScheme.error)
}

/** Renders a headless view tree with Material 3 components. */
@Composable
fun GraftView(node: ViewNode, modifier: Modifier = Modifier) {
    Box(modifier) { Node(node) }
}

@Composable
private fun Children(nodes: List<ViewNode>) = nodes.forEach { key(it.key) { Node(it) } }

@Composable
private fun Node(n: ViewNode) {
    when (n) {
        is ViewNode.Card -> Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                n.title?.let { Text(it, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                Children(n.children)
            }
        }
        is ViewNode.Column -> Column(verticalArrangement = Arrangement.spacedBy((n.gap ?: 8.0).dp)) { Children(n.children) }
        is ViewNode.Row -> {
            val gap = (n.gap ?: 8.0).dp
            val arrangement = when (n.align) {
                "center" -> Arrangement.spacedBy(gap, Alignment.CenterHorizontally)
                "end" -> Arrangement.spacedBy(gap, Alignment.End)
                "spaceBetween" -> Arrangement.SpaceBetween
                else -> Arrangement.spacedBy(gap)
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = arrangement, verticalAlignment = Alignment.CenterVertically) {
                // Inputs share the row's width; other children keep their natural size.
                n.children.forEach { c ->
                    key(c.key) { if (c is ViewNode.Input) Box(Modifier.weight(1f)) { Node(c) } else Node(c) }
                }
            }
        }
        is ViewNode.Text -> Text(
            n.text,
            style = when (n.style) {
                "title" -> MaterialTheme.typography.titleMedium
                "caption" -> MaterialTheme.typography.bodySmall
                else -> MaterialTheme.typography.bodyMedium
            },
            color = tokenColor(n.color),
        )
        is ViewNode.Metric -> Column {
            Text(n.label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(n.value, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, color = tokenColor(n.color))
            n.caption?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        is ViewNode.Progress -> Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            n.label?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
            LinearProgressIndicator(
                progress = { n.fraction.toFloat() },
                modifier = Modifier.fillMaxWidth(),
                color = if (n.value > n.max) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
            )
        }
        is ViewNode.ListNode -> Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            n.empty?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            Children(n.items)
        }
        is ViewNode.BarChart -> Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            n.bars.forEach { b ->
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(b.label, Modifier.width(96.dp), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
                    LinearProgressIndicator(progress = { b.fraction.toFloat() }, modifier = Modifier.weight(1f))
                    Text(displayText(JsonPrimitive(Math.round(b.value * 100) / 100.0)), style = MaterialTheme.typography.bodySmall)
                }
            }
        }
        is ViewNode.Badge -> {
            val color = tokenColor(n.color).takeIf { it != Color.Unspecified } ?: MaterialTheme.colorScheme.onSurface
            Text(
                n.text,
                color = color,
                style = MaterialTheme.typography.labelSmall,
                modifier = Modifier.border(1.dp, color, RoundedCornerShape(50)).padding(horizontal = 8.dp, vertical = 2.dp),
            )
        }
        is ViewNode.Divider -> HorizontalDivider()
        is ViewNode.Input -> InputControl(n)
    }
}
