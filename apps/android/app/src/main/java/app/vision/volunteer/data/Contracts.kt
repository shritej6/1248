package app.vision.volunteer.data

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonClassDiscriminator
import java.util.UUID

val VisionJson: Json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    encodeDefaults = false
}

@Serializable
data class ClockView(val now: Long, val offsetMs: Long)

@Serializable
data class OfferView(
    val job: String,
    val needLabel: String,
    val distanceMiles: Double?,
    val promiseAt: Long,
    val bring: String?,
    val crew: Int,
)

@Serializable
data class HomeMember(
    val id: String,
    val name: String,
    val on: Boolean,
    val skills: List<String>,
    val zip: String?,
)

@Serializable
data class HomeJob(val job: String, val needLabel: String, val status: JobStatus)

@Serializable
data class VolunteerRecord(val jobsDone: Int, val hours: Double)

@Serializable
data class VolunteerHome(
    val member: HomeMember,
    val offers: List<OfferView>,
    val jobs: List<HomeJob>,
    val record: VolunteerRecord,
    val clock: ClockView,
)

@Serializable
enum class JobStatus {
    @SerialName("planned") Planned,
    @SerialName("offered") Offered,
    @SerialName("accepted") Accepted,
    @SerialName("on_my_way") OnMyWay,
    @SerialName("there") There,
    @SerialName("done") Done,
    @SerialName("consent_asked") ConsentAsked,
    @SerialName("partner_asked") PartnerAsked,
    @SerialName("partner_yes") PartnerYes,
    @SerialName("got_it") GotIt,
    @SerialName("mismatch") Mismatch,
    @SerialName("partly") Partly,
    @SerialName("unmet") Unmet,
    @SerialName("helped") Helped,
    @SerialName("unreached") Unreached,
    @SerialName("withdrawn") Withdrawn,
}

@Serializable
enum class JobAction {
    @SerialName("on_my_way") OnMyWay,
    @SerialName("there") There,
    @SerialName("done") Done,
    @SerialName("help") Help,
    @SerialName("hand_off") HandOff,
}

@Serializable
enum class Outcome {
    @SerialName("done") Done,
    @SerialName("partly") Partly,
    @SerialName("not_done") NotDone,
}

@Serializable
enum class ThreadSource {
    @SerialName("resident") Resident,
    @SerialName("desk") Desk,
    @SerialName("volunteer") Volunteer,
    @SerialName("partner") Partner,
    @SerialName("system") System,
}

@Serializable
data class ThreadLine(val at: Long, val from: ThreadSource, val text: String)

@Serializable
data class JobStep(val status: JobStatus, val at: Long)

@Serializable
data class JobCard(
    val job: String,
    val routeCode: String,
    val needLabel: String,
    val status: JobStatus,
    val firstName: String,
    val address: String?,
    val words: String,
    val promiseAt: Long,
    val accessNotes: String?,
    val actions: List<JobAction>,
    val thread: List<ThreadLine>,
    val clock: ClockView,
    val promiseFrom: Long? = null,
    val steps: List<JobStep> = emptyList(),
)

@Serializable
data class PageView(val page: String, val card: String, val reason: String, val sentAt: Long, val to: String)

@Serializable
data class CommandResult(val ok: Boolean, val events: Int)

@Serializable
data class Rejection(val code: ErrorCode, val message: String)

@Serializable
data class ApiError(val ok: Boolean, val error: Rejection)

@Serializable
data class JoinRequest(val code: String)

@Serializable
data class JoinedMember(val id: String, val roles: List<String>)

@Serializable
data class JoinResult(val session: String, val member: JoinedMember)

data class Session(val token: String, val memberId: String, val roles: List<String>)

@Serializable
sealed interface VolunteerCommand {
    val id: String

    @Serializable @SerialName("member.set_on")
    data class SetOn(override val id: String, val on: Boolean) : VolunteerCommand

    @Serializable @SerialName("offer.accept")
    data class Accept(override val id: String, val job: String) : VolunteerCommand

    @Serializable @SerialName("offer.pass")
    data class Pass(override val id: String, val job: String) : VolunteerCommand

    @Serializable @SerialName("job.on_my_way")
    data class OnMyWay(override val id: String, val job: String) : VolunteerCommand

    @Serializable @SerialName("job.there")
    data class There(override val id: String, val job: String) : VolunteerCommand

    @Serializable @SerialName("job.done")
    data class Done(override val id: String, val job: String, val outcome: Outcome, val note: String? = null) : VolunteerCommand

    @Serializable @SerialName("job.help")
    data class Help(override val id: String, val job: String, val note: String? = null) : VolunteerCommand

    @Serializable @SerialName("job.hand_off")
    data class HandOff(override val id: String, val job: String, val note: String) : VolunteerCommand

    companion object {
        fun newId(): String = "cmd_${UUID.randomUUID()}"
    }
}

@OptIn(ExperimentalSerializationApi::class)
@Serializable
@JsonClassDiscriminator("t")
sealed interface LiveMessage {
    @Serializable @SerialName("changed")
    data object Changed : LiveMessage

    @Serializable @SerialName("offer")
    data class Offer(val offer: OfferView) : LiveMessage

    @Serializable @SerialName("offer_closed")
    data class OfferClosed(val job: String, val reason: OfferClosedReason) : LiveMessage

    @Serializable @SerialName("page")
    data class Page(val page: PageView) : LiveMessage
}

@Serializable
enum class OfferClosedReason {
    @SerialName("taken") Taken,
    @SerialName("expired") Expired,
}
