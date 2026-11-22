package app.vision.volunteer.data

import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.SerializationException
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

interface LiveChannel {
    fun connect(): Flow<LiveEvent>
}

sealed interface LiveEvent {
    data class Message(val message: LiveMessage) : LiveEvent
    data object Reconnected : LiveEvent
    data object Lost : LiveEvent
    data object Offline : LiveEvent
}

private sealed interface SocketSignal {
    data object Open : SocketSignal
    data class Text(val text: String) : SocketSignal
}

class OkHttpLiveChannel(
    private val baseUrl: String,
    private val org: String,
    private val session: SessionStore,
    private val client: OkHttpClient,
) : LiveChannel {
    override fun connect(): Flow<LiveEvent> = flow {
        var failures = 0
        var everOpened = false
        while (true) {
            val token = session.token() ?: break
            var opened = false
            socket(token).collect { signal ->
                when (signal) {
                    SocketSignal.Open -> {
                        opened = true
                        if (everOpened || failures > 0) emit(LiveEvent.Reconnected)
                        failures = 0
                        everOpened = true
                    }
                    is SocketSignal.Text -> emit(LiveEvent.Message(decode(signal.text)))
                }
            }
            if (opened) emit(LiveEvent.Lost) else failures += 1
            if (failures == OFFLINE_AFTER) emit(LiveEvent.Offline)
            delay(BACKOFF_MS[(failures - 1).coerceIn(0, BACKOFF_MS.lastIndex)])
        }
        emit(LiveEvent.Offline)
    }

    private fun socket(token: String): Flow<SocketSignal> = callbackFlow {
        val request = Request.Builder()
            .url("$baseUrl/api/v1/o/$org/ws")
            .header("Sec-WebSocket-Protocol", "vision, $token")
            .build()
        val listener = object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                trySend(SocketSignal.Open)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                trySend(SocketSignal.Text(text))
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(code, null)
                channel.close()
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                channel.close()
            }
        }
        val webSocket = client.newWebSocket(request, listener)
        awaitClose { webSocket.cancel() }
    }

    private fun decode(text: String): LiveMessage = try {
        VisionJson.decodeFromString<LiveMessage>(text)
    } catch (e: SerializationException) {
        LiveMessage.Changed
    }

    private companion object {
        const val OFFLINE_AFTER = 3
        val BACKOFF_MS = listOf(1_000L, 2_000L, 4_000L)
    }
}
