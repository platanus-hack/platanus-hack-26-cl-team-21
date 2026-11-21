package cl.observatorio.participante.ui.theme

import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.Color

// Brand palette (not final, see android/design/GUIDELINES.md).
val Navy = Color(0xFF192859)
val Blue = Color(0xFF28469E)
val Orange = Color(0xFFF27533)
val Amber = Color(0xFFF6A321) // warnings; fill only, always with Ink text on top
val Paper = Color(0xFFF2E7E1)
val Ink = Color(0xFF1A1A1A)

val LightColors = lightColorScheme(
    primary = Navy,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFDCE0EE),
    onPrimaryContainer = Navy,
    secondary = Blue,
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFD6DDF2),
    onSecondaryContainer = Navy,
    tertiary = Orange,
    onTertiary = Ink,
    tertiaryContainer = Color(0xFFFBD9C4),
    onTertiaryContainer = Ink,
    background = Paper,
    onBackground = Ink,
    surface = Paper,
    onSurface = Ink,
    surfaceVariant = Color(0xFFE3D7CD),
    onSurfaceVariant = Color(0xFF45423C),
    surfaceContainerLowest = Color(0xFFF7EDE9),
    surfaceContainerLow = Color(0xFFEFE4DD),
    surfaceContainer = Color(0xFFEBDFD7),
    surfaceContainerHigh = Color(0xFFE7DBD3),
    surfaceContainerHighest = Color(0xFFE3D7CD),
    outline = Color(0xFF6E6A62),
    outlineVariant = Color(0xFFB8ABA1),
    // Snackbars: ink bar, paper text, light-blue action (the default inverse colors are purple).
    inverseSurface = Ink,
    inverseOnSurface = Paper,
    inversePrimary = Color(0xFFBFCBF2),
)

val DarkColors = darkColorScheme(
    primary = Color(0xFFBFCBF2),
    onPrimary = Navy,
    primaryContainer = Blue,
    onPrimaryContainer = Paper,
    secondary = Color(0xFF9FB2EE),
    onSecondary = Navy,
    secondaryContainer = Color(0xFF2A3670),
    onSecondaryContainer = Paper,
    tertiary = Orange,
    onTertiary = Ink,
    tertiaryContainer = Color(0xFF7A3510),
    onTertiaryContainer = Paper,
    background = Color(0xFF111938),
    onBackground = Paper,
    surface = Color(0xFF111938),
    onSurface = Paper,
    surfaceVariant = Color(0xFF222C5C),
    onSurfaceVariant = Color(0xFFC9C4B9),
    surfaceContainerLowest = Color(0xFF0C1330),
    surfaceContainerLow = Color(0xFF151E42),
    surfaceContainer = Color(0xFF19224A),
    surfaceContainerHigh = Color(0xFF1E2852),
    surfaceContainerHighest = Color(0xFF222C5C),
    outline = Color(0xFF8E93AD),
    outlineVariant = Color(0xFF3A4470),
    inverseSurface = Paper,
    inverseOnSurface = Ink,
    inversePrimary = Blue,
)
