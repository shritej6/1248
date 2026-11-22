package app.vision.volunteer

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.emptyPreferences
import app.vision.volunteer.data.ClockView
import app.vision.volunteer.data.CommandOutcome
import app.vision.volunteer.data.HomeMember
import app.vision.volunteer.data.HubApi
import app.vision.volunteer.data.ErrorCode
import app.vision.volunteer.data.HubException
import app.vision.volunteer.data.JobAction
import app.vision.volunteer.data.JobCard
import app.vision.volunteer.data.JobStatus
import app.vision.volunteer.data.LiveChannel
import app.vision.volunteer.data.LiveEvent
import app.vision.volunteer.data.LiveMessage
import app.vision.volunteer.data.OfferClosedReason
import app.vision.volunteer.data.OfferView
import app.vision.volunteer.data.Session
import app.vision.volunteer.data.VisionJson
import app.vision.volunteer.data.VolunteerCommand
import app.vision.volunteer.data.VolunteerHome
import app.vision.volunteer.data.VolunteerRecord
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

class FakeHub : HubApi {
    var homeView: VolunteerHome = sampleHome()
    var homeCalls = 0
    var sendCalls = 0
    var lastType: String? = null
    var lastCommand: VolunteerCommand? = null
    var jobCalls = 0
    var jobActions: List<JobAction> = emptyList()
    val sentIds = mutableListOf<String>()
    var sendGate: CompletableDeferred<Unit>? = null
    var jobError: HubException? = null
    var jobGate: CompletableDeferred<Unit>? = null
    private val outcomes = ArrayDeque<CommandOutcome>()

    fun reject(code: ErrorCode) {
        outcomes.addLast(CommandOutcome.Rejected(code))
    }

    fun failNetwork() {
        outcomes.addLast(CommandOutcome.Network)
    }

    override suspend fun join(code: String): Session {
        if (code != GOOD_CODE) throw HubException(ErrorCode.NotFound, "No such code")
        return Session(token = "tok_1", memberId = "m_1", roles = listOf("volunteer"))
    }

    override suspend fun home(): VolunteerHome {
        homeCalls += 1
        return homeView
    }

    override suspend fun job(id: String): JobCard {
        jobCalls += 1
        jobGate?.await()
        jobError?.let { throw it }
        return jobCard(id, jobActions)
    }

    override suspend fun send(command: VolunteerCommand): CommandOutcome {
        sendCalls += 1
        sentIds += command.id
        lastCommand = command
        val encoded = VisionJson.parseToJsonElement(VisionJson.encodeToString<VolunteerCommand>(command))
        lastType = encoded.jsonObject["type"]?.jsonPrimitive?.content
        sendGate?.await()
        return outcomes.removeFirstOrNull() ?: CommandOutcome.Ok
    }

    companion object {
        const val GOOD_CODE = "ABCD-1234"
    }
}

class FakeLive : LiveChannel {
    private val events = MutableSharedFlow<LiveEvent>()
    var connects = 0

    override fun connect(): Flow<LiveEvent> {
        connects += 1
        return events
    }

    suspend fun emit(event: LiveEvent) {
        events.emit(event)
    }
}

val testClock = ClockView(now = 1_795_334_400_000, offsetMs = 0)

fun offer(job: String) = OfferView(
    job = job,
    needLabel = "Snow shovelling",
    distanceMiles = 0.4,
    promiseAt = 1_795_420_800_000,
    bring = "Shovel and salt",
    crew = 1,
)

fun sampleHome(offers: List<OfferView> = emptyList()) = VolunteerHome(
    member = HomeMember(id = "m_1", name = "Avery Snow (test)", on = true, skills = listOf("snow"), zip = "53216"),
    offers = offers,
    jobs = emptyList(),
    record = VolunteerRecord(jobsDone = 2, hours = 3.5),
    clock = testClock,
)

fun jobCard(id: String, actions: List<JobAction> = emptyList()) = JobCard(
    job = id,
    routeCode = "SNOW-4821",
    needLabel = "Snow shovelling",
    status = JobStatus.Accepted,
    firstName = "Rosa (test)",
    address = "100 Test Street",
    words = "My walk is covered in snow.",
    promiseAt = 1_795_420_800_000,
    accessNotes = null,
    actions = actions,
    thread = emptyList(),
    clock = testClock,
)

fun offerMessage(job: String): LiveEvent = LiveEvent.Message(LiveMessage.Offer(offer(job)))

fun offerClosed(job: String, reason: OfferClosedReason = OfferClosedReason.Taken): LiveEvent =
    LiveEvent.Message(LiveMessage.OfferClosed(job = job, reason = reason))

class MemoryPreferences : DataStore<Preferences> {
    private val state = MutableStateFlow(emptyPreferences())

    override val data: Flow<Preferences> = state

    override suspend fun updateData(transform: suspend (t: Preferences) -> Preferences): Preferences {
        val next = transform(state.value)
        state.value = next
        return next
    }
}
