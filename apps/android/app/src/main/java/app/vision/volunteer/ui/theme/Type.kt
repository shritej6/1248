package app.vision.volunteer.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp
import app.vision.volunteer.R

val PlexSans = FontFamily(
    Font(R.font.plex_sans_regular, FontWeight.Normal),
    Font(R.font.plex_sans_medium, FontWeight.Medium),
    Font(R.font.plex_sans_semibold, FontWeight.SemiBold),
)

val PlexCondensed = FontFamily(
    Font(R.font.plex_sans_condensed_medium, FontWeight.Medium),
    Font(R.font.plex_sans_condensed_semibold, FontWeight.SemiBold),
)

val PlexMono = FontFamily(
    Font(R.font.plex_mono_regular, FontWeight.Normal),
    Font(R.font.plex_mono_medium, FontWeight.Medium),
    Font(R.font.plex_mono_semibold, FontWeight.SemiBold),
)

private fun style(
    family: FontFamily,
    weight: FontWeight,
    size: Int,
    line: Int,
    spacing: TextUnit = 0.sp,
    features: String? = null,
) = TextStyle(
    fontFamily = family,
    fontWeight = weight,
    fontSize = size.sp,
    lineHeight = line.sp,
    letterSpacing = spacing,
    fontFeatureSettings = features,
)

private const val NUMBERS = "tnum, zero"

private val DisplaySmall = style(PlexMono, FontWeight.Medium, 28, 36, features = NUMBERS)
private val HeadlineSmall = style(PlexSans, FontWeight.SemiBold, 22, 28)

val RouteCode = style(PlexMono, FontWeight.SemiBold, 16, 24, 1.sp, NUMBERS)

val AppTypography = Typography(
    displayLarge = DisplaySmall,
    displayMedium = DisplaySmall,
    displaySmall = DisplaySmall,
    headlineLarge = HeadlineSmall,
    headlineMedium = HeadlineSmall,
    headlineSmall = HeadlineSmall,
    titleLarge = style(PlexSans, FontWeight.SemiBold, 18, 24),
    titleMedium = style(PlexSans, FontWeight.SemiBold, 16, 22),
    titleSmall = style(PlexSans, FontWeight.SemiBold, 14, 20),
    bodyLarge = style(PlexSans, FontWeight.Normal, 16, 24),
    bodyMedium = style(PlexSans, FontWeight.Normal, 14, 20),
    bodySmall = style(PlexSans, FontWeight.Normal, 12, 16),
    labelLarge = style(PlexSans, FontWeight.SemiBold, 15, 20, 0.5.sp),
    labelMedium = style(PlexCondensed, FontWeight.SemiBold, 12, 16, 0.8.sp),
    labelSmall = style(PlexCondensed, FontWeight.Medium, 12, 16),
)
