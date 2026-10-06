package dev.graft.compose

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import dev.graft.ViewNode
import dev.graft.displayText
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import kotlin.math.roundToInt

/**
 * Material 3 control for a headless input node: reads `n.value`, writes through `n.set(...)`.
 * This is all an input adapter needs, so swapping in your own design-system controls is a small job.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InputControl(n: ViewNode.Input) {
    val prim = n.value as? JsonPrimitive
    when (n.kind) {
        "text", "number" -> {
            // Keep the user's raw text ("1." or "1,5") locally; Graft's state holds the coerced value.
            var text by remember(n.key) { mutableStateOf(if (n.value is JsonNull) "" else displayText(n.value)) }
            OutlinedTextField(
                value = text,
                onValueChange = { text = it; n.set(it) },
                modifier = Modifier.fillMaxWidth(),
                label = n.label?.let { { Text(it) } },
                placeholder = n.placeholder?.let { { Text(it) } },
                singleLine = !n.multiline,
                keyboardOptions = if (n.kind == "number") KeyboardOptions(keyboardType = KeyboardType.Decimal) else KeyboardOptions.Default,
            )
        }
        "slider" -> Column {
            val min = (n.min ?: 0.0).toFloat()
            val max = (n.max ?: 1.0).toFloat()
            val steps = n.step?.let { (((max - min) / it).roundToInt() - 1).coerceAtLeast(0) } ?: 0
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(n.label ?: "", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(displayText(n.value), style = MaterialTheme.typography.bodySmall)
            }
            Slider(value = (prim?.doubleOrNull ?: min.toDouble()).toFloat(), onValueChange = { n.set(it.toDouble()) }, valueRange = min..max, steps = steps)
        }
        "toggle" -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Switch(checked = prim?.booleanOrNull == true, onCheckedChange = { n.set(it) })
            n.label?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
        }
        "select" -> Column {
            n.label?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            var expanded by remember { mutableStateOf(false) }
            Box {
                OutlinedButton(onClick = { expanded = true }, modifier = Modifier.fillMaxWidth()) {
                    Text(n.options.firstOrNull { it.value == n.value }?.label ?: "—")
                }
                DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                    DropdownMenuItem(text = { Text("—") }, onClick = { n.set(JsonNull); expanded = false })
                    n.options.forEach { o -> DropdownMenuItem(text = { Text(o.label) }, onClick = { n.set(o.value); expanded = false }) }
                }
            }
        }
        "date" -> Column {
            n.label?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            var open by remember { mutableStateOf(false) }
            val iso = prim?.takeIf { it.isString }?.content
            OutlinedButton(onClick = { open = true }, modifier = Modifier.fillMaxWidth()) { Text(iso ?: "Pick a date") }
            if (open) {
                // DatePicker works in UTC milliseconds; Graft's state holds "YYYY-MM-DD".
                val initial = iso?.let { runCatching { LocalDate.parse(it).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli() }.getOrNull() }
                val picker = rememberDatePickerState(initialSelectedDateMillis = initial)
                DatePickerDialog(
                    onDismissRequest = { open = false },
                    confirmButton = {
                        TextButton(onClick = {
                            picker.selectedDateMillis?.let { n.set(Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate().toString()) }
                            open = false
                        }) { Text("OK") }
                    },
                    dismissButton = { TextButton(onClick = { open = false }) { Text("Cancel") } },
                ) { DatePicker(state = picker) }
            }
        }
    }
}
