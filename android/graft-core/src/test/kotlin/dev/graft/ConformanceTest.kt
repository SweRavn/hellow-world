package dev.graft

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertTrue
import kotlin.test.fail

/** Runs the shared vectors in spec/conformance, so every platform agrees with the TypeScript reference. */
class ConformanceTest {
    private val dir = File(System.getProperty("graft.conformanceDir") ?: "../../spec/conformance")
    private fun load(name: String) = Json.parseToJsonElement(File(dir, name).readText()).jsonObject

    /** JSON equality where numbers compare numerically (3 == 3.0). */
    private fun same(a: JsonElement, b: JsonElement): Boolean = J.deepEqual(a, b)

    @Test
    fun expressions() {
        val file = load("expressions.json")
        val data = file.getValue("data").jsonObject
        val failures = mutableListOf<String>()
        for (c in file.getValue("cases").jsonArray.map { it.jsonObject }) {
            val name = c.getValue("name").jsonPrimitive.content
            val got = runCatching {
                val vars = resolveBindings(c["bindings"] as? JsonObject, data)
                Evaluator(vars).evaluate(c.getValue("expr"))
            }.getOrElse { failures += "$name: threw $it"; continue }
            if (!same(got, c.getValue("expect"))) failures += "$name: expected ${c["expect"]}, got $got"
        }
        if (failures.isNotEmpty()) fail(failures.joinToString("\n"))
    }

    @Test
    fun validation() {
        val file = load("validation.json")
        val manifest = Json { ignoreUnknownKeys = true }.decodeFromJsonElement<Manifest>(file.getValue("manifest"))
        val failures = mutableListOf<String>()
        for (c in (file.getValue("cases") as JsonArray).map { it.jsonObject }) {
            val name = c.getValue("name").jsonPrimitive.content
            val valid = c.getValue("valid").jsonPrimitive.content.toBoolean()
            when (val r = validateSpec(c.getValue("spec"), manifest)) {
                is ValidationResult.Ok -> if (!valid) failures += "$name: expected invalid"
                is ValidationResult.Invalid -> {
                    if (valid) failures += "$name: expected valid, got ${r.errors}"
                    val want = J.str(c["error"])?.lowercase()
                    if (want != null && r.errors.none { want in it.lowercase() }) failures += "$name: errors ${r.errors} lack \"$want\""
                }
            }
        }
        if (failures.isNotEmpty()) fail(failures.joinToString("\n"))
        assertTrue(true)
    }

    @Test
    fun inputs() {
        val file = load("inputs.json")
        val failures = mutableListOf<String>()
        for (c in file.getValue("coerce").jsonArray.map { it.jsonObject }) {
            val props = c["props"] as? JsonObject
            val bounds = InputBounds(J.num(props?.get("min")), J.num(props?.get("max")), J.num(props?.get("step")))
            val got = Inputs.coerce(c.getValue("kind").jsonPrimitive.content, c.getValue("raw"), bounds)
            if (!same(got, c.getValue("expect"))) failures += "coerce ${c["name"]}: expected ${c["expect"]}, got $got"
        }
        for (c in file.getValue("options").jsonArray.map { it.jsonObject }) {
            val got = JsonArray(Inputs.options(c.getValue("options")).map {
                JsonObject(mapOf("label" to J.of(it.label), "value" to it.value))
            })
            if (!same(got, c.getValue("expect"))) failures += "options ${c["name"]}: expected ${c["expect"]}, got $got"
        }
        if (failures.isNotEmpty()) fail(failures.joinToString("\n"))
    }

    @Test
    fun views() {
        val file = load("views.json")
        val data = file.getValue("data").jsonObject
        val manifest = Manifest(
            AppInfo("T"),
            mapOf("tx" to DataSourceInfo("", SchemaNode("array")), "user" to DataSourceInfo("", SchemaNode("object"))),
            mapOf("home.top" to SlotInfo("")),
        )
        val graft = Graft(AppInfo("T"), { JsonNull })
        val failures = mutableListOf<String>()
        for (c in file.getValue("cases").jsonArray.map { it.jsonObject }) {
            val name = c.getValue("name").jsonPrimitive.content
            val spec = when (val r = validateSpec(c.getValue("spec"), manifest)) {
                is ValidationResult.Ok -> r.spec
                is ValidationResult.Invalid -> { failures += "$name: invalid ${r.errors}"; continue }
            }
            val state = (c["state"] as? JsonObject)?.toMap() ?: Inputs.initialState(spec)
            val got = resolveView(graft.bind(spec, data, state)).toJson()
            if (!same(got, c.getValue("expect"))) failures += "$name:\n  expected ${c["expect"]}\n  got      $got"
        }
        if (failures.isNotEmpty()) fail(failures.joinToString("\n"))
    }
}
