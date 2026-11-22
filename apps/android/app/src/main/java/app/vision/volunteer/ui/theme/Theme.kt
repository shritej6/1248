package app.vision.volunteer.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider

@Composable
fun VisionTheme(content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalTokens provides AppTokens()) {
        MaterialTheme(colorScheme = GraphiteScheme, typography = AppTypography, shapes = AppShapes, content = content)
    }
}
