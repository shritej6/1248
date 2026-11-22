package app.vision.volunteer.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.window.Dialog
import app.vision.volunteer.R
import app.vision.volunteer.ui.theme.Graphite
import app.vision.volunteer.ui.theme.Tokens

private const val NOTE_LINES = 3

@Composable
fun NoteDialog(title: String, hint: String, onConfirm: (String) -> Unit, onDismiss: () -> Unit) {
    var note by rememberSaveable { mutableStateOf("") }
    Dialog(onDismissRequest = onDismiss) {
        Column(
            Modifier
                .fillMaxWidth()
                .background(Graphite.BgPanel, MaterialTheme.shapes.extraSmall)
                .border(Tokens.sizes.hairline, Graphite.Line, MaterialTheme.shapes.extraSmall)
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(Tokens.spacing.s4),
            verticalArrangement = Arrangement.spacedBy(Tokens.spacing.s3),
        ) {
            Text(
                title,
                style = MaterialTheme.typography.titleLarge,
                color = Graphite.Text,
                modifier = Modifier.semantics { heading() },
            )
            Text(hint, style = MaterialTheme.typography.bodyMedium, color = Graphite.Text2)
            NoteField(note, stringResource(R.string.hand_off_note), onChange = { note = it })
            AppButton(
                label = stringResource(R.string.hand_off_confirm),
                onClick = { if (note.isNotBlank()) onConfirm(note.trim()) },
                height = Tokens.sizes.mainButton,
                disabledReason = if (note.isBlank()) stringResource(R.string.hand_off_needs_note) else null,
            )
            SecondaryButton(stringResource(R.string.job_cancel), enabled = true, onClick = onDismiss)
        }
    }
}

@Composable
internal fun NoteField(value: String, label: String, onChange: (String) -> Unit) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        minLines = NOTE_LINES,
        label = { Text(label.uppercase(), style = MaterialTheme.typography.labelMedium, color = Graphite.Text2) },
        textStyle = MaterialTheme.typography.bodyLarge.copy(color = Graphite.Text),
        shape = MaterialTheme.shapes.extraSmall,
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
        colors = OutlinedTextFieldDefaults.colors(
            focusedContainerColor = Graphite.BgRaised,
            unfocusedContainerColor = Graphite.BgRaised,
            focusedBorderColor = Graphite.Info,
            unfocusedBorderColor = Graphite.LineStrong,
            cursorColor = Graphite.Info,
        ),
        modifier = Modifier.fillMaxWidth().heightIn(min = Tokens.sizes.mainButton),
    )
}
