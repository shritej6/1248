package app.vision.volunteer

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.graphics.toArgb
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import app.vision.volunteer.data.OkHttpHubApi
import app.vision.volunteer.data.OkHttpLiveChannel
import app.vision.volunteer.data.SessionStore
import app.vision.volunteer.ui.HomeActions
import app.vision.volunteer.ui.HomeScreen
import app.vision.volunteer.ui.JobActions
import app.vision.volunteer.ui.JobScreen
import app.vision.volunteer.ui.JoinScreen
import app.vision.volunteer.ui.JoinState
import app.vision.volunteer.ui.LoadingScreen
import app.vision.volunteer.ui.OfflineScreen
import app.vision.volunteer.ui.UiState
import app.vision.volunteer.ui.VolunteerViewModel
import app.vision.volunteer.ui.joinErrorFor
import app.vision.volunteer.ui.theme.Graphite
import app.vision.volunteer.ui.theme.VisionTheme
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Graphite.BgInset.toArgb()),
            navigationBarStyle = SystemBarStyle.dark(Graphite.BgApp.toArgb()),
        )
        val session = SessionStore.from(this)
        val client = OkHttpClient.Builder().callTimeout(15, TimeUnit.SECONDS).build()
        val liveClient = client.newBuilder().callTimeout(0, TimeUnit.SECONDS).pingInterval(20, TimeUnit.SECONDS).build()
        val factory = viewModelFactory {
            initializer {
                VolunteerViewModel(
                    api = OkHttpHubApi(BuildConfig.HUB_URL, BuildConfig.ORG, session, client),
                    live = OkHttpLiveChannel(BuildConfig.HUB_URL, BuildConfig.ORG, session, liveClient),
                    session = session,
                )
            }
        }
        setContent {
            VisionTheme {
                val vm: VolunteerViewModel = viewModel(factory = factory)
                val state by vm.state.collectAsStateWithLifecycle()
                VolunteerApp(state, vm)
            }
        }
    }
}

@Composable
private fun VolunteerApp(state: UiState, vm: VolunteerViewModel) {
    when (state) {
        is UiState.NeedsJoin -> JoinScreen(JoinState.Ready(error = state.error?.let(::joinErrorFor)), vm::onJoin)
        UiState.Loading -> LoadingScreen()
        is UiState.Home -> HomeScreen(
            state,
            HomeActions(
                onToggleOn = vm::onToggleOn,
                onAccept = vm::onAccept,
                onPass = vm::onPass,
                onOpenJob = vm::onOpenJob,
                onBannerDone = vm::onBannerDone,
            ),
        )
        is UiState.Job -> JobScreen(
            state,
            JobActions(
                onStatus = vm::onStatus,
                onDone = vm::onDone,
                onHelp = vm::onHelp,
                onHandOff = vm::onHandOff,
                onBack = vm::onBack,
                onRetry = vm::onRetrySend,
            ),
        )
        is UiState.Offline -> OfflineScreen(state, vm::onRetry)
    }
}
