package app.vision.volunteer.ui

import android.os.SystemClock
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.vision.volunteer.R
import app.vision.volunteer.data.ClockView
import app.vision.volunteer.ui.theme.Graphite
import app.vision.volunteer.ui.theme.Tokens
import kotlinx.coroutines.delay
import java.util.Locale

private const val TICK_MS = 1_000L
private const val HOUR_MS = 3_600_000L
private const val MINUTE_MS = 60_000L
private const val STALE_AFTER_MS = 15_000L
private val BAR = 2.dp
private val DASH = floatArrayOf(12f, 8f)

enum class ClockStage { Normal, Late, Overdue }

fun clockStage(nowMs: Long, fromMs: Long?, endsAtMs: Long): ClockStage = when {
    nowMs >= endsAtMs -> ClockStage.Overdue
    fromMs != null && endsAtMs > fromMs && (nowMs - fromMs) * 4 >= (endsAtMs - fromMs) * 3 -> ClockStage.Late
    else -> ClockStage.Normal
}

fun usedShare(nowMs: Long, fromMs: Long?, endsAtMs: Long): Float? {
    if (fromMs == null || endsAtMs <= fromMs) return null
    return ((nowMs - fromMs).toFloat() / (endsAtMs - fromMs)).coerceIn(0f, 1f)
}

fun isStale(downForMs: Long?): Boolean = downForMs != null && downForMs >= STALE_AFTER_MS

fun countdown(leftMs: Long): String {
    val ms = if (leftMs < 0) -leftMs else leftMs
    val sign = if (leftMs < 0) "+" else ""
    val text = if (ms >= HOUR_MS) {
        String.format(Locale.US, "%d:%02d h", ms / HOUR_MS, (ms % HOUR_MS) / MINUTE_MS)
    } else {
        String.format(Locale.US, "%d:%02d", ms / MINUTE_MS, (ms % MINUTE_MS) / TICK_MS)
    }
    return sign + text
}

private fun colourOf(stage: ClockStage): Color = when (stage) {
    ClockStage.Normal -> Graphite.Text2
    ClockStage.Late -> Graphite.Accent
    ClockStage.Overdue -> Graphite.Crit
}

@Composable
fun PromiseClock(promiseAt: Long, promiseFrom: Long?, clock: ClockView, linkDown: Boolean) {
    val receivedAt = remember(clock) { SystemClock.elapsedRealtime() }
    val lostAt = remember(linkDown) { if (linkDown) SystemClock.elapsedRealtime() else null }
    var elapsed by remember(clock) { mutableLongStateOf(0L) }
    LaunchedEffect(clock) {
        while (true) {
            elapsed = SystemClock.elapsedRealtime() - receivedAt
            delay(TICK_MS)
        }
    }
    val now = clock.now + elapsed
    val lostFor = lostAt?.let { receivedAt + elapsed - it }
    val stale = isStale(lostFor)
    val stage = clockStage(now, promiseFrom, promiseAt)
    val colour = if (stale) Graphite.Text3 else colourOf(stage)
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.spacing.s1)) {
        ClockValue(countdown(promiseAt - now), stage, colour, stale)
        usedShare(now, promiseFrom, promiseAt)?.takeIf { !stale }?.let { UsedBar(it, colour) }
        if (stale && lostFor != null) {
            Text(
                stringResource(R.string.job_last_sync, dayTime(now - lostFor, now)),
                style = MaterialTheme.typography.bodyMedium,
                color = Graphite.Text2,
            )
        }
        Text(
            stringResource(R.string.job_promised_by, dayTime(promiseAt, now)),
            style = MaterialTheme.typography.bodyMedium,
            color = Graphite.Text2,
        )
    }
}

@Composable
private fun ClockValue(text: String, stage: ClockStage, colour: Color, stale: Boolean) {
    val outline = if (stale) {
        Modifier.drawBehind {
            drawRect(Graphite.LineStrong, style = Stroke(width = 1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(DASH)))
        }
    } else {
        Modifier
    }
    Row(
        outline.padding(horizontal = Tokens.spacing.s2),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Tokens.spacing.s2),
    ) {
        Text(text, style = MaterialTheme.typography.displaySmall, color = colour)
        val word = when (stage) {
            ClockStage.Normal -> null
            ClockStage.Late -> R.string.job_late
            ClockStage.Overdue -> R.string.job_overdue
        }
        word?.let {
            Text(
                stringResource(it),
                style = MaterialTheme.typography.labelMedium,
                color = colour,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
    }
}

@Composable
private fun UsedBar(share: Float, colour: Color) {
    Box(Modifier.fillMaxWidth().height(BAR).background(Graphite.Line)) {
        Box(Modifier.fillMaxWidth(share).height(BAR).background(colour))
    }
}
