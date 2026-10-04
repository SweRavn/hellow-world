package dev.graft.compose

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.graft.BoundWidget
import dev.graft.Graft
import dev.graft.GraftException
import dev.graft.WidgetSpec
import kotlinx.coroutines.launch

/**
 * The end-user "vibe" sheet: describe a feature → preview → add it to the app.
 * Pass [edit] to modify an existing widget.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VibeSheet(
    graft: Graft,
    onDismiss: () -> Unit,
    slot: String? = null,
    edit: WidgetSpec? = null,
    slotLabels: Map<String, String> = emptyMap(),
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    var prompt by remember { mutableStateOf("") }
    var selectedSlot by remember { mutableStateOf(edit?.slot ?: slot) }
    var current by remember { mutableStateOf(edit) }
    var preview by remember { mutableStateOf<BoundWidget?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun generate() {
        if (prompt.isBlank() || busy) return
        busy = true
        error = null
        scope.launch {
            try {
                val spec = graft.propose(prompt.trim(), selectedSlot, current)
                preview = graft.bind(spec, graft.snapshot())
                current = spec
                prompt = ""
            } catch (e: GraftException) {
                error = "${e.message}. Try rephrasing."
            } catch (e: Exception) {
                error = "Something went wrong. Please try again."
            } finally {
                busy = false
            }
        }
    }

    ModalBottomSheet(onDismissRequest = { if (!busy) onDismiss() }, sheetState = sheetState) {
        Column(
            Modifier.padding(horizontal = 20.dp).padding(bottom = 24.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(if (edit != null) "Change “${edit.title}”" else "Add a feature", style = MaterialTheme.typography.titleLarge)
            Text(
                "Describe what you want to see. You'll get a preview before anything is added.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedTextField(
                value = prompt,
                onValueChange = { prompt = it },
                modifier = Modifier.fillMaxWidth(),
                minLines = 3,
                enabled = !busy,
                placeholder = { Text(if (preview != null || edit != null) "What should change?" else "e.g. Show how much I spent on food this month") },
            )
            if (edit == null && graft.slotIds.size > 1) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = selectedSlot == null, onClick = { selectedSlot = null }, label = { Text("AI decides") })
                    graft.slotIds.forEach { id ->
                        FilterChip(selected = selectedSlot == id, onClick = { selectedSlot = id }, label = { Text(slotLabels[id] ?: id) })
                    }
                }
            }
            if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            preview?.let {
                RenderWidget(
                    it,
                    Modifier.fillMaxWidth()
                        .border(1.dp, MaterialTheme.colorScheme.primary, RoundedCornerShape(16.dp))
                        .padding(8.dp),
                )
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, androidx.compose.ui.Alignment.End)) {
                OutlinedButton(onClick = onDismiss, enabled = !busy) { Text("Cancel") }
                Button(onClick = ::generate, enabled = !busy && prompt.isNotBlank()) { Text(if (preview == null) "Generate" else "Refine") }
                preview?.let { p ->
                    Button(onClick = {
                        busy = true
                        scope.launch {
                            try {
                                graft.accept(p.spec)
                                onDismiss()
                            } catch (e: Exception) {
                                error = "Could not save the widget."
                            } finally {
                                busy = false
                            }
                        }
                    }, enabled = !busy) { Text(if (edit != null) "Save" else "Add") }
                }
            }
        }
    }
}

/** A floating "✨ Add feature" button that opens [VibeSheet]. Put it in your Scaffold's floatingActionButton. */
@Composable
fun VibeButton(graft: Graft, modifier: Modifier = Modifier, label: String = "✨ Add feature", slotLabels: Map<String, String> = emptyMap()) {
    var open by remember { mutableStateOf(false) }
    ExtendedFloatingActionButton(onClick = { open = true }, modifier = modifier) { Text(label) }
    if (open) VibeSheet(graft, onDismiss = { open = false }, slotLabels = slotLabels)
}
