package app.vision.volunteer.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import app.vision.volunteer.R
import app.vision.volunteer.data.JobStep
import app.vision.volunteer.data.ThreadLine
import app.vision.volunteer.data.ThreadSource
import app.vision.volunteer.ui.theme.Graphite
import app.vision.volunteer.ui.theme.Tokens

sealed interface TrailItem {
    val at: Long

    data class Step(val step: JobStep) : TrailItem {
        override val at: Long get() = step.at
    }

    data class Message(val line: ThreadLine) : TrailItem {
        override val at: Long get() = line.at
    }
}

fun trailOf(steps: List<JobStep>, thread: List<ThreadLine>): List<TrailItem> =
    (steps.map { TrailItem.Step(it) } + thread.map { TrailItem.Message(it) }).sortedBy { it.at }

@Composable
fun JobTrail(steps: List<JobStep>, thread: List<ThreadLine>, nowMs: Long, sending: Boolean) {
    trailOf(steps, thread).forEach { item ->
        when (item) {
            is TrailItem.Step -> StepRow(item.step, nowMs)
            is TrailItem.Message -> TrailRow(item.line, nowMs)
        }
    }
    if (sending) SendingRow()
}

@Composable
internal fun ReceiptMark(mark: Mark, colour: Color) {
    Canvas(Modifier.padding(top = Tokens.spacing.s1).size(Tokens.spacing.s3)) { drawMark(mark, colour) }
}

@Composable
private fun TrailTime(atMs: Long, nowMs: Long) {
    Text(dayTime(atMs, nowMs), style = Tokens.routeCode.copy(color = Graphite.Text2, fontSize = MaterialTheme.typography.bodySmall.fontSize))
}

@Composable
private fun Received() {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.spacing.s1)) {
        ReceiptMark(Mark.Check, Graphite.Ok)
        Text(stringResource(R.string.receipt_received), style = MaterialTheme.typography.labelMedium, color = Graphite.Text2)
    }
}

@Composable
private fun StepRow(step: JobStep, nowMs: Long) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = Tokens.spacing.s1),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Tokens.spacing.s2),
    ) {
        TrailTime(step.at, nowMs)
        Row(Modifier.weight(1f)) { StatusChip(step.status) }
        Received()
    }
}

@Composable
private fun TrailRow(line: ThreadLine, nowMs: Long) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = Tokens.spacing.s1),
        horizontalArrangement = Arrangement.spacedBy(Tokens.spacing.s2),
    ) {
        TrailTime(line.at, nowMs)
        Column(Modifier.weight(1f)) {
            Text(fromLabel(line.from).uppercase(), style = MaterialTheme.typography.labelMedium, color = Graphite.Text2)
            Text(line.text, style = MaterialTheme.typography.bodyMedium, color = Graphite.Text)
        }
        Received()
    }
}

@Composable
private fun SendingRow() {
    Row(
        Modifier.fillMaxWidth().padding(vertical = Tokens.spacing.s1),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Tokens.spacing.s2),
    ) {
        ReceiptMark(Mark.HollowCircle, Graphite.Text2)
        Text(stringResource(R.string.receipt_sent), style = MaterialTheme.typography.bodyMedium, color = Graphite.Text2)
    }
}

@Composable
private fun fromLabel(from: ThreadSource): String = stringResource(
    when (from) {
        ThreadSource.Resident -> R.string.from_resident
        ThreadSource.Desk -> R.string.from_desk
        ThreadSource.Volunteer -> R.string.from_volunteer
        ThreadSource.Partner -> R.string.from_partner
        ThreadSource.System -> R.string.from_system
    },
)
