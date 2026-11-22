package app.vision.volunteer

import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import app.vision.volunteer.data.CommandOutcome
import app.vision.volunteer.data.ErrorCode
import app.vision.volunteer.data.HubException
import app.vision.volunteer.data.OkHttpHubApi
import app.vision.volunteer.data.Session
import app.vision.volunteer.data.SessionStore
import app.vision.volunteer.data.VolunteerCommand
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.util.concurrent.TimeUnit

class HubApiTest {
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

    private fun testApi() = OkHttpHubApi(
        baseUrl = server.url("/").toString().trimEnd('/'),
        org = "comforce-demo",
        session = store,
        client = OkHttpClient.Builder().readTimeout(2, TimeUnit.SECONDS).build(),
    )

    private fun ok(body: String) = MockResponse().setHeader("Content-Type", "application/json").setBody(body)

    @Test fun resendUsesTheSameCommandId() = runTest {
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST))
        server.enqueue(ok("""{"ok":true,"events":2}"""))
        assertEquals(CommandOutcome.Ok, testApi().send(VolunteerCommand.Accept(id = "cmd_x", job = "j_1")))
        val first = server.takeRequest(1, TimeUnit.SECONDS)
        val second = server.takeRequest(1, TimeUnit.SECONDS)
        assertTrue(first != null && second != null)
        val sent = """{"type":"offer.accept","id":"cmd_x","job":"j_1"}"""
        assertEquals(sent, first?.body?.readUtf8())
        assertEquals(sent, second?.body?.readUtf8())
    }

    @Test fun takenIsARejection() = runTest {
        server.enqueue(ok("""{"ok":false,"error":{"code":"taken","message":"Taken"}}""").setResponseCode(409))
        assertEquals(CommandOutcome.Rejected(ErrorCode.Taken), testApi().send(VolunteerCommand.Accept(id = "cmd_y", job = "j_1")))
        assertEquals(1, server.requestCount)
    }

    @Test fun aReplyThatIsNotJsonIsInvalidNotAMadeUpCode() = runTest {
        server.enqueue(MockResponse().setResponseCode(404).setBody("<html>Not Found</html>"))
        assertEquals(CommandOutcome.Rejected(ErrorCode.Invalid), testApi().send(VolunteerCommand.Pass(id = "cmd_h", job = "j_1")))
    }

    @Test fun anUnknownCodeIsInvalid() = runTest {
        server.enqueue(ok("""{"ok":false,"error":{"code":"brand_new","message":"New"}}""").setResponseCode(409))
        assertEquals(CommandOutcome.Rejected(ErrorCode.Invalid), testApi().send(VolunteerCommand.Pass(id = "cmd_u", job = "j_1")))
    }

    @Test fun everyContractCodeDecodes() {
        val codes = listOf(
            "invalid", "too_large", "unauthorized", "forbidden", "not_found", "wrong_state", "taken",
            "not_eligible", "too_many_jobs", "not_earned", "demo_off", "rate_limited", "internal",
        )
        assertEquals(codes, codes.map { ErrorCode.fromWire(it).wire })
    }

    @Test fun threeNetworkFailuresGiveNetwork() = runTest {
        repeat(3) { server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START)) }
        assertEquals(CommandOutcome.Network, testApi().send(VolunteerCommand.Pass(id = "cmd_z", job = "j_1")))
        assertEquals(3, server.requestCount)
    }

    @Test fun commandSendsTheBearerToken() = runTest {
        store.save(Session(token = "tok_1", memberId = "m_1", roles = listOf("volunteer")))
        server.enqueue(ok("""{"ok":true,"events":1}"""))
        testApi().send(VolunteerCommand.SetOn(id = "cmd_a", on = true))
        val request = server.takeRequest(1, TimeUnit.SECONDS)
        assertEquals("/api/v1/o/comforce-demo/commands", request?.path)
        assertEquals("Bearer tok_1", request?.getHeader("Authorization"))
    }

    @Test fun joinStoresTheSession() = runTest {
        server.enqueue(ok("""{"session":"tok_2","member":{"id":"m_2","roles":["volunteer"]}}"""))
        val session = testApi().join("ABCD-1234")
        assertEquals(Session(token = "tok_2", memberId = "m_2", roles = listOf("volunteer")), session)
        assertEquals("tok_2", store.token())
        val request = server.takeRequest(1, TimeUnit.SECONDS)
        assertEquals("/api/v1/o/comforce-demo/join", request?.path)
        assertEquals("""{"code":"ABCD-1234"}""", request?.body?.readUtf8())
    }

    @Test fun badJoinCodeThrowsTheRejection() = runTest {
        server.enqueue(ok("""{"ok":false,"error":{"code":"not_found","message":"No such code"}}""").setResponseCode(404))
        try {
            testApi().join("WRONG")
            fail("join must throw")
        } catch (e: HubException) {
            assertEquals(ErrorCode.NotFound, e.code)
        }
        assertNull(store.token())
    }

    @Test fun lostJoinReplyIsNetworkAndNotResent() = runTest {
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST))
        server.enqueue(ok("""{"ok":false,"error":{"code":"not_found","message":"Used"}}""").setResponseCode(404))
        try {
            testApi().join("ABCD-1234")
            fail("join must throw")
        } catch (e: HubException) {
            assertEquals(ErrorCode.Network, e.code)
        }
        assertEquals(1, server.requestCount)
        assertNull(store.token())
    }

    @Test fun homeDecodesTheView() = runTest {
        server.enqueue(ok(requireNotNull(javaClass.classLoader?.getResource("views/home-with-offer.json")).readText()))
        assertEquals(1, testApi().home().offers.size)
        assertEquals("/api/v1/o/comforce-demo/views/home", server.takeRequest(1, TimeUnit.SECONDS)?.path)
    }

    @Test fun jobAsksForTheJobById() = runTest {
        server.enqueue(ok(requireNotNull(javaClass.classLoader?.getResource("views/job-accepted.json")).readText()))
        assertEquals("SNOW-4821", testApi().job("j_1").routeCode)
        assertEquals("/api/v1/o/comforce-demo/views/job?job=j_1", server.takeRequest(1, TimeUnit.SECONDS)?.path)
    }
}
