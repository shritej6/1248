package app.vision.volunteer.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.unit.dp
import app.vision.volunteer.R
import app.vision.volunteer.data.ClockView
import app.vision.volunteer.data.HomeJob
import app.vision.volunteer.data.JobStatus
import app.vision.volunteer.data.VolunteerHome
import app.vision.volunteer.ui.theme.Graphite
import app.vision.volunteer.ui.theme.Tokens
import kotlinx.coroutines.delay
import java.util.Locale

private const val TAKEN_BANNER_MS = 4_000L

data class HomeActions(
    val onToggleOn: (Boolean) -> Unit,
    val onAccept: (String) -> Unit,
    val onPass: (String) -> Unit,
    val onOpenJob: (String) -> Unit,
    val onBannerDone: () -> Unit,
)

@Composable
fun AppFrame(
    clock: ClockView?,
    live: Boolean?,
    action: (@Composable () -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(Modifier.fillMaxSize().background(Graphite.BgApp).safeDrawingPadding()) {
        if (clock != null && clock.offsetMs > 0) DemoClockBar(clock)
        AppTopBar(live, action)
        content()
    }
}

@Composable
private fun AppTopBar(live: Boolean?, action: (@Composable () -> Unit)?) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = Tokens.sizes.topBar).background(Graphite.BgInset).padding(horizontal = Tokens.spacing.s4),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(stringResource(R.string.logo_word), style = MaterialTheme.typography.titleMedium, color = Graphite.Text)
        Spacer(Modifier.weight(1f))
        action?.invoke()
        live?.let { ConnectionChip(it) }
    }
}

@Composable
private fun ConnectionChip(live: Boolean) {
    val colour = if (live) Graphite.Ok else Graphite.Crit
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.spacing.s1)) {
        Canvas(Modifier.size(Tokens.spacing.s2)) {
            if (live) drawCircle(colour) else drawRect(colour)
        }
        Text(
            stringResource(if (live) R.string.chip_live else R.string.chip_offline),
            style = MaterialTheme.typography.labelMedium,
            color = colour,
        )
    }
}

@Composable
private fun DemoClockBar(clock: ClockView) {
    val stripe = Tokens.spacing.s2
    Box(
        Modifier
            .fillMaxWidth()
            .heightIn(min = DEMO_BAR)
            .clipToBounds()
            .background(Graphite.BgApp)
            .drawBehind {
                val step = stripe.toPx() * 2
                var x = -size.height
                while (x < size.width) {
                    drawLine(Graphite.Accent, Offset(x, size.height), Offset(x + size.height, 0f), stripe.toPx())
                    x += step
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            stringResource(R.string.demo_clock, clockTime(clock.now), clockTime(clock.now - clock.offsetMs)),
            style = MaterialTheme.typography.labelMedium,
            color = Graphite.Text,
            modifier = Modifier.background(Graphite.BgInset).padding(horizontal = Tokens.spacing.s2),
        )
    }
}

private val DEMO_BAR = 28.dp

@Composable
fun HomeScreen(state: UiState.Home, actions: HomeActions) {
    val home = state.home
    LaunchedEffect(state.banner) {
        if (state.banner == Banner.Taken) {
            delay(TAKEN_BANNER_MS)
            actions.onBannerDone()
        }
    }
    AppFrame(clock = home.clock, live = true) {
        state.banner?.let { BannerBar(it, actions.onBannerDone) }
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = Tokens.spacing.s4),
            verticalArrangement = Arrangement.spacedBy(Tokens.spacing.s3),
        ) {
            OnSwitchRow(on = home.member.on, onToggle = actions.onToggleOn)
            MemberFacts(home)
            OffersSection(state, actions)
            JobsSection(home.jobs, actions.onOpenJob)
            RecordLine(home)
            Spacer(Modifier.height(Tokens.spacing.s4))
        }
    }
}

@Composable
private fun BannerBar(banner: Banner, onClose: () -> Unit) {
    val text = when (banner) {
        Banner.Taken -> stringResource(R.string.banner_taken)
        is Banner.Error -> banner.text
    }
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = Tokens.sizes.button)
            .background(Graphite.BgRaised)
            .padding(start = Tokens.spacing.s4)
            .semantics { liveRegion = LiveRegionMode.Polite },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text, style = MaterialTheme.typography.bodyMedium, color = Graphite.Text, modifier = Modifier.weight(1f))
        if (banner is Banner.Error) {
            Box(
                Modifier.heightIn(min = Tokens.sizes.button).clickable(role = Role.Button, onClick = onClose).padding(horizontal = Tokens.spacing.s4),
                contentAlignment = Alignment.Center,
            ) {
                Text(stringResource(R.string.banner_close), style = MaterialTheme.typography.labelLarge, color = Graphite.Text2)
            }
        }
    }
}

@Composable
private fun OnSwitchRow(on: Boolean, onToggle: (Boolean) -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = Tokens.sizes.row)
            .toggleable(value = on, role = Role.Switch, onValueChange = onToggle),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            stringResource(if (on) R.string.switch_on else R.string.switch_off),
            style = MaterialTheme.typography.titleMedium,
            color = Graphite.Text,
            modifier = Modifier.weight(1f),
        )
        Switch(
            checked = on,
            onCheckedChange = null,
            colors = SwitchDefaults.colors(
                checkedTrackColor = Graphite.Accent,
                checkedThumbColor = Graphite.OnAccent,
                checkedBorderColor = Graphite.Accent,
                uncheckedTrackColor = Graphite.BgRaised,
                uncheckedThumbColor = Graphite.Text3,
                uncheckedBorderColor = Graphite.LineStrong,
            ),
        )
    }
}

@Composable
private fun MemberFacts(home: VolunteerHome) {
    val skills = home.member.skills.joinToString(", ").ifEmpty { stringResource(R.string.home_none) }
    Text(stringResource(R.string.home_skills, skills), style = MaterialTheme.typography.bodyMedium, color = Graphite.Text2)
    home.member.zip?.let {
        Text(stringResource(R.string.home_zone, it), style = MaterialTheme.typography.bodyMedium, color = Graphite.Text2)
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(
        text.uppercase(),
        style = MaterialTheme.typography.labelMedium,
        color = Graphite.Text2,
        modifier = Modifier.padding(top = Tokens.spacing.s2),
    )
}

@Composable
private fun OffersSection(state: UiState.Home, actions: HomeActions) {
    val home = state.home
    SectionLabel(stringResource(R.string.home_offers, home.offers.size))
    when {
        !home.member.on -> EmptyLine(stringResource(R.string.home_off))
        home.offers.isEmpty() -> EmptyLine(stringResource(R.string.home_no_offers))
        else -> home.offers.forEach { offer ->
            OfferCard(
                offer = offer,
                nowMs = home.clock.now,
                accepting = state.accepting,
                onAccept = { actions.onAccept(offer.job) },
                onPass = { actions.onPass(offer.job) },
            )
        }
    }
}

@Composable
private fun EmptyLine(text: String) {
    Text(text, style = MaterialTheme.typography.bodyMedium, color = Graphite.Text2)
}

@Composable
private fun JobsSection(jobs: List<HomeJob>, onOpenJob: (String) -> Unit) {
    if (jobs.isEmpty()) return
    SectionLabel(stringResource(R.string.home_jobs, jobs.size))
    jobs.forEach { job ->
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = Tokens.sizes.row)
                .border(Tokens.sizes.hairline, Graphite.Line, MaterialTheme.shapes.extraSmall)
                .clickable(role = Role.Button) { onOpenJob(job.job) }
                .padding(horizontal = Tokens.spacing.s3, vertical = Tokens.spacing.s2),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(job.needLabel, style = MaterialTheme.typography.titleSmall, color = Graphite.Text, modifier = Modifier.weight(1f))
            Spacer(Modifier.width(Tokens.spacing.s2))
            StatusChip(job.status)
        }
    }
}

@Composable
private fun RecordLine(home: VolunteerHome) {
    val record = home.record
    val jobs = pluralStringResource(R.plurals.record_jobs, record.jobsDone, record.jobsDone)
    val hours = hoursText(record.hours)
    Text(
        monoNumbers(stringResource(R.string.home_record, jobs, hours), Tokens.routeCode.toSpanStyle()),
        style = MaterialTheme.typography.bodyMedium.copy(color = Graphite.Text),
        modifier = Modifier.padding(top = Tokens.spacing.s2),
    )
}

private val NUMBER = Regex("""\d+(\.\d+)?""")

fun monoNumbers(text: String, mono: SpanStyle): AnnotatedString = buildAnnotatedString {
    append(text)
    NUMBER.findAll(text).forEach { addStyle(mono, it.range.first, it.range.last + 1) }
}

fun hoursText(hours: Double): String {
    val whole = hours == Math.floor(hours)
    val number = if (whole) hours.toLong().toString() else String.format(Locale.US, "%.1f", hours)
    return if (hours == 1.0) "$number hour" else "$number hours"
}

@Composable
fun OfflineScreen(state: UiState.Offline, onRetry: () -> Unit) {
    AppFrame(clock = state.last?.clock, live = false) {
        Box(
            Modifier
                .fillMaxWidth()
                .heightIn(min = Tokens.spacing.s8)
                .background(Graphite.CritFill)
                .padding(horizontal = Tokens.spacing.s4, vertical = Tokens.spacing.s1),
            contentAlignment = Alignment.CenterStart,
        ) {
            Text(stringResource(R.string.offline_bar), style = MaterialTheme.typography.labelLarge, color = Graphite.White)
        }
        Column(
            Modifier.fillMaxSize().padding(Tokens.spacing.s4),
            verticalArrangement = Arrangement.spacedBy(Tokens.spacing.s3),
        ) {
            Text(stringResource(R.string.offline_text), style = MaterialTheme.typography.bodyLarge, color = Graphite.Text)
            state.last?.let { RecordLine(it) }
            Spacer(Modifier.weight(1f))
            AppButton(label = stringResource(R.string.offline_retry), onClick = onRetry, height = Tokens.sizes.mainButton)
        }
    }
}

@Composable
fun LoadingScreen() {
    AppFrame(clock = null, live = null) {
        Box(Modifier.fillMaxWidth().height(2.dp).background(Graphite.Accent))
        Text(
            stringResource(R.string.loading),
            style = MaterialTheme.typography.bodyLarge,
            color = Graphite.Text2,
            modifier = Modifier.padding(Tokens.spacing.s4),
        )
    }
}

internal enum class Mark { HollowCircle, FilledCircle, HollowSquare, FilledSquare, Chevron, ChevronBar, Check, Triangle, Hourglass, Dashed }

private data class ChipLook(val label: Int, val colour: Color, val mark: Mark)

private fun lookOf(status: JobStatus): ChipLook = when (status) {
    JobStatus.Planned -> ChipLook(R.string.status_planned, Graphite.Text, Mark.FilledCircle)
    JobStatus.Offered -> ChipLook(R.string.status_offered, Graphite.Text, Mark.HollowSquare)
    JobStatus.Accepted -> ChipLook(R.string.status_accepted, Graphite.Text, Mark.FilledSquare)
    JobStatus.OnMyWay -> ChipLook(R.string.status_on_my_way, Graphite.Text, Mark.Chevron)
    JobStatus.There -> ChipLook(R.string.status_there, Graphite.Text, Mark.ChevronBar)
    JobStatus.Done, JobStatus.Partly -> ChipLook(R.string.status_done, Graphite.Ok, Mark.Check)
    JobStatus.Helped -> ChipLook(R.string.status_helped, Graphite.Ok, Mark.Check)
    JobStatus.Mismatch -> ChipLook(R.string.status_mismatch, Graphite.Crit, Mark.Triangle)
    JobStatus.ConsentAsked, JobStatus.PartnerAsked, JobStatus.PartnerYes, JobStatus.GotIt ->
        ChipLook(R.string.status_waiting_partner, Graphite.Text2, Mark.Hourglass)
    JobStatus.Unmet -> ChipLook(R.string.status_unmet, Graphite.Text2, Mark.Dashed)
    JobStatus.Unreached -> ChipLook(R.string.status_unreached, Graphite.Text3, Mark.Dashed)
    JobStatus.Withdrawn -> ChipLook(R.string.status_withdrawn, Graphite.Text3, Mark.Dashed)
}

@Composable
internal fun StatusChip(status: JobStatus) {
    val look = lookOf(status)
    Row(
        Modifier
            .heightIn(min = 24.dp)
            .border(Tokens.sizes.hairline, look.colour, MaterialTheme.shapes.extraSmall)
            .padding(horizontal = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Tokens.spacing.s1),
    ) {
        Canvas(Modifier.size(Tokens.spacing.s2)) { drawMark(look.mark, look.colour) }
        Text(stringResource(look.label), style = MaterialTheme.typography.labelMedium, color = look.colour)
    }
}

internal fun DrawScope.drawMark(mark: Mark, colour: Color) {
    val w = size.width
    val line = Stroke(width = w / 6)
    when (mark) {
        Mark.HollowCircle -> drawCircle(colour, style = line)
        Mark.FilledCircle -> drawCircle(colour)
        Mark.HollowSquare -> drawRect(colour, style = line)
        Mark.FilledSquare -> drawRect(colour)
        Mark.Chevron -> drawPath(path(0f to 0f, w to w / 2, 0f to w), colour, style = line)
        Mark.ChevronBar -> {
            drawPath(path(0f to 0f, w * 0.7f to w / 2, 0f to w, closed = true), colour)
            drawLine(colour, Offset(w * 0.9f, 0f), Offset(w * 0.9f, w), w / 6)
        }
        Mark.Check -> drawPath(path(0f to w * 0.55f, w * 0.4f to w, w to 0f), colour, style = line)
        Mark.Triangle -> drawPath(path(w / 2 to 0f, w to w, 0f to w, closed = true), colour)
        Mark.Hourglass -> drawPath(path(0f to 0f, w to 0f, 0f to w, w to w, closed = true), colour)
        Mark.Dashed -> drawRect(colour, style = Stroke(width = w / 6, pathEffect = PathEffect.dashPathEffect(floatArrayOf(w / 4, w / 6))))
    }
}

private fun path(vararg points: Pair<Float, Float>, closed: Boolean = false): Path = Path().apply {
    points.forEachIndexed { i, (x, y) -> if (i == 0) moveTo(x, y) else lineTo(x, y) }
    if (closed) close()
}
