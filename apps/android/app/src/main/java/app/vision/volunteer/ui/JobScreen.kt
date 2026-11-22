package app.vision.volunteer.ui

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import app.vision.volunteer.R
import app.vision.volunteer.data.JobAction
import app.vision.volunteer.data.JobCard
import app.vision.volunteer.data.Outcome
import app.vision.volunteer.ui.theme.Graphite
import app.vision.volunteer.ui.theme.Tokens
import kotlinx.coroutines.delay

private const val UNDO_SECONDS = 5
private const val TICK_MS = 1_000L
private const val DONE_HOLD_MS = 800L
private const val HELP_HOLD_MS = 1_000L
private val UNDO_WIDTH = 120.dp

data class JobActions(
    val onStatus: (JobAction) -> Unit,
    val onDone: (Outcome, String?) -> Unit,
    val onHelp: (String?) -> Unit,
    val onHandOff: (String) -> Unit,
    val onBack: () -> Unit,
    val onRetry: () -> Unit,
)

private sealed interface Waiting {
    data class Status(val action: JobAction) : Waiting
    data object Help : Waiting
}

@Composable
fun JobScreen(state: UiState.Job, actions: JobActions) {
    val card = state.card
    var waiting by remember(card.job) { mutableStateOf<Waiting?>(null) }
    var sheet by remember(card.job) { mutableStateOf(false) }
    var handOff by remember(card.job) { mutableStateOf(false) }
    KeepScreenOn()
    BackHandler(onBack = actions.onBack)
    AppFrame(clock = card.clock, live = true, action = { HomeLink(actions.onBack) }) {
        state.error?.let { FailedRow(it, state.canRetry, state.helpText, actions.onRetry) }
        Column(
            Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(Tokens.spacing.s4),
            verticalArrangement = Arrangement.spacedBy(Tokens.spacing.s3),
        ) {
            JobDetails(card, state.sending, state.linkDown)
            if (JobAction.HandOff in card.actions) {
                SecondaryButton(stringResource(R.string.job_hand_off), enabled = !state.sending) { handOff = true }
            }
        }
        ActionBar(
            card = card,
            sending = state.sending,
            waiting = waiting,
            onWait = { waiting = it },
            onDone = { sheet = true },
        )
    }
    WaitingSender(waiting, actions) { waiting = null }
    if (sheet) DoneSheet(onSend = { outcome, note -> sheet = false; actions.onDone(outcome, note) }, onDismiss = { sheet = false })
    if (handOff) {
        NoteDialog(
            title = stringResource(R.string.hand_off_title),
            hint = stringResource(R.string.hand_off_hint),
            onConfirm = { note -> handOff = false; actions.onHandOff(note) },
            onDismiss = { handOff = false },
        )
    }
}

@Composable
private fun WaitingSender(waiting: Waiting?, actions: JobActions, onSent: () -> Unit) {
    LaunchedEffect(waiting) {
        val current = waiting ?: return@LaunchedEffect
        delay(UNDO_SECONDS * TICK_MS)
        onSent()
        when (current) {
            is Waiting.Status -> actions.onStatus(current.action)
            Waiting.Help -> actions.onHelp(null)
        }
    }
}

@Composable
private fun KeepScreenOn() {
    val view = LocalView.current
    DisposableEffect(view) {
        view.keepScreenOn = true
        onDispose { view.keepScreenOn = false }
    }
}

@Composable
private fun HomeLink(onBack: () -> Unit) {
    Box(
        Modifier.heightIn(min = Tokens.sizes.button).clickable(role = Role.Button, onClick = onBack).padding(horizontal = Tokens.spacing.s3),
        contentAlignment = Alignment.Center,
    ) {
        Text(stringResource(R.string.job_home).uppercase(), style = MaterialTheme.typography.labelLarge, color = Graphite.Text2)
    }
}

@Composable
private fun FailedRow(text: String, canRetry: Boolean, helpText: String?, onRetry: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().background(Graphite.BgRaised).padding(horizontal = Tokens.spacing.s4, vertical = Tokens.spacing.s3),
        verticalArrangement = Arrangement.spacedBy(Tokens.spacing.s2),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.spacing.s2)) {
            ReceiptMark(Mark.Triangle, Graphite.Crit)
            Text(
                text,
                style = MaterialTheme.typography.bodyMedium,
                color = Graphite.Text,
                modifier = Modifier.weight(1f).semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
        if (canRetry) SecondaryButton(stringResource(R.string.job_retry), enabled = true, onClick = onRetry)
        helpText?.let { HelpTextButton(it) }
    }
}

@Composable
private fun HelpTextButton(body: String) {
    val context = LocalContext.current
    var noSms by remember(body) { mutableStateOf(false) }
    SecondaryButton(stringResource(R.string.job_send_text), enabled = true) {
        val intent = Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:")).putExtra("sms_body", body)
        try {
            context.startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            noSms = true
        }
    }
    if (noSms) Text(stringResource(R.string.job_no_sms), style = MaterialTheme.typography.bodySmall, color = Graphite.Text2)
}

@Composable
private fun JobDetails(card: JobCard, sending: Boolean, linkDown: Boolean) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.spacing.s3)) {
        Text(
            stringResource(R.string.held_by, card.routeCode),
            style = Tokens.routeCode.copy(color = Graphite.Text),
            modifier = Modifier.weight(1f, fill = false).semantics { heading() },
        )
        StatusChip(card.status)
    }
    PromiseClock(card.promiseAt, card.promiseFrom, card.clock, linkDown)
    Field(stringResource(R.string.job_label_need)) { Value(card.needLabel, MaterialTheme.typography.titleLarge) }
    Field(stringResource(R.string.job_label_name)) { Value(card.firstName) }
    Field(stringResource(R.string.job_label_address)) { AddressBlock(card.address) }
    Field(stringResource(R.string.job_label_words)) { QuoteBox(card.words) }
    card.accessNotes?.let { notes -> Field(stringResource(R.string.job_label_access)) { Value(notes) } }
    if (card.thread.isNotEmpty() || card.steps.isNotEmpty() || sending) {
        Field(stringResource(R.string.job_label_thread)) { JobTrail(card.steps, card.thread, card.clock.now, sending) }
    }
}

@Composable
private fun Field(label: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.spacing.s1)) {
        Text(label.uppercase(), style = MaterialTheme.typography.labelMedium, color = Graphite.Text2)
        content()
    }
}

@Composable
private fun Value(text: String, style: TextStyle = MaterialTheme.typography.bodyLarge) {
    Text(text, style = style, color = Graphite.Text)
}

@Composable
private fun AddressBlock(address: String?) {
    if (address == null) {
        Value(stringResource(R.string.job_no_address))
        return
    }
    val context = LocalContext.current
    var noMaps by remember(address) { mutableStateOf(false) }
    Value(address)
    SecondaryButton(stringResource(R.string.job_navigate), enabled = true) {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=" + Uri.encode(address)))
        try {
            context.startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            noMaps = true
        }
    }
    if (noMaps) Text(stringResource(R.string.job_no_maps), style = MaterialTheme.typography.bodySmall, color = Graphite.Text2)
}

@Composable
private fun QuoteBox(words: String) {
    val bar = 2.dp
    Text(
        words,
        style = MaterialTheme.typography.bodyLarge,
        color = Graphite.Text,
        modifier = Modifier
            .fillMaxWidth()
            .background(Graphite.BgInset)
            .drawBehind { drawRect(Graphite.Text3, size = size.copy(width = bar.toPx())) }
            .padding(start = Tokens.spacing.s3, end = Tokens.spacing.s3, top = Tokens.spacing.s2, bottom = Tokens.spacing.s2),
    )
}

@Composable
private fun ActionBar(card: JobCard, sending: Boolean, waiting: Waiting?, onWait: (Waiting?) -> Unit, onDone: () -> Unit) {
    val next = listOf(JobAction.OnMyWay, JobAction.There, JobAction.Done).firstOrNull { it in card.actions }
    val help = JobAction.Help in card.actions
    if (next == null && !help) {
        Text(
            stringResource(R.string.job_no_steps),
            style = MaterialTheme.typography.bodyMedium,
            color = Graphite.Text2,
            modifier = Modifier.fillMaxWidth().background(Graphite.BgInset).padding(Tokens.spacing.s4),
        )
        return
    }
    Column(
        Modifier.fillMaxWidth().background(Graphite.BgInset).padding(Tokens.spacing.s4),
        verticalArrangement = Arrangement.spacedBy(Tokens.spacing.s2),
    ) {
        if (waiting != null) {
            WaitingRow(waiting, onUndo = { onWait(null) })
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(Tokens.spacing.s2)) {
                if (help) HelpButton(enabled = !sending) { onWait(Waiting.Help) }
                next?.let { NextButton(it, sending, Modifier.weight(1f), onWait, onDone) }
            }
            hintFor(next, sending)?.let { Text(stringResource(it), style = MaterialTheme.typography.bodySmall, color = Graphite.Text3) }
        }
    }
}

@Composable
private fun NextButton(next: JobAction, sending: Boolean, modifier: Modifier, onWait: (Waiting?) -> Unit, onDone: () -> Unit) {
    val reason = if (sending) stringResource(R.string.job_waiting) else null
    when (next) {
        JobAction.Done -> HoldButton(
            label = stringResource(R.string.job_done),
            holdMs = DONE_HOLD_MS,
            enabled = !sending,
            fill = Graphite.Accent,
            content = Graphite.OnAccent,
            hint = stringResource(R.string.job_hold_done),
            actionLabel = stringResource(R.string.job_action_done),
            modifier = modifier.height(Tokens.sizes.mainButton),
            onHeld = onDone,
        )
        else -> AppButton(
            label = stringResource(if (next == JobAction.OnMyWay) R.string.job_on_my_way else R.string.job_there),
            onClick = { onWait(Waiting.Status(next)) },
            modifier = modifier,
            height = Tokens.sizes.mainButton,
            disabledReason = reason,
        )
    }
}

@Composable
private fun HelpButton(enabled: Boolean, onHeld: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Tokens.spacing.s1)) {
        HoldButton(
            label = null,
            holdMs = HELP_HOLD_MS,
            enabled = enabled,
            fill = Graphite.CritFill,
            content = Graphite.White,
            hint = stringResource(R.string.job_hold_help),
            actionLabel = stringResource(R.string.job_action_help),
            modifier = Modifier.width(Tokens.sizes.mainButton).height(Tokens.sizes.mainButton),
            onHeld = onHeld,
        )
        Text(stringResource(R.string.job_help).uppercase(), style = MaterialTheme.typography.labelMedium, color = Graphite.Text)
    }
}

@Composable
private fun WaitingRow(waiting: Waiting, onUndo: () -> Unit) {
    var left by remember(waiting) { mutableIntStateOf(UNDO_SECONDS) }
    LaunchedEffect(waiting) {
        while (left > 1) {
            delay(TICK_MS)
            left -= 1
        }
    }
    val text = when (waiting) {
        is Waiting.Status -> stringResource(
            R.string.job_sending_in,
            stringResource(if (waiting.action == JobAction.OnMyWay) R.string.job_on_my_way else R.string.job_there).uppercase(),
            left,
        )
        Waiting.Help -> stringResource(R.string.job_help_in, left)
    }
    val undo = stringResource(if (waiting == Waiting.Help) R.string.job_cancel else R.string.job_undo)
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.spacing.s3)) {
        Text(
            text,
            style = MaterialTheme.typography.bodyLarge,
            color = Graphite.Text,
            modifier = Modifier.weight(1f).semantics { liveRegion = LiveRegionMode.Polite },
        )
        Box(Modifier.width(UNDO_WIDTH)) { SecondaryButton(undo, enabled = true, onClick = onUndo) }
    }
}

private fun hintFor(next: JobAction?, sending: Boolean): Int? = when {
    sending && (next == JobAction.OnMyWay || next == JobAction.There) -> null
    sending -> R.string.job_waiting
    next == JobAction.Done -> R.string.job_hint_done
    else -> R.string.job_hint_help
}
