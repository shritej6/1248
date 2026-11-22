package app.vision.volunteer

import app.vision.volunteer.data.ErrorCode
import app.vision.volunteer.data.HubException
import app.vision.volunteer.data.JobAction
import app.vision.volunteer.data.LiveEvent
import app.vision.volunteer.data.LiveMessage
import app.vision.volunteer.data.OfferClosedReason
import app.vision.volunteer.data.Outcome
import app.vision.volunteer.data.Session
import app.vision.volunteer.data.SessionStore
import app.vision.volunteer.data.VolunteerCommand
import app.vision.volunteer.ui.Banner
import app.vision.volunteer.ui.UiState
import app.vision.volunteer.ui.VolunteerViewModel
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class VolunteerViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val fakeHub = FakeHub()
    private val fakeLive = FakeLive()

    @Before fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun TestScope.store(joined: Boolean): SessionStore {
        val store = SessionStore(MemoryPreferences())
        if (joined) {
            launch { store.save(Session(token = "tok_1", memberId = "m_1", roles = listOf("volunteer"))) }
            advanceUntilIdle()
        }
        return store
    }

    private fun TestScope.vm(joined: Boolean = true): VolunteerViewModel {
        val vm = VolunteerViewModel(fakeHub, fakeLive, store(joined))
        advanceUntilIdle()
        return vm
    }

    private fun TestScope.homeVm(): VolunteerViewModel = vm()

    private fun TestScope.homeVmWithOffer(): VolunteerViewModel {
        fakeHub.homeView = sampleHome(offers = listOf(offer("j_1")))
        return vm()
    }

    private fun homeOf(vm: VolunteerViewModel) = vm.state.value as UiState.Home

    @Test fun noSessionNeedsJoin() = runTest(dispatcher) {
        val vm = vm(joined = false)
        assertEquals(UiState.NeedsJoin(null), vm.state.value)
    }

    @Test fun joinLoadsHomeAndListens() = runTest(dispatcher) {
        val vm = vm(joined = false)
        vm.onJoin(FakeHub.GOOD_CODE)
        advanceUntilIdle()
        assertTrue(vm.state.value is UiState.Home)
        assertEquals(1, fakeLive.connects)
    }

    @Test fun badJoinCodeKeepsTheJoinScreen() = runTest(dispatcher) {
        val vm = vm(joined = false)
        vm.onJoin("WRONG")
        advanceUntilIdle()
        assertEquals(UiState.NeedsJoin(ErrorCode.NotFound), vm.state.value)
    }

    @Test fun offerMessageAddsTheOffer() = runTest(dispatcher) {
        val vm = homeVm()
        fakeLive.emit(offerMessage("j_1"))
        advanceUntilIdle()
        assertEquals(listOf("j_1"), homeOf(vm).home.offers.map { it.job })
    }

    @Test fun acceptSuccessOpensTheJob() = runTest(dispatcher) {
        val vm = homeVmWithOffer()
        vm.onAccept("j_1")
        advanceUntilIdle()
        assertTrue(vm.state.value is UiState.Job)
        assertEquals("offer.accept", fakeHub.lastType)
    }

    @Test fun acceptShowsSendingUntilTheReceipt() = runTest(dispatcher) {
        val vm = homeVmWithOffer()
        vm.onAccept("j_1")
        assertEquals("j_1", homeOf(vm).accepting)
    }

    @Test fun acceptTakenShowsBanner() = runTest(dispatcher) {
        fakeHub.reject(ErrorCode.Taken)
        val vm = homeVmWithOffer()
        vm.onAccept("j_1")
        advanceUntilIdle()
        val s = homeOf(vm)
        assertEquals(Banner.Taken, s.banner)
        assertTrue(s.home.offers.isEmpty())
    }

    @Test fun acceptResendAfterNetworkUsesTheSameCommandId() = runTest(dispatcher) {
        fakeHub.failNetwork()
        val vm = homeVmWithOffer()
        vm.onAccept("j_1")
        advanceUntilIdle()
        assertTrue(homeOf(vm).banner is Banner.Error)
        vm.onAccept("j_1")
        advanceUntilIdle()
        assertEquals(2, fakeHub.sentIds.size)
        assertEquals(fakeHub.sentIds[0], fakeHub.sentIds[1])
    }

    @Test fun offerClosedRemovesTheOfferWithBanner() = runTest(dispatcher) {
        val vm = homeVmWithOffer()
        fakeLive.emit(offerClosed("j_1"))
        advanceUntilIdle()
        assertEquals(Banner.Taken, homeOf(vm).banner)
        assertTrue(homeOf(vm).home.offers.isEmpty())
    }

    @Test fun expiredOfferLeavesWithoutBanner() = runTest(dispatcher) {
        val vm = homeVmWithOffer()
        fakeLive.emit(offerClosed("j_1", OfferClosedReason.Expired))
        advanceUntilIdle()
        assertNull(homeOf(vm).banner)
        assertTrue(homeOf(vm).home.offers.isEmpty())
    }

    @Test fun passRemovesTheOfferWithoutBanner() = runTest(dispatcher) {
        val vm = homeVmWithOffer()
        vm.onPass("j_1")
        advanceUntilIdle()
        assertNull(homeOf(vm).banner)
        assertTrue(homeOf(vm).home.offers.isEmpty())
        assertEquals("offer.pass", fakeHub.lastType)
    }

    @Test fun toggleSendsSetOnAndRefetches() = runTest(dispatcher) {
        val vm = homeVm()
        vm.onToggleOn(false)
        advanceUntilIdle()
        assertEquals("member.set_on", fakeHub.lastType)
        assertEquals(2, fakeHub.homeCalls)
    }

    @Test fun bannerClearsWhenShown() = runTest(dispatcher) {
        fakeHub.reject(ErrorCode.Taken)
        val vm = homeVmWithOffer()
        vm.onAccept("j_1")
        advanceUntilIdle()
        vm.onBannerDone()
        assertNull(homeOf(vm).banner)
    }

    @Test fun openJobShowsTheCard() = runTest(dispatcher) {
        val vm = homeVm()
        vm.onOpenJob("j_9")
        advanceUntilIdle()
        assertEquals("j_9", (vm.state.value as UiState.Job).card.job)
    }

    @Test fun changedRefetchesHome() = runTest(dispatcher) {
        homeVm()
        fakeLive.emit(LiveEvent.Message(LiveMessage.Changed))
        advanceUntilIdle()
        assertEquals(2, fakeHub.homeCalls)
    }

    @Test fun reconnectRefetchesHome() = runTest(dispatcher) {
        homeVm()
        fakeLive.emit(LiveEvent.Reconnected)
        advanceUntilIdle()
        assertEquals(2, fakeHub.homeCalls)
    }

    @Test fun threeFailuresShowOffline() = runTest(dispatcher) {
        val vm = homeVm()
        fakeLive.emit(LiveEvent.Offline)
        advanceUntilIdle()
        assertTrue(vm.state.value is UiState.Offline)
    }

    @Test fun reconnectAfterOfflineBringsHomeBack() = runTest(dispatcher) {
        val vm = homeVm()
        fakeLive.emit(LiveEvent.Offline)
        advanceUntilIdle()
        fakeLive.emit(LiveEvent.Reconnected)
        advanceUntilIdle()
        assertTrue(vm.state.value is UiState.Home)
    }

    @Test fun retryFromOfflineReloadsAndReconnects() = runTest(dispatcher) {
        val vm = homeVm()
        fakeLive.emit(LiveEvent.Offline)
        advanceUntilIdle()
        vm.onRetry()
        advanceUntilIdle()
        assertTrue(vm.state.value is UiState.Home)
        assertEquals(2, fakeLive.connects)
    }

    private fun TestScope.jobVm(
        actions: List<JobAction> = JobAction.entries.toList(),
    ): VolunteerViewModel {
        fakeHub.jobActions = actions
        val vm = vm()
        vm.onOpenJob("j_1")
        advanceUntilIdle()
        return vm
    }

    private fun jobOf(vm: VolunteerViewModel): UiState.Job = vm.state.value as UiState.Job

    @Test fun doneSendsOutcomeAndReturnsHome() = runTest(dispatcher) {
        val vm = jobVm()
        vm.onDone(Outcome.Done, null)
        advanceUntilIdle()
        assertEquals("job.done", fakeHub.lastType)
        assertTrue(vm.state.value is UiState.Home)
    }

    @Test fun donePartlyCarriesTheNote() = runTest(dispatcher) {
        val vm = jobVm()
        vm.onDone(Outcome.Partly, "Cleared the front walk only")
        advanceUntilIdle()
        val sent = fakeHub.lastCommand as VolunteerCommand.Done
        assertEquals(Outcome.Partly, sent.outcome)
        assertEquals("Cleared the front walk only", sent.note)
        assertEquals("j_1", sent.job)
    }

    @Test fun blankDoneNoteIsSentAsNoNote() = runTest(dispatcher) {
        val vm = jobVm()
        vm.onDone(Outcome.NotDone, "   ")
        advanceUntilIdle()
        assertNull((fakeHub.lastCommand as VolunteerCommand.Done).note)
    }

    @Test fun doneRejectedStaysOnTheJobWithTheReason() = runTest(dispatcher) {
        val vm = jobVm()
        fakeHub.reject(ErrorCode.WrongState)
        vm.onDone(Outcome.Done, null)
        advanceUntilIdle()
        val s = jobOf(vm)
        assertEquals(false, s.sending)
        assertTrue(s.error.orEmpty().contains("wrong_state"))
    }

    @Test fun handOffNeedsANote() = runTest(dispatcher) {
        val vm = jobVm()
        vm.onHandOff("")
        vm.onHandOff("   ")
        advanceUntilIdle()
        assertEquals(0, fakeHub.sendCalls)
        assertTrue(vm.state.value is UiState.Job)
    }

    @Test fun handOffSendsTheNoteAndReturnsHome() = runTest(dispatcher) {
        val vm = jobVm()
        vm.onHandOff("My car will not start")
        advanceUntilIdle()
        assertEquals("job.hand_off", fakeHub.lastType)
        assertEquals("My car will not start", (fakeHub.lastCommand as VolunteerCommand.HandOff).note)
        assertTrue(vm.state.value is UiState.Home)
    }

    @Test fun buttonsFollowTheActions() = runTest(dispatcher) {
        val actions = listOf(JobAction.There, JobAction.Done, JobAction.Help, JobAction.HandOff)
        val vm = jobVm(actions = actions)
        assertEquals(actions, jobOf(vm).card.actions)
    }

    @Test fun statusSendsAndReloadsTheCard() = runTest(dispatcher) {
        val vm = jobVm()
        vm.onStatus(JobAction.OnMyWay)
        assertTrue(jobOf(vm).sending)
        advanceUntilIdle()
        assertEquals("job.on_my_way", fakeHub.lastType)
        assertEquals(2, fakeHub.jobCalls)
        assertEquals(false, jobOf(vm).sending)
    }

    @Test fun thereSendsThere() = runTest(dispatcher) {
        val vm = jobVm(actions = listOf(JobAction.There, JobAction.Help))
        vm.onStatus(JobAction.There)
        advanceUntilIdle()
        assertEquals("job.there", fakeHub.lastType)
    }

    @Test fun statusIgnoresAnActionTheCardDoesNotOffer() = runTest(dispatcher) {
        val vm = jobVm(actions = listOf(JobAction.OnMyWay))
        vm.onStatus(JobAction.There)
        advanceUntilIdle()
        assertEquals(0, fakeHub.sendCalls)
    }

    @Test fun statusResendAfterNetworkUsesTheSameCommandId() = runTest(dispatcher) {
        val vm = jobVm()
        fakeHub.failNetwork()
        vm.onStatus(JobAction.OnMyWay)
        advanceUntilIdle()
        assertTrue(jobOf(vm).error != null)
        vm.onStatus(JobAction.OnMyWay)
        advanceUntilIdle()
        assertEquals(2, fakeHub.sentIds.size)
        assertEquals(fakeHub.sentIds[0], fakeHub.sentIds[1])
        assertNull(jobOf(vm).error)
    }

    @Test fun secondTapWhileSendingIsIgnored() = runTest(dispatcher) {
        val vm = jobVm()
        vm.onStatus(JobAction.OnMyWay)
        vm.onHelp(null)
        advanceUntilIdle()
        assertEquals(1, fakeHub.sendCalls)
    }

    @Test fun helpSendsAndStaysOnTheJob() = runTest(dispatcher) {
        val vm = jobVm()
        vm.onHelp(null)
        advanceUntilIdle()
        assertEquals("job.help", fakeHub.lastType)
        assertTrue(vm.state.value is UiState.Job)
        assertEquals(2, fakeHub.jobCalls)
    }

    @Test fun backReturnsHome() = runTest(dispatcher) {
        val vm = jobVm()
        vm.onBack()
        advanceUntilIdle()
        assertTrue(vm.state.value is UiState.Home)
        assertEquals(0, fakeHub.sendCalls)
    }

    @Test fun changedWhileOnTheJobReloadsTheCard() = runTest(dispatcher) {
        val vm = jobVm()
        fakeLive.emit(LiveEvent.Message(LiveMessage.Changed))
        advanceUntilIdle()
        assertEquals(2, fakeHub.jobCalls)
        assertTrue(vm.state.value is UiState.Job)
    }

    @Test fun helpWithNoConnectionOffersAPrefilledText() = runTest(dispatcher) {
        val vm = jobVm()
        fakeHub.failNetwork()
        vm.onHelp(null)
        advanceUntilIdle()
        val text = jobOf(vm).helpText.orEmpty()
        assertTrue(text.contains("SNOW-4821"))
        assertTrue(text.contains("need help"))
    }

    @Test fun helpRejectedByTheHubOffersNoText() = runTest(dispatcher) {
        val vm = jobVm()
        fakeHub.reject(ErrorCode.WrongState)
        vm.onHelp(null)
        advanceUntilIdle()
        assertNull(jobOf(vm).helpText)
    }

    @Test fun failedSendAfterLeavingTheJobShowsABannerOnHome() = runTest(dispatcher) {
        val vm = jobVm()
        fakeHub.failNetwork()
        vm.onDone(Outcome.Done, null)
        vm.onBack()
        advanceUntilIdle()
        assertTrue(homeOf(vm).banner is Banner.Error)
    }

    @Test fun failedSendWhileOfflineKeepsTheOfflineScreen() = runTest(dispatcher) {
        val vm = jobVm()
        val gate = CompletableDeferred<Unit>()
        fakeHub.sendGate = gate
        fakeHub.failNetwork()
        vm.onDone(Outcome.Done, null)
        advanceUntilIdle()
        fakeLive.emit(LiveEvent.Offline)
        advanceUntilIdle()
        gate.complete(Unit)
        advanceUntilIdle()
        assertTrue(vm.state.value is UiState.Offline)
    }

    @Test fun failedSendAfterSignOutKeepsTheJoinScreen() = runTest(dispatcher) {
        val vm = jobVm()
        val gate = CompletableDeferred<Unit>()
        fakeHub.sendGate = gate
        fakeHub.failNetwork()
        vm.onHelp(null)
        advanceUntilIdle()
        fakeHub.jobError = HubException(ErrorCode.Unauthorized, "Session ended")
        fakeLive.emit(LiveEvent.Message(LiveMessage.Changed))
        advanceUntilIdle()
        gate.complete(Unit)
        advanceUntilIdle()
        assertTrue(vm.state.value is UiState.NeedsJoin)
    }

    @Test fun jobNoLongerHeldReturnsHome() = runTest(dispatcher) {
        val vm = jobVm()
        fakeHub.jobError = HubException(ErrorCode.Forbidden, "Only the volunteer who holds this job sees it.")
        fakeLive.emit(LiveEvent.Message(LiveMessage.Changed))
        advanceUntilIdle()
        assertTrue(vm.state.value is UiState.Home)
    }

    @Test fun doneWhileTheBoardChangesStaysHome() = runTest(dispatcher) {
        val vm = jobVm()
        val gate = CompletableDeferred<Unit>()
        fakeHub.jobGate = gate
        fakeHub.jobError = HubException(ErrorCode.Forbidden, "Only the volunteer who holds this job sees it.")
        fakeLive.emit(LiveEvent.Message(LiveMessage.Changed))
        advanceUntilIdle()
        vm.onDone(Outcome.Done, null)
        advanceUntilIdle()
        gate.complete(Unit)
        advanceUntilIdle()
        assertTrue(vm.state.value is UiState.Home)
    }

    @Test fun lostLinkMarksTheJobAndMessagesClearIt() = runTest(dispatcher) {
        val vm = jobVm()
        fakeLive.emit(LiveEvent.Lost)
        advanceUntilIdle()
        assertTrue(jobOf(vm).linkDown)
        fakeLive.emit(LiveEvent.Reconnected)
        advanceUntilIdle()
        assertFalse(jobOf(vm).linkDown)
    }

    @Test fun retryResendsTheFailedCommandWithTheSameId() = runTest(dispatcher) {
        val vm = jobVm()
        fakeHub.failNetwork()
        vm.onDone(Outcome.Partly, "Front walk only")
        advanceUntilIdle()
        assertTrue(jobOf(vm).canRetry)
        vm.onRetrySend()
        advanceUntilIdle()
        assertEquals(2, fakeHub.sentIds.size)
        assertEquals(fakeHub.sentIds[0], fakeHub.sentIds[1])
        assertEquals("Front walk only", (fakeHub.lastCommand as VolunteerCommand.Done).note)
        assertTrue(vm.state.value is UiState.Home)
    }
}
