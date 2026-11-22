package app.vision.volunteer

import app.vision.volunteer.data.JobStatus
import app.vision.volunteer.data.JobStep
import app.vision.volunteer.data.ThreadLine
import app.vision.volunteer.data.ThreadSource
import app.vision.volunteer.ui.ClockStage
import app.vision.volunteer.ui.TrailItem
import app.vision.volunteer.ui.clockStage
import app.vision.volunteer.ui.isStale
import app.vision.volunteer.ui.trailOf
import app.vision.volunteer.ui.usedShare
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PromiseClockTest {
    private val from = 1_000_000L
    private val ends = from + 4 * 60_000L

    @Test fun clockIsNormalBeforeThreeQuartersOfTheLimit() {
        assertEquals(ClockStage.Normal, clockStage(nowMs = from + 179_999L, fromMs = from, endsAtMs = ends))
    }

    @Test fun clockIsLateFromThreeQuartersOfTheLimit() {
        assertEquals(ClockStage.Late, clockStage(nowMs = from + 180_000L, fromMs = from, endsAtMs = ends))
    }

    @Test fun clockIsOverdueFromTheLimit() {
        assertEquals(ClockStage.Overdue, clockStage(nowMs = ends, fromMs = from, endsAtMs = ends))
    }

    @Test fun clockWithoutAStartIsNeverLateOnlyOverdue() {
        assertEquals(ClockStage.Normal, clockStage(nowMs = ends - 1L, fromMs = null, endsAtMs = ends))
        assertEquals(ClockStage.Overdue, clockStage(nowMs = ends + 1L, fromMs = null, endsAtMs = ends))
    }

    @Test fun usedShareIsTheTimeUsedAndStopsAtFull() {
        assertEquals(0.5f, usedShare(nowMs = from + 120_000L, fromMs = from, endsAtMs = ends)!!, 0.0001f)
        assertEquals(1f, usedShare(nowMs = ends + 60_000L, fromMs = from, endsAtMs = ends)!!, 0.0001f)
        assertNull(usedShare(nowMs = from, fromMs = null, endsAtMs = ends))
    }

    @Test fun clockGoesStaleAfterFifteenSecondsWithoutTheHub() {
        assertFalse(isStale(null))
        assertFalse(isStale(14_999L))
        assertTrue(isStale(15_000L))
    }

    @Test fun trailMergesPastStatusesWithMessagesInTimeOrder() {
        val message = ThreadLine(at = 2_000L, from = ThreadSource.Desk, text = "Gate code 1234")
        val trail = trailOf(
            steps = listOf(JobStep(JobStatus.OnMyWay, at = 3_000L), JobStep(JobStatus.Accepted, at = 1_000L)),
            thread = listOf(message),
        )
        assertEquals(
            listOf(
                TrailItem.Step(JobStep(JobStatus.Accepted, at = 1_000L)),
                TrailItem.Message(message),
                TrailItem.Step(JobStep(JobStatus.OnMyWay, at = 3_000L)),
            ),
            trail,
        )
    }
}
