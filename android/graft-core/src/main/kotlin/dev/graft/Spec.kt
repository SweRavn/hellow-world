package dev.graft

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive

const val SPEC_VERSION = 1

object Limits {
    const val MAX_NODES = 200
    const val MAX_DEPTH = 12
    const val MAX_BINDINGS = 50
    const val MAX_LIST_LIMIT = 100
    const val MAX_STEPS = 100_000
}

val COLOR_TOKENS = listOf("default", "muted", "accent", "positive", "negative", "warning")

@Serializable
data class SchemaNode(
    val type: String,
    val description: String? = null,
    val format: String? = null,
    val enum: List<JsonElement>? = null,
    val items: SchemaNode? = null,
    val properties: Map<String, SchemaNode>? = null,
)

@Serializable
data class DataSourceInfo(val description: String, val schema: SchemaNode, val sample: JsonElement? = null)

@Serializable
data class SlotInfo(val description: String, val maxWidgets: Int? = null)

@Serializable
data class AppInfo(val name: String, val description: String? = null)

@Serializable
data class Theme(val currency: String? = null, val locale: String? = null)

/** What the host app exposes to the generator. See spec/README.md §1. */
@Serializable
data class Manifest(
    val app: AppInfo,
    val dataSources: Map<String, DataSourceInfo>,
    val slots: Map<String, SlotInfo>,
    val theme: Theme? = null,
)

/**
 * A validated widget spec. Kept as raw JSON (the renderer walks the tree) with typed accessors.
 * Obtain one through [validateSpec]; never construct from untrusted JSON directly.
 */
class WidgetSpec internal constructor(val json: JsonObject) {
    val id: String get() = json.getValue("id").jsonPrimitive.content
    val title: String get() = json.getValue("title").jsonPrimitive.content
    val slot: String get() = json.getValue("slot").jsonPrimitive.content
    val prompt: String? get() = J.str(json["prompt"])
    val bindings: JsonObject? get() = json["bindings"] as? JsonObject
    val root: JsonObject get() = json.getValue("root") as JsonObject

    internal fun with(key: String, value: JsonElement) = WidgetSpec(JsonObject(json + (key to value)))

    override fun equals(other: Any?) = other is WidgetSpec && other.json == json
    override fun hashCode() = json.hashCode()
    override fun toString() = json.toString()
}

@PublishedApi internal val GraftJson = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = false }
