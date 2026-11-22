package app.vision.volunteer

import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.font.FontFamily
import app.vision.volunteer.ui.monoNumbers
import org.junit.Assert.assertEquals
import org.junit.Test

class RecordTextTest {
    private val mono = SpanStyle(fontFamily = FontFamily.Monospace)

    @Test fun onlyTheNumbersOfTheRecordLineAreMono() {
        val text = monoNumbers("My record: 12 jobs, 3.5 hours", mono)
        assertEquals("My record: 12 jobs, 3.5 hours", text.text)
        val styled = text.spanStyles.map { text.text.substring(it.start, it.end) to it.item }
        assertEquals(listOf("12" to mono, "3.5" to mono), styled)
    }

    @Test fun aLineWithoutNumbersHasNoMonoPart() {
        assertEquals(emptyList<Any>(), monoNumbers("My record", mono).spanStyles)
    }
}
