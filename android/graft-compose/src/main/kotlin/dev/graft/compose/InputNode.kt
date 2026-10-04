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
import dev.graft.BoundWidget
import dev.graft.InputBounds
import dev.graft.Inputs
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import kotlin.math.roundToInt

/** Renders an `input` node with the native Material 3 control for its kind. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun InputNode(w: BoundWidget, n: JsonObject, label: String?, placeholder: String?, options: () -> JsonElement) {
    val onInput = LocalInputHandler.current
    val kind = (n["kind"] as JsonPrimitive).content
    val name = (n["bind"] as JsonPrimitive).content
    val bounds = InputBounds.of(n)
    val value = w.state[name] ?: JsonNull
    val enabled = onInput != null
    fun set(raw: JsonElement) = onInput?.invoke(name, Inputs.coerce(kind, raw, bounds))
    val prim = value as? JsonPrimitive

    when (kind) {
        "text", "number" -> {
            // Keep the user's raw text ("1." or "1,5") locally; state holds the coerced value.
            var text by remember(name) { mutableStateOf(if (value is JsonNull) "" else prim?.content ?: "") }
            OutlinedTextField(
                value = text,
                onValueChange = { text = it; set(JsonPrimitive(it)) },
                modifier = Modifier.fillMaxWidth(),
                enabled = enabled,
                label = label?.let { { Text(it) } },
                placeholder = placeholder?.let { { Text(it) } },
                singleLine = !(kind == "text" && (n["multiline"] as? JsonPrimitive)?.booleanOrNull == true),
                keyboardOptions = if (kind == "number") KeyboardOptions(keyboardType = KeyboardType.Decimal) else KeyboardOptions.Default,
            )
        }
        "slider" -> Column {
            val min = (bounds.min ?: 0.0).toFloat()
            val max = (bounds.max ?: 1.0).toFloat()
            val current = (prim?.doubleOrNull ?: min.toDouble()).toFloat()
            val steps = bounds.step?.let { (((max - min) / it).roundToInt() - 1).coerceAtLeast(0) } ?: 0
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(label ?: "", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(str(value), style = MaterialTheme.typography.bodySmall)
            }
            Slider(value = current, onValueChange = { set(JsonPrimitive(it.toDouble())) }, valueRange = min..max, steps = steps, enabled = enabled)
        }
        "toggle" -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Switch(checked = prim?.booleanOrNull == true, onCheckedChange = { set(JsonPrimitive(it)) }, enabled = enabled)
            if (label != null) Text(label, style = MaterialTheme.typography.bodyMedium)
        }
        "select" -> Column {
            if (label != null) Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            val choices = Inputs.options(options())
            var expanded by remember { mutableStateOf(false) }
            Box {
                OutlinedButton(onClick = { expanded = true }, enabled = enabled, modifier = Modifier.fillMaxWidth()) {
                    Text(choices.firstOrNull { it.value == value }?.label ?: "—")
                }
                DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                    DropdownMenuItem(text = { Text("—") }, onClick = { set(JsonNull); expanded = false })
                    choices.forEach { o -> DropdownMenuItem(text = { Text(o.label) }, onClick = { set(o.value); expanded = false }) }
                }
            }
        }
        "date" -> Column {
            if (label != null) Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            var open by remember { mutableStateOf(false) }
            val iso = (value as? JsonPrimitive)?.takeIf { it.isString }?.content
            OutlinedButton(onClick = { open = true }, enabled = enabled, modifier = Modifier.fillMaxWidth()) { Text(iso ?: "Pick a date") }
            if (open) {
                // DatePicker works in UTC milliseconds; state holds "YYYY-MM-DD".
                val initial = iso?.let { runCatching { LocalDate.parse(it).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli() }.getOrNull() }
                val picker = rememberDatePickerState(initialSelectedDateMillis = initial)
                DatePickerDialog(
                    onDismissRequest = { open = false },
                    confirmButton = {
                        TextButton(onClick = {
                            picker.selectedDateMillis?.let { set(JsonPrimitive(Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate().toString())) }
                            open = false
                        }) { Text("OK") }
                    },
                    dismissButton = { TextButton(onClick = { open = false }) { Text("Cancel") } },
                ) { DatePicker(state = picker) }
            }
        }
    }
}
