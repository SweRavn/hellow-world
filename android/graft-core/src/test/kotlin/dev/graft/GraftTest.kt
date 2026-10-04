package dev.graft

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class GraftTest {
    @Serializable
    data class Tx(val amount: Double, val category: String)

    private val spec = Json.parseToJsonElement(
        """{"specVersion":1,"id":"total","title":"Total","slot":"home.top",
            "bindings":{"total":{"sum":[{"var":"tx"},"amount"]}},
            "root":{"type":"metric","label":"Total","value":{"format":[{"var":"total"},"currency"]}}}""",
    )

    private fun graft(generated: () -> kotlinx.serialization.json.JsonElement = { spec }, store: WidgetStore = MemoryStore()): Graft {
        var tx = listOf(Tx(5.0, "Food"), Tx(7.0, "Fun"))
        return Graft(AppInfo("Test"), { generated() }, store, Theme(currency = "EUR", locale = "en-US"))
            .addDataSource("tx", DataSource.of("transactions", SchemaNode("array"), sample = listOf(Tx(1.0, "Food"))) { tx })
            .addSlot("home.top", SlotInfo("top"))
    }

    @Test
    fun proposeAcceptRender() = runTest {
        val g = graft()
        g.init()
        val s = g.propose("total spend")
        assertEquals("total spend", s.prompt)
        assertTrue(g.widgets.value.isEmpty())
        g.accept(s)
        assertEquals(listOf("total"), g.widgetsFor("home.top").map { it.id })
        val bound = g.bind(s, g.snapshot())
        assertEquals(12.0, J.num(bound.eval(Json.parseToJsonElement("""{"var":"total"}"""))))
        assertEquals("€12.00", J.str(bound.eval(s.root["value"])))
    }

    @Test
    fun rejectsInvalidOutput() = runTest {
        val bad = Json.parseToJsonElement("""{"specVersion":1,"id":"x","title":"x","slot":"home.top","root":{"type":"webview"}}""")
        val e = assertFailsWith<GraftException> { graft({ bad }).propose("x") }
        assertTrue(e.details.single().contains("unknown component"))
    }

    @Test
    fun persistsAndDedupes() = runTest {
        val store = MemoryStore()
        val g = graft(store = store)
        g.accept(g.propose("a"))
        assertNotEquals("total", g.propose("b").id)
        assertEquals("total", g.propose("c", edit = g.widgets.value.first()).id)
        val g2 = graft(store = store)
        g2.init()
        assertEquals(1, g2.widgets.value.size)
    }

    @Test
    fun manifestCarriesSample() {
        val m = graft().manifest()
        assertEquals(JsonPrimitive(1.0), m.dataSources.getValue("tx").sample!!.let { (it as kotlinx.serialization.json.JsonArray)[0].jsonObject["amount"] })
    }

    @Test
    fun stepBudget() {
        val big = (0 until 1000).joinToString(",")
        val expr = Json.parseToJsonElement("""{"map":[[$big],{"map":[[$big],{"+":[{"var":"item"},1]}]}]}""")
        assertFailsWith<EvalException> { Evaluator(emptyMap()).evaluate(expr) }
    }
}
