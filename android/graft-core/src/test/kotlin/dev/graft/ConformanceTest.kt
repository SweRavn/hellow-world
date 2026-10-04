package dev.graft

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
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
}
