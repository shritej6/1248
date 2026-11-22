package app.vision.volunteer

import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import app.vision.volunteer.data.LiveEvent
import app.vision.volunteer.data.OkHttpLiveChannel
import app.vision.volunteer.data.Session
import app.vision.volunteer.data.SessionStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class LiveChannelTest {
    @get:Rule val folder = TemporaryFolder()

    private val server = MockWebServer()
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private lateinit var store: SessionStore

    @Before fun setUp() {
        server.start()
        val file = folder.newFile("session.preferences_pb").also { it.delete() }
        store = SessionStore(PreferenceDataStoreFactory.create(scope = scope) { file })
    }

    @After fun tearDown() {
        server.shutdown()
        scope.cancel()
    }

    private fun channel() = OkHttpLiveChannel(
        baseUrl = server.url("/").toString().trimEnd('/'),
        org = "comforce-demo",
        session = store,
        client = OkHttpClient(),
    )

    private fun refused() = MockResponse().setResponseCode(503)

    @Test fun offlineAfterExactlyThreeFailedConnects() = runTest {
        store.save(Session(token = "tok_1", memberId = "m_1", roles = listOf("volunteer")))
        repeat(4) { server.enqueue(refused()) }
        assertEquals(listOf<LiveEvent>(LiveEvent.Offline), channel().connect().take(1).toList())
        assertEquals(3, server.requestCount)
    }

    @Test fun keepsTryingAfterOfflineAndReconnects() = runTest {
        store.save(Session(token = "tok_1", memberId = "m_1", roles = listOf("volunteer")))
        repeat(3) { server.enqueue(refused()) }
        server.enqueue(
            MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) = Unit
            }),
        )
        val events = channel().connect().take(2).toList()
        assertEquals(listOf(LiveEvent.Offline, LiveEvent.Reconnected), events)
    }
}
