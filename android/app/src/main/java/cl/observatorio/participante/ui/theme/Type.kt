package cl.observatorio.participante.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import cl.observatorio.participante.R

// One bundled variable font (Newsreader, OFL). The optical size axis gives display text
// its high-contrast editorial look; smaller titles use a sturdier cut.
@OptIn(ExperimentalTextApi::class)
private fun newsreader(opticalSize: Float) = FontFamily(
    listOf(FontWeight.Normal, FontWeight.Medium).map { weight ->
        Font(
            R.font.newsreader,
            weight,
            variationSettings = FontVariation.Settings(
                FontVariation.weight(weight.weight),
                FontVariation.Setting("opsz", opticalSize),
            ),
        )
    },
)

private val Display = newsreader(72f)
private val Title = newsreader(20f)

private val base = Typography()

val AppTypography = Typography(
    displayLarge = base.displayLarge.serif(Display),
    displayMedium = base.displayMedium.serif(Display),
    displaySmall = base.displaySmall.serif(Display),
    headlineLarge = base.headlineLarge.serif(Display),
    headlineMedium = base.headlineMedium.serif(Display),
    headlineSmall = base.headlineSmall.serif(Title),
    titleLarge = base.titleLarge.serif(Title),
    // Body, labels and small titles stay on the system font: native and free to load.
    titleMedium = base.titleMedium,
    titleSmall = base.titleSmall,
    bodyLarge = base.bodyLarge,
    bodyMedium = base.bodyMedium,
    bodySmall = base.bodySmall,
    labelLarge = base.labelLarge,
    labelMedium = base.labelMedium,
    labelSmall = base.labelSmall,
)

private fun TextStyle.serif(family: FontFamily) = copy(fontFamily = family, fontWeight = FontWeight.Normal)

/** Fixed-width digits so live values don't jitter while they update. */
val TabularNumbers = TextStyle(fontFeatureSettings = "tnum")
