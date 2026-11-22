package app.vision.volunteer.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

data class Spacing(
    val s1: Dp = 4.dp,
    val s2: Dp = 8.dp,
    val s3: Dp = 12.dp,
    val s4: Dp = 16.dp,
    val s5: Dp = 20.dp,
    val s6: Dp = 24.dp,
    val s8: Dp = 32.dp,
    val s10: Dp = 40.dp,
    val s12: Dp = 48.dp,
)

data class Sizes(
    val topBar: Dp = 56.dp,
    val mainButton: Dp = 56.dp,
    val button: Dp = 48.dp,
    val offerCard: Dp = 112.dp,
    val row: Dp = 72.dp,
    val ring: Dp = 40.dp,
    val hairline: Dp = 1.dp,
)

data class StatusColors(
    val normal: Color = Graphite.Text2,
    val act: Color = Graphite.Accent,
    val crit: Color = Graphite.Crit,
    val finished: Color = Graphite.Ok,
)

data class AppTokens(
    val spacing: Spacing = Spacing(),
    val sizes: Sizes = Sizes(),
    val status: StatusColors = StatusColors(),
    val routeCode: TextStyle = RouteCode,
)

val LocalTokens = staticCompositionLocalOf { AppTokens() }

object Tokens {
    val spacing: Spacing
        @Composable @ReadOnlyComposable get() = LocalTokens.current.spacing
    val sizes: Sizes
        @Composable @ReadOnlyComposable get() = LocalTokens.current.sizes
    val status: StatusColors
        @Composable @ReadOnlyComposable get() = LocalTokens.current.status
    val routeCode: TextStyle
        @Composable @ReadOnlyComposable get() = LocalTokens.current.routeCode
}
