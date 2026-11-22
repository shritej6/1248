package app.vision.volunteer.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException

interface HubApi {
    suspend fun join(code: String): Session
    suspend fun home(): VolunteerHome
    suspend fun job(id: String): JobCard
    suspend fun send(command: VolunteerCommand): CommandOutcome
}

sealed interface CommandOutcome {
    data object Ok : CommandOutcome
    data class Rejected(val code: ErrorCode) : CommandOutcome
    data object Network : CommandOutcome
}

class HubException(val code: ErrorCode, message: String, cause: Throwable? = null) : Exception(message, cause)

private data class HttpReply(val status: Int, val body: String)

class OkHttpHubApi(
    private val baseUrl: String,
    private val org: String,
    private val session: SessionStore,
    private val client: OkHttpClient,
) : HubApi {
    private val jsonType = "application/json".toMediaType()
    private val orgUrl get() = "$baseUrl/api/v1/o/$org"

    override suspend fun join(code: String): Session {
        val body = VisionJson.encodeToString(JoinRequest(code))
        val reply = exchangeOrThrow(post("$orgUrl/join", body, token = null), attempts = 1)
        val result = decodeOrThrow<JoinResult>(reply.body)
        val joined = Session(token = result.session, memberId = result.member.id, roles = result.member.roles)
        session.save(joined)
        return joined
    }

    override suspend fun home(): VolunteerHome =
        decodeOrThrow(exchangeOrThrow(get("$orgUrl/views/home", session.token())).body)

    override suspend fun job(id: String): JobCard =
        decodeOrThrow(exchangeOrThrow(get(jobUrl(id), session.token())).body)

    private fun jobUrl(id: String): String =
        "$orgUrl/views/job".toHttpUrl().newBuilder().addQueryParameter("job", id).build().toString()

    override suspend fun send(command: VolunteerCommand): CommandOutcome {
        val body = VisionJson.encodeToString<VolunteerCommand>(command)
        val reply = withRetry(post("$orgUrl/commands", body, session.token())) ?: return CommandOutcome.Network
        if (reply.status in 200..299) return CommandOutcome.Ok
        return CommandOutcome.Rejected(rejectionOf(reply).code)
    }

    private fun get(url: String, token: String?): Request =
        Request.Builder().url(url).get().withAuth(token).build()

    private fun post(url: String, body: String, token: String?): Request =
        Request.Builder().url(url).post(body.toRequestBody(jsonType)).withAuth(token).build()

    private fun Request.Builder.withAuth(token: String?): Request.Builder =
        if (token == null) this else header("Authorization", "Bearer $token")

    private suspend fun exchangeOrThrow(request: Request, attempts: Int = RETRY_WAITS_MS.size): HttpReply {
        val reply = withRetry(request, attempts) ?: throw HubException(ErrorCode.Network, "No connection to the hub")
        if (reply.status in 200..299) return reply
        val rejection = rejectionOf(reply)
        throw HubException(rejection.code, rejection.message)
    }

    private suspend fun withRetry(request: Request, attempts: Int = RETRY_WAITS_MS.size): HttpReply? {
        RETRY_WAITS_MS.take(attempts).forEachIndexed { attempt, wait ->
            if (attempt > 0) delay(wait)
            val reply = try {
                execute(request)
            } catch (e: IOException) {
                null
            }
            if (reply != null && reply.status < 500) return reply
        }
        return null
    }

    private suspend fun execute(request: Request): HttpReply = withContext(Dispatchers.IO) {
        client.newCall(request).execute().use { HttpReply(it.code, it.body?.string().orEmpty()) }
    }

    private fun rejectionOf(reply: HttpReply): Rejection = try {
        VisionJson.decodeFromString<ApiError>(reply.body).error
    } catch (e: IllegalArgumentException) {
        Rejection(code = ErrorCode.Invalid, message = "Unreadable hub reply with status ${reply.status}")
    }

    private inline fun <reified T> decodeOrThrow(body: String): T = try {
        VisionJson.decodeFromString<T>(body)
    } catch (e: IllegalArgumentException) {
        throw HubException(ErrorCode.Invalid, "Unreadable hub reply", e)
    }

    private companion object {
        val RETRY_WAITS_MS = listOf(0L, 500L, 1_500L)
    }
}
