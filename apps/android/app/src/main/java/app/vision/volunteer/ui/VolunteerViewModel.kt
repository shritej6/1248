package app.vision.volunteer.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.vision.volunteer.data.CommandOutcome
import app.vision.volunteer.data.HubApi
import app.vision.volunteer.data.ErrorCode
import app.vision.volunteer.data.HubException
import app.vision.volunteer.data.JobAction
import app.vision.volunteer.data.LiveChannel
import app.vision.volunteer.data.LiveEvent
import app.vision.volunteer.data.LiveMessage
import app.vision.volunteer.data.OfferClosedReason
import app.vision.volunteer.data.OfferView
import app.vision.volunteer.data.Outcome
import app.vision.volunteer.data.SessionStore
import app.vision.volunteer.data.VolunteerCommand
import app.vision.volunteer.data.VolunteerHome
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class VolunteerViewModel(
    private val api: HubApi,
    private val live: LiveChannel,
    private val session: SessionStore,
) : ViewModel() {
    private val mutableState = MutableStateFlow<UiState>(UiState.Loading)
    val state: StateFlow<UiState> = mutableState.asStateFlow()

    private var lastHome: VolunteerHome? = null
    private var liveJob: Job? = null
    private val pendingIds = mutableMapOf<String, String>()
    private var retrySend: (() -> Unit)? = null

    init {
        viewModelScope.launch {
            if (session.session() == null) mutableState.value = UiState.NeedsJoin(error = null) else start()
        }
    }

    fun onJoin(code: String) {
        mutableState.value = UiState.Loading
        viewModelScope.launch {
            try {
                api.join(code)
                start()
            } catch (e: HubException) {
                mutableState.value = UiState.NeedsJoin(error = e.code)
            }
        }
    }

    fun onToggleOn(on: Boolean) {
        viewModelScope.launch {
            val key = "member.set_on:$on"
            val outcome = api.send(VolunteerCommand.SetOn(id = idFor(key), on = on))
            settle(key, outcome)
            if (outcome == CommandOutcome.Ok) refreshHome() else showBanner(bannerFor(outcome))
        }
    }

    fun onAccept(job: String) {
        val current = mutableState.value as? UiState.Home ?: return
        if (current.accepting != null) return
        mutableState.value = current.copy(banner = null, accepting = job)
        viewModelScope.launch {
            val key = "offer.accept:$job"
            val outcome = api.send(VolunteerCommand.Accept(id = idFor(key), job = job))
            settle(key, outcome)
            when {
                outcome == CommandOutcome.Ok -> openJob(job)
                outcome == CommandOutcome.Rejected(ErrorCode.Taken) -> dropOffer(job, Banner.Taken)
                else -> showBanner(bannerFor(outcome))
            }
        }
    }

    fun onPass(job: String) {
        viewModelScope.launch {
            val key = "offer.pass:$job"
            val outcome = api.send(VolunteerCommand.Pass(id = idFor(key), job = job))
            settle(key, outcome)
            if (outcome == CommandOutcome.Network) showBanner(bannerFor(outcome)) else dropOffer(job, banner = null)
        }
    }

    fun onOpenJob(job: String) {
        viewModelScope.launch { openJob(job) }
    }

    fun onStatus(action: JobAction) {
        when (action) {
            JobAction.OnMyWay -> sendForJob(action, "job.on_my_way", toHome = false) { id, job -> VolunteerCommand.OnMyWay(id, job) }
            JobAction.There -> sendForJob(action, "job.there", toHome = false) { id, job -> VolunteerCommand.There(id, job) }
            JobAction.Done, JobAction.Help, JobAction.HandOff -> Unit
        }
    }

    fun onDone(outcome: Outcome, note: String?) {
        val text = note?.trim()?.ifEmpty { null }
        sendForJob(JobAction.Done, "job.done:$outcome:$text", toHome = true) { id, job ->
            VolunteerCommand.Done(id = id, job = job, outcome = outcome, note = text)
        }
    }

    fun onHelp(note: String?) {
        val text = note?.trim()?.ifEmpty { null }
        sendForJob(JobAction.Help, "job.help:$text", toHome = false) { id, job -> VolunteerCommand.Help(id = id, job = job, note = text) }
    }

    fun onHandOff(note: String) {
        val text = note.trim()
        if (text.isEmpty()) return
        sendForJob(JobAction.HandOff, "job.hand_off:$text", toHome = true) { id, job ->
            VolunteerCommand.HandOff(id = id, job = job, note = text)
        }
    }

    fun onBack() {
        if (mutableState.value !is UiState.Job) return
        mutableState.value = lastHome?.let { UiState.Home(home = it, banner = null) } ?: UiState.Loading
        viewModelScope.launch { refreshHome() }
    }

    fun onRetrySend() {
        val retry = retrySend ?: return
        retrySend = null
        retry()
    }

    fun onRetry() {
        mutableState.value = UiState.Loading
        viewModelScope.launch { start() }
    }

    fun onBannerDone() {
        val current = mutableState.value as? UiState.Home ?: return
        mutableState.value = current.copy(banner = null)
    }

    private fun sendForJob(
        action: JobAction,
        key: String,
        toHome: Boolean,
        build: (id: String, job: String) -> VolunteerCommand,
    ) {
        val current = mutableState.value as? UiState.Job ?: return
        if (current.sending || action !in current.card.actions) return
        val job = current.card.job
        val fullKey = "$key:$job"
        mutableState.value = current.copy(sending = true, error = null, canRetry = false, helpText = null)
        retrySend = null
        viewModelScope.launch {
            val outcome = api.send(build(idFor(fullKey), job))
            settle(fullKey, outcome)
            when {
                outcome != CommandOutcome.Ok -> {
                    retrySend = { sendForJob(action, key, toHome, build) }
                    jobFailed(job, outcome, help = action == JobAction.Help)
                }
                toHome -> refreshHome()
                else -> loadJob(job, clearSending = true)
            }
        }
    }

    private fun jobFailed(job: String, outcome: CommandOutcome, help: Boolean) {
        val current = mutableState.value as? UiState.Job
        if (current == null || current.card.job != job) {
            retrySend = null
            if (current == null) showBanner(bannerFor(outcome)) else mutableState.value = current.copy(error = errorText(outcome))
            return
        }
        val text = if (help && outcome == CommandOutcome.Network) helpTextFor(current.card.routeCode) else null
        mutableState.value = current.copy(sending = false, error = errorText(outcome), canRetry = true, helpText = text)
    }

    private fun helpTextFor(routeCode: String): String = "HELP $routeCode: I need help at this job. Please call me."

    private suspend fun start() {
        refreshHome()
        listen()
    }

    private fun listen() {
        liveJob?.cancel()
        liveJob = viewModelScope.launch { live.connect().collect { onLive(it) } }
    }

    private suspend fun onLive(event: LiveEvent) {
        when (event) {
            LiveEvent.Reconnected -> {
                markLink(down = false)
                refreshViews()
            }
            LiveEvent.Lost -> markLink(down = true)
            LiveEvent.Offline -> mutableState.value = UiState.Offline(last = lastHome)
            is LiveEvent.Message -> {
                markLink(down = false)
                onMessage(event.message)
            }
        }
    }

    private fun markLink(down: Boolean) {
        val current = mutableState.value as? UiState.Job ?: return
        if (current.linkDown != down) mutableState.value = current.copy(linkDown = down)
    }

    private suspend fun onMessage(message: LiveMessage) {
        when (message) {
            LiveMessage.Changed -> refreshViews()
            is LiveMessage.Offer -> addOffer(message.offer)
            is LiveMessage.OfferClosed -> closeOffer(message.job, message.reason)
            is LiveMessage.Page -> Unit
        }
    }

    private suspend fun refreshViews() {
        val current = mutableState.value
        if (current is UiState.Job) {
            loadHome()?.let { lastHome = it }
            loadJob(current.card.job, clearSending = false)
        } else {
            refreshHome()
        }
    }

    private suspend fun refreshHome() {
        val home = loadHome() ?: return
        val banner = (mutableState.value as? UiState.Home)?.banner
        mutableState.value = UiState.Home(home = home, banner = banner)
    }

    private suspend fun loadHome(): VolunteerHome? = try {
        api.home().also { lastHome = it }
    } catch (e: HubException) {
        onLoadFailed(e)
        null
    }

    private suspend fun openJob(job: String) {
        try {
            mutableState.value = UiState.Job(card = api.job(job), sending = false)
        } catch (e: HubException) {
            if (e.code == ErrorCode.Unauthorized) onLoadFailed(e) else showBanner(Banner.Error(OPEN_FAILED))
        }
    }

    private suspend fun loadJob(job: String, clearSending: Boolean) {
        try {
            val card = api.job(job)
            val current = mutableState.value as? UiState.Job ?: return
            if (current.card.job != job) return
            mutableState.value = if (clearSending) UiState.Job(card = card, sending = false, linkDown = current.linkDown) else current.copy(card = card)
        } catch (e: HubException) {
            when (e.code) {
                ErrorCode.Forbidden, ErrorCode.NotFound -> leaveJob(job)
                else -> onLoadFailed(e)
            }
        }
    }

    private suspend fun leaveJob(job: String) {
        val current = mutableState.value as? UiState.Job ?: return
        if (current.card.job != job) return
        mutableState.value = lastHome?.let { UiState.Home(home = it, banner = null) } ?: UiState.Loading
        refreshHome()
    }

    private suspend fun onLoadFailed(e: HubException) {
        if (e.code == ErrorCode.Unauthorized) {
            session.clear()
            liveJob?.cancel()
            mutableState.value = UiState.NeedsJoin(error = e.code)
        } else {
            mutableState.value = UiState.Offline(last = lastHome)
        }
    }

    private fun addOffer(offer: OfferView) {
        val home = lastHome ?: return
        if (home.offers.any { it.job == offer.job }) return
        updateHome(home.copy(offers = home.offers + offer), banner = null, keepBanner = true)
    }

    private fun closeOffer(job: String, reason: OfferClosedReason) {
        val home = lastHome ?: return
        if (home.offers.none { it.job == job }) return
        if ((mutableState.value as? UiState.Home)?.accepting == job) return
        dropOffer(job, banner = if (reason == OfferClosedReason.Taken) Banner.Taken else null)
    }

    private fun dropOffer(job: String, banner: Banner?) {
        val home = lastHome ?: return
        updateHome(home.copy(offers = home.offers.filterNot { it.job == job }), banner = banner, keepBanner = banner == null)
    }

    private fun updateHome(home: VolunteerHome, banner: Banner?, keepBanner: Boolean) {
        lastHome = home
        val current = mutableState.value as? UiState.Home ?: return
        mutableState.value = current.copy(
            home = home,
            banner = if (keepBanner) current.banner else banner,
            accepting = current.accepting?.takeIf { id -> home.offers.any { it.job == id } },
        )
    }

    private fun showBanner(banner: Banner) {
        val current = mutableState.value as? UiState.Home ?: return
        mutableState.value = current.copy(banner = banner, accepting = null)
    }

    private fun idFor(key: String): String = pendingIds.getOrPut(key) { VolunteerCommand.newId() }

    private fun settle(key: String, outcome: CommandOutcome) {
        if (outcome != CommandOutcome.Network) pendingIds.remove(key)
    }

    private fun bannerFor(outcome: CommandOutcome): Banner = Banner.Error(errorText(outcome))

    private fun errorText(outcome: CommandOutcome): String = when (outcome) {
        is CommandOutcome.Rejected -> "Not sent. The hub said: ${outcome.code.wire}. Call the desk."
        else -> NOT_SENT
    }

    private companion object {
        const val NOT_SENT = "Not sent. No connection. Try again or call the desk."
        const val OPEN_FAILED = "Job not opened. Try again or call the desk."
    }
}
