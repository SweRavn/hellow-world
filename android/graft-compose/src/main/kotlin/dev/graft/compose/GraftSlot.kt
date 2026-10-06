package dev.graft.compose

import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.graft.Graft
import dev.graft.WidgetSpec
import dev.graft.WidgetStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement

/**
 * Place this where generated widgets may appear. Renders the slot's widgets live: they re-render
 * when widgets change or when the host calls `graft.notifyDataChanged()`.
 *
 *     Column {
 *         BalanceHeader()
 *         GraftSlot(graft, "home.top")
 *         TransactionList()
 *     }
 */
@Composable
fun GraftSlot(
    graft: Graft,
    slotId: String,
    modifier: Modifier = Modifier,
    editable: Boolean = true,
) {
    val all by graft.widgets.collectAsState()
    val dataVersion by graft.dataVersion.collectAsState()
    val widgets = remember(all, slotId) { graft.widgetsFor(slotId, all) }
    var data by remember { mutableStateOf<Map<String, JsonElement>?>(null) }
    var editing by remember { mutableStateOf<WidgetSpec?>(null) }
    var removing by remember { mutableStateOf<WidgetSpec?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(widgets, dataVersion) {
        if (widgets.isNotEmpty()) data = graft.snapshot()
    }

    Column(modifier, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        val snapshot = data ?: return@Column
        widgets.forEach { spec ->
            // key() keeps each widget's input state attached to it when widgets are added or removed.
            key(spec.id) {
                Box(Modifier.fillMaxWidth()) {
                    LiveWidget(graft, spec, snapshot, Modifier.fillMaxWidth())
                    if (editable) {
                        Row(Modifier.align(Alignment.TopEnd).padding(4.dp)) {
                            TextButton(onClick = { editing = spec }) { Text("Edit") }
                            TextButton(onClick = { removing = spec }) { Text("✕") }
                        }
                    }
                }
            }
        }
    }

    editing?.let { spec -> VibeSheet(graft, slot = slotId, edit = spec, onDismiss = { editing = null }) }
    removing?.let { spec ->
        AlertDialog(
            onDismissRequest = { removing = null },
            title = { Text("Remove “${spec.title}”?") },
            confirmButton = { TextButton(onClick = { scope.launch { graft.remove(spec.id) }; removing = null }) { Text("Remove") } },
            dismissButton = { TextButton(onClick = { removing = null }) { Text("Cancel") } },
        )
    }
}

/** Persists widgets in SharedPreferences. Implement [WidgetStore] yourself to sync per user via your backend. */
class SharedPreferencesStore(context: Context, private val key: String = "graft.widgets") : WidgetStore {
    private val prefs = context.applicationContext.getSharedPreferences("graft", Context.MODE_PRIVATE)

    override suspend fun load(): List<JsonElement> = withContext(Dispatchers.IO) {
        runCatching { (Json.parseToJsonElement(prefs.getString(key, "[]")!!) as JsonArray).toList() }.getOrDefault(emptyList())
    }

    override suspend fun save(widgets: List<WidgetSpec>) = withContext(Dispatchers.IO) {
        prefs.edit().putString(key, JsonArray(widgets.map { it.json }).toString()).apply()
    }
}
