package app.vision.volunteer.ui.theme

import androidx.compose.material3.darkColorScheme
import androidx.compose.ui.graphics.Color

object Graphite {
    val BgApp = Color(0xFF111315)
    val BgPanel = Color(0xFF1A1D20)
    val BgRaised = Color(0xFF23272B)
    val BgInset = Color(0xFF0B0C0E)
    val Line = Color(0xFF2E3338)
    val LineStrong = Color(0xFF6A727B)
    val Text = Color(0xFFE8EAEC)
    val Text2 = Color(0xFFA4ABB3)
    val Text3 = Color(0xFF868E97)
    val Accent = Color(0xFFFFB000)
    val OnAccent = Color(0xFF111315)
    val AccentTint = Color(0xFF2A2416)
    val Crit = Color(0xFFFF6B5E)
    val CritFill = Color(0xFFC8281C)
    val CritTint = Color(0xFF2C1715)
    val Ok = Color(0xFF4CC982)
    val Info = Color(0xFF6AB0FF)
    val White = Color(0xFFFFFFFF)
}

val GraphiteScheme = darkColorScheme(
    primary = Graphite.Accent,
    onPrimary = Graphite.OnAccent,
    primaryContainer = Graphite.AccentTint,
    onPrimaryContainer = Graphite.Text,
    secondary = Graphite.Text2,
    onSecondary = Graphite.BgApp,
    tertiary = Graphite.Info,
    onTertiary = Graphite.BgApp,
    background = Graphite.BgApp,
    onBackground = Graphite.Text,
    surface = Graphite.BgPanel,
    onSurface = Graphite.Text,
    surfaceVariant = Graphite.BgRaised,
    onSurfaceVariant = Graphite.Text2,
    surfaceContainerLowest = Graphite.BgInset,
    surfaceContainerLow = Graphite.BgApp,
    surfaceContainer = Graphite.BgPanel,
    surfaceContainerHigh = Graphite.BgRaised,
    surfaceContainerHighest = Graphite.BgRaised,
    surfaceTint = Color.Transparent,
    outline = Graphite.LineStrong,
    outlineVariant = Graphite.Line,
    error = Graphite.Crit,
    onError = Graphite.BgApp,
    errorContainer = Graphite.CritTint,
    onErrorContainer = Graphite.Text,
    inverseSurface = Graphite.Text,
    inverseOnSurface = Graphite.BgApp,
    inversePrimary = Graphite.OnAccent,
    scrim = Color(0x99000000),
)
