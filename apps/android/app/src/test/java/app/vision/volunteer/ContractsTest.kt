package app.vision.volunteer

import app.vision.volunteer.data.JobAction
import app.vision.volunteer.data.JobCard
import app.vision.volunteer.data.JobStep
import app.vision.volunteer.data.JobStatus
import app.vision.volunteer.data.LiveMessage
import app.vision.volunteer.data.Outcome
import app.vision.volunteer.data.VisionJson
import app.vision.volunteer.data.VolunteerCommand
import app.vision.volunteer.data.VolunteerHome
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.encodeToJsonElement
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ContractsTest {
    private val json = Json(VisionJson) { ignoreUnknownKeys = false }
    private val job = "j_8d4f1b27-6c3e-4a95-b0d8-7e2a5c9f1b63"

    private fun fixture(path: String): String =
        requireNotNull(javaClass.classLoader?.getResource(path)) { "missing fixture $path" }.readText()

    private fun assertEncodes(path: String, command: VolunteerCommand) {
        val expected = json.parseToJsonElement(fixture(path))
        assertEquals(expected, json.encodeToJsonElement<VolunteerCommand>(command))
    }

    @Test fun homeWithOfferDecodes() {
        val home = json.decodeFromString<VolunteerHome>(fixture("views/home-with-offer.json"))
        assertEquals(1, home.offers.size)
        assertEquals(0.4, home.offers.single().distanceMiles)
    }

    @Test fun emptyHomeDecodes() {
        val home = json.decodeFromString<VolunteerHome>(fixture("views/home-empty.json"))
        assertTrue(home.offers.isEmpty())
        assertEquals(false, home.member.on)
    }

    @Test fun jobCardDecodesWithActions() {
        val card = json.decodeFromString<JobCard>(fixture("views/job-accepted.json"))
        assertEquals(JobStatus.Accepted, card.status)
        assertEquals(listOf(JobAction.OnMyWay, JobAction.Help, JobAction.HandOff), card.actions)
    }

    @Test fun jobCardDecodesThePromiseStartAndPastSteps() {
        val card = json.decodeFromString<JobCard>(fixture("views/job-accepted.json"))
        assertEquals(1_795_248_000_000L, card.promiseFrom)
        assertEquals(listOf(JobStep(JobStatus.Accepted, at = 1_795_333_200_000L)), card.steps)
    }

    @Test fun acceptEncodesAsFixture() {
        assertEncodes(
            "commands/volunteer-accept.json",
            VolunteerCommand.Accept(id = "cmd_0b7c3e2a-1002-4d6f-9a1b-2c3d4e5f6a7b", job = job),
        )
    }

    @Test fun everyVolunteerCommandEncodesAsFixture() {
        val id = { n: Int -> "cmd_0b7c3e2a-100$n-4d6f-9a1b-2c3d4e5f6a7b" }
        assertEncodes("commands/volunteer-set-on.json", VolunteerCommand.SetOn(id = id(1), on = true))
        assertEncodes("commands/volunteer-pass.json", VolunteerCommand.Pass(id = id(3), job = job))
        assertEncodes("commands/volunteer-on-my-way.json", VolunteerCommand.OnMyWay(id = id(4), job = job))
        assertEncodes("commands/volunteer-there.json", VolunteerCommand.There(id = id(5), job = job))
        assertEncodes("commands/volunteer-done.json", VolunteerCommand.Done(id = id(6), job = job, outcome = Outcome.Done))
        assertEncodes(
            "commands/volunteer-done-partly.json",
            VolunteerCommand.Done(id = id(7), job = job, outcome = Outcome.Partly, note = "Cleared the front walk only"),
        )
        assertEncodes("commands/volunteer-help.json", VolunteerCommand.Help(id = id(8), job = job, note = "Nobody answers the door"))
        assertEncodes("commands/volunteer-hand-off.json", VolunteerCommand.HandOff(id = id(9), job = job, note = "My car will not start"))
    }

    @Test fun everyLiveFixtureDecodes() {
        val kinds = listOf("changed", "offer", "offer-closed-taken", "page").map {
            json.decodeFromString<LiveMessage>(fixture("live/$it.json"))::class
        }
        assertEquals(
            listOf(LiveMessage.Changed::class, LiveMessage.Offer::class, LiveMessage.OfferClosed::class, LiveMessage.Page::class),
            kinds,
        )
    }

    @Test fun newCommandIdHasThePrefixAndAUuid() {
        assertTrue(Regex("^cmd_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$").matches(VolunteerCommand.newId()))
    }
}
