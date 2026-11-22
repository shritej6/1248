package app.vision.volunteer.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.vision.volunteer.R
import app.vision.volunteer.data.Outcome
import app.vision.volunteer.ui.theme.Graphite
import app.vision.volunteer.ui.theme.Tokens

private val MARK = 8.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DoneSheet(onSend: (Outcome, String?) -> Unit, onDismiss: () -> Unit) {
    var picked by rememberSaveable { mutableStateOf<Outcome?>(null) }
    var note by rememberSaveable { mutableStateOf("") }
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        shape = MaterialTheme.shapes.extraSmall,
        containerColor = Graphite.BgPanel,
        contentColor = Graphite.Text,
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(start = Tokens.spacing.s4, end = Tokens.spacing.s4, bottom = Tokens.spacing.s6),
            verticalArrangement = Arrangement.spacedBy(Tokens.spacing.s3),
        ) {
            Text(
                stringResource(R.string.done_title),
                style = MaterialTheme.typography.titleLarge,
                color = Graphite.Text,
                modifier = Modifier.semantics { heading() },
            )
            OutcomeChoices(picked, onPick = { picked = it })
            NoteField(note, stringResource(R.string.done_note), onChange = { note = it })
            AppButton(
                label = stringResource(R.string.done_send),
                onClick = { picked?.let { onSend(it, note.trim().ifEmpty { null }) } },
                height = Tokens.sizes.mainButton,
                disabledReason = if (picked == null) stringResource(R.string.done_pick_first) else null,
            )
        }
    }
}

@Composable
private fun OutcomeChoices(picked: Outcome?, onPick: (Outcome) -> Unit) {
    Column(Modifier.selectableGroup(), verticalArrangement = Arrangement.spacedBy(Tokens.spacing.s2)) {
        Outcome.entries.forEach { outcome ->
            OutcomeRow(label = stringResource(outcomeLabel(outcome)), selected = picked == outcome) { onPick(outcome) }
        }
    }
}

@Composable
private fun OutcomeRow(label: String, selected: Boolean, onClick: () -> Unit) {
    val shape = MaterialTheme.shapes.extraSmall
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = Tokens.sizes.mainButton)
            .background(if (selected) Graphite.BgRaised else Graphite.BgPanel, shape)
            .border(Tokens.sizes.hairline, if (selected) Graphite.Text else Graphite.LineStrong, shape)
            .selectable(selected = selected, role = Role.RadioButton, onClick = onClick)
            .padding(horizontal = Tokens.spacing.s4),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Tokens.spacing.s3),
    ) {
        Box(
            Modifier
                .size(MARK)
                .border(Tokens.sizes.hairline, Graphite.Text, shape)
                .background(if (selected) Graphite.Text else Graphite.BgPanel, shape),
        )
        Text(label.uppercase(), style = MaterialTheme.typography.labelLarge, color = Graphite.Text)
    }
}

private fun outcomeLabel(outcome: Outcome): Int = when (outcome) {
    Outcome.Done -> R.string.done_as_asked
    Outcome.Partly -> R.string.done_part
    Outcome.NotDone -> R.string.done_not
}
