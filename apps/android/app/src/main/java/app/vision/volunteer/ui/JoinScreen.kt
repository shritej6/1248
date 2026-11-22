package app.vision.volunteer.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import app.vision.volunteer.R
import app.vision.volunteer.data.ErrorCode
import app.vision.volunteer.ui.theme.Graphite
import app.vision.volunteer.ui.theme.Tokens

sealed interface JoinState {
    data class Ready(val error: JoinError?) : JoinState
    data object Sending : JoinState
    data object Joined : JoinState
}

sealed interface JoinError {
    data object Network : JoinError
    data object BadCode : JoinError
    data class Other(val code: String) : JoinError
}

@Composable
fun JoinScreen(state: JoinState, onJoin: (String) -> Unit) {
    Column(
        Modifier
            .fillMaxSize()
            .background(Graphite.BgApp)
            .safeDrawingPadding()
            .imePadding(),
    ) {
        TopBar()
        if (state is JoinState.Joined) {
            Text(
                stringResource(R.string.join_done),
                style = MaterialTheme.typography.bodyLarge,
                color = Graphite.Text,
                modifier = Modifier.padding(Tokens.spacing.s4),
            )
        } else {
            JoinForm(state, onJoin)
        }
    }
}

@Composable
private fun TopBar() {
    Box(
        Modifier
            .fillMaxWidth()
            .heightIn(min = Tokens.sizes.topBar)
            .background(Graphite.BgInset)
            .padding(horizontal = Tokens.spacing.s4),
        contentAlignment = Alignment.CenterStart,
    ) {
        Text(stringResource(R.string.logo_word), style = MaterialTheme.typography.titleMedium, color = Graphite.Text)
    }
}

@Composable
private fun JoinForm(state: JoinState, onJoin: (String) -> Unit) {
    var code by rememberSaveable { mutableStateOf("") }
    val sending = state is JoinState.Sending
    val submit = { if (!sending && code.isNotBlank()) onJoin(code.trim()) }
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(Tokens.spacing.s4),
        verticalArrangement = Arrangement.spacedBy(Tokens.spacing.s3),
    ) {
        Text(stringResource(R.string.join_title), style = MaterialTheme.typography.headlineSmall, color = Graphite.Text)
        Text(stringResource(R.string.join_hint), style = MaterialTheme.typography.bodyMedium, color = Graphite.Text2)
        CodeField(code, enabled = !sending, onChange = { code = it }, onDone = submit)
        (state as? JoinState.Ready)?.error?.let { ErrorLine(it) }
        Spacer(Modifier.weight(1f))
        AppButton(
            label = stringResource(if (sending) R.string.join_sending else R.string.join_button),
            onClick = submit,
            height = Tokens.sizes.mainButton,
            disabledReason = when {
                sending -> stringResource(R.string.join_waiting)
                code.isBlank() -> stringResource(R.string.join_needs_code)
                else -> null
            },
        )
    }
}

@Composable
private fun CodeField(code: String, enabled: Boolean, onChange: (String) -> Unit, onDone: () -> Unit) {
    OutlinedTextField(
        value = code,
        onValueChange = onChange,
        enabled = enabled,
        singleLine = true,
        label = {
            Text(
                stringResource(R.string.join_code_label).uppercase(),
                style = MaterialTheme.typography.labelMedium,
                color = Graphite.Text2,
            )
        },
        textStyle = Tokens.routeCode.copy(color = Graphite.Text),
        shape = MaterialTheme.shapes.extraSmall,
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { onDone() }),
        colors = OutlinedTextFieldDefaults.colors(
            focusedContainerColor = Graphite.BgRaised,
            unfocusedContainerColor = Graphite.BgRaised,
            disabledContainerColor = Graphite.BgRaised,
            focusedBorderColor = Graphite.Info,
            unfocusedBorderColor = Graphite.LineStrong,
            disabledBorderColor = Graphite.LineStrong,
            disabledTextColor = Graphite.Text3,
            cursorColor = Graphite.Info,
        ),
        modifier = Modifier.fillMaxWidth().heightIn(min = Tokens.sizes.mainButton),
    )
}

@Composable
private fun ErrorLine(error: JoinError) {
    val text = when (error) {
        JoinError.Network -> stringResource(R.string.join_error_network)
        JoinError.BadCode -> stringResource(R.string.join_error_code)
        is JoinError.Other -> stringResource(R.string.join_error_other, error.code)
    }
    Text(
        text,
        style = MaterialTheme.typography.bodyMedium,
        color = Graphite.Crit,
        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
    )
}

fun joinErrorFor(code: ErrorCode): JoinError = when (code) {
    ErrorCode.Network -> JoinError.Network
    ErrorCode.NotFound, ErrorCode.Unauthorized, ErrorCode.Forbidden, ErrorCode.Invalid -> JoinError.BadCode
    ErrorCode.TooLarge, ErrorCode.WrongState, ErrorCode.Taken, ErrorCode.NotEligible, ErrorCode.TooManyJobs,
    ErrorCode.NotEarned, ErrorCode.DemoOff, ErrorCode.RateLimited, ErrorCode.Internal,
    -> JoinError.Other(code.wire)
}
