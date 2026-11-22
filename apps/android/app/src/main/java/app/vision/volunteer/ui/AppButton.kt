package app.vision.volunteer.ui

import android.os.SystemClock
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.vision.volunteer.ui.theme.Graphite
import app.vision.volunteer.ui.theme.Tokens
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val HOLD_BAR = 4.dp
private const val FRAME_MS = 16L

@Composable
fun AppButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    height: Dp = Tokens.sizes.button,
    disabledReason: String? = null,
) {
    val enabled = disabledReason == null
    Column(modifier) {
        Button(
            onClick = onClick,
            enabled = enabled,
            shape = MaterialTheme.shapes.extraSmall,
            contentPadding = PaddingValues(horizontal = Tokens.spacing.s4),
            colors = ButtonDefaults.buttonColors(
                containerColor = Graphite.Accent,
                contentColor = Graphite.OnAccent,
                disabledContainerColor = Graphite.BgRaised,
                disabledContentColor = Graphite.Text3,
            ),
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = height)
                .semantics { if (disabledReason != null) stateDescription = disabledReason },
        ) {
            Text(label.uppercase(), style = MaterialTheme.typography.labelLarge)
        }
        if (disabledReason != null) {
            Text(
                disabledReason,
                style = MaterialTheme.typography.bodySmall,
                color = Graphite.Text3,
                modifier = Modifier.padding(top = Tokens.spacing.s1),
            )
        }
    }
}

@Composable
internal fun SecondaryButton(label: String, enabled: Boolean, onClick: () -> Unit) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        shape = MaterialTheme.shapes.extraSmall,
        border = BorderStroke(Tokens.sizes.hairline, if (enabled) Graphite.LineStrong else Graphite.Line),
        contentPadding = PaddingValues(horizontal = Tokens.spacing.s4),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = Graphite.Text, disabledContentColor = Graphite.Text3),
        modifier = Modifier.fillMaxWidth().heightIn(min = Tokens.sizes.button),
    ) {
        Text(label.uppercase(), style = MaterialTheme.typography.labelLarge)
    }
}

@Composable
internal fun HoldButton(
    label: String?,
    holdMs: Long,
    enabled: Boolean,
    fill: Color,
    content: Color,
    hint: String,
    actionLabel: String,
    modifier: Modifier,
    onHeld: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val held by rememberUpdatedState(onHeld)
    var progress by remember { mutableFloatStateOf(0f) }
    val ink = if (enabled) content else Graphite.Text3
    Box(
        modifier
            .background(if (enabled) fill else Graphite.BgRaised, MaterialTheme.shapes.extraSmall)
            .drawBehind {
                val bar = HOLD_BAR.toPx()
                drawRect(ink, topLeft = Offset(0f, size.height - bar), size = Size(size.width * progress, bar))
            }
            .holdToFire(scope, enabled, holdMs, onProgress = { progress = it }, onHeld = { held() })
            .holdSemantics(label ?: actionLabel, hint, actionLabel, enabled) { held() },
        contentAlignment = Alignment.Center,
    ) {
        if (label != null) {
            Text(label.uppercase(), style = MaterialTheme.typography.labelLarge, color = ink)
        } else {
            HoldIcon(ink)
        }
    }
}

private fun Modifier.holdToFire(
    scope: CoroutineScope,
    enabled: Boolean,
    holdMs: Long,
    onProgress: (Float) -> Unit,
    onHeld: () -> Unit,
): Modifier = pointerInput(enabled, holdMs) {
    if (!enabled) return@pointerInput
    awaitEachGesture {
        awaitFirstDown()
        val hold = scope.launch {
            val start = SystemClock.uptimeMillis()
            var progress = 0f
            while (progress < 1f) {
                progress = ((SystemClock.uptimeMillis() - start).toFloat() / holdMs).coerceAtMost(1f)
                onProgress(progress)
                delay(FRAME_MS)
            }
            onHeld()
        }
        waitForUpOrCancellation()
        hold.cancel()
        onProgress(0f)
    }
}

private fun Modifier.holdSemantics(name: String, hint: String, actionLabel: String, enabled: Boolean, onHeld: () -> Unit): Modifier =
    semantics(mergeDescendants = true) {
        role = Role.Button
        contentDescription = name
        stateDescription = hint
        if (enabled) {
            onClick(actionLabel) { onHeld(); true }
            customActions = listOf(CustomAccessibilityAction(actionLabel) { onHeld(); true })
        } else {
            disabled()
        }
    }

@Composable
private fun HoldIcon(ink: Color) {
    Canvas(Modifier.size(Tokens.spacing.s6)) {
        val path = Path().apply {
            moveTo(size.width / 2, 0f)
            lineTo(size.width, size.height)
            lineTo(0f, size.height)
            close()
        }
        drawPath(path, ink)
    }
}
