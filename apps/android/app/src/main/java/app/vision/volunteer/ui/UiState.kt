package app.vision.volunteer.ui

import app.vision.volunteer.data.ErrorCode
import app.vision.volunteer.data.JobCard
import app.vision.volunteer.data.VolunteerHome

sealed interface UiState {
    data class NeedsJoin(val error: ErrorCode?) : UiState
    data object Loading : UiState
    data class Home(val home: VolunteerHome, val banner: Banner?, val accepting: String? = null) : UiState
    data class Job(
        val card: JobCard,
        val sending: Boolean,
        val error: String? = null,
        val canRetry: Boolean = false,
        val helpText: String? = null,
        val linkDown: Boolean = false,
    ) : UiState
    data class Offline(val last: VolunteerHome?) : UiState
}

sealed interface Banner {
    data object Taken : Banner
    data class Error(val text: String) : Banner
}
