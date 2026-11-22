package app.vision.volunteer.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import app.vision.volunteer.R
import app.vision.volunteer.data.OfferView
import app.vision.volunteer.ui.theme.Graphite
import app.vision.volunteer.ui.theme.Tokens
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale

private val ZONE: ZoneId = ZoneId.of("America/Chicago")
private val TIME: DateTimeFormatter = DateTimeFormatter.ofPattern("h:mm a", Locale.US)
private val DAY_TIME: DateTimeFormatter = DateTimeFormatter.ofPattern("EEE h:mm a", Locale.US)
private val DATE_TIME: DateTimeFormatter = DateTimeFormatter.ofPattern("MMM d, yyyy h:mm a", Locale.US)

fun clockTime(atMs: Long): String = TIME.format(Instant.ofEpochMilli(atMs).atZone(ZONE))

fun dayTime(atMs: Long, nowMs: Long): String {
    val at = Instant.ofEpochMilli(atMs).atZone(ZONE)
    val days = ChronoUnit.DAYS.between(Instant.ofEpochMilli(nowMs).atZone(ZONE).toLocalDate(), at.toLocalDate())
    return when {
        days == 0L -> TIME.format(at)
        days in 1L..6L -> DAY_TIME.format(at)
        else -> DATE_TIME.format(at)
    }
}

fun miles(distance: Double): String = String.format(Locale.US, "%.1f mi", distance)

@Composable
fun OfferCard(offer: OfferView, nowMs: Long, accepting: String?, onAccept: () -> Unit, onPass: () -> Unit) {
    val waiting = stringResource(R.string.home_waiting_receipt)
    Column(
        Modifier
            .fillMaxWidth()
            .heightIn(min = Tokens.sizes.offerCard)
            .background(Graphite.BgPanel)
            .border(Tokens.sizes.hairline, Graphite.Line, MaterialTheme.shapes.extraSmall)
            .padding(Tokens.spacing.s3),
        verticalArrangement = Arrangement.spacedBy(Tokens.spacing.s1),
    ) {
        Text(
            offer.needLabel,
            style = MaterialTheme.typography.titleMedium,
            color = Graphite.Text,
            modifier = Modifier.semantics { heading() },
        )
        OfferFacts(offer, nowMs)
        offer.bring?.let {
            Text(stringResource(R.string.offer_bring, it), style = MaterialTheme.typography.bodyMedium, color = Graphite.Text2)
        }
        AppButton(
            label = stringResource(if (accepting == offer.job) R.string.offer_sending else R.string.offer_accept),
            onClick = onAccept,
            height = Tokens.sizes.mainButton,
            disabledReason = if (accepting != null) waiting else null,
            modifier = Modifier.padding(top = Tokens.spacing.s2),
        )
        PassButton(enabled = accepting == null, onPass = onPass)
    }
}

@Composable
private fun OfferFacts(offer: OfferView, nowMs: Long) {
    val facts = listOfNotNull(
        offer.distanceMiles?.let { miles(it) },
        stringResource(R.string.offer_by, dayTime(offer.promiseAt, nowMs)),
        if (offer.crew > 1) pluralStringResource(R.plurals.offer_crew, offer.crew, offer.crew) else null,
    )
    Row(horizontalArrangement = Arrangement.spacedBy(Tokens.spacing.s3)) {
        facts.forEach { Text(it, style = Tokens.routeCode.copy(color = Graphite.Text)) }
    }
}

@Composable
private fun PassButton(enabled: Boolean, onPass: () -> Unit) {
    OutlinedButton(
        onClick = onPass,
        enabled = enabled,
        shape = MaterialTheme.shapes.extraSmall,
        border = BorderStroke(Tokens.sizes.hairline, if (enabled) Graphite.LineStrong else Graphite.Line),
        contentPadding = PaddingValues(horizontal = Tokens.spacing.s4),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = Graphite.Text, disabledContentColor = Graphite.Text3),
        modifier = Modifier.fillMaxWidth().height(Tokens.sizes.button),
    ) {
        Text(stringResource(R.string.offer_pass), style = MaterialTheme.typography.labelLarge)
    }
}
