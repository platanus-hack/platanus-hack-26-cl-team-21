# Android app — design guidelines

Keywords: **clean line, anatomía de un sistema, edición científica, contraste, minimal.** Reference mood: editorial/technical print. A warm paper background, black hairlines, a serif display face and one flat highlight color. Think of a lab notebook or a technical plate, not a consumer gadget app.

## Priorities (in order)

1. **Native and fast.** Use stock Material 3 Compose components and standard Android navigation, back gesture and edge-to-edge. The brand is applied through the theme (color, type, shape), never through custom-drawn replacements of standard widgets.
2. **Contrast.** All text meets WCAG AA (4.5:1). Orange and amber are fills only, never text on the paper background.
3. **Minimal.** One accent per screen. Hairlines instead of shadows. No decorative animation.

## Accessibility (participants of any age, eyesight or dexterity)

Based on Material 3's accessibility guidance and WCAG 2.2 AA. These rules are not optional.

- **Touch targets:** at least 48 × 48 dp for anything tappable. The main action of a screen is a full-width button at least 56 dp tall (`MainActionButton` / `SecondaryActionButton` in `ui/Buttons.kt`). Inline actions use `InlineButton` (48 dp). M3's 40 dp default button is too small for our users.
- **One main action per screen,** at the bottom within thumb reach. When there are two (approve / exclude), stack them full width, primary on top, never side by side.
- **Text size:** content is at least 14 sp (`bodyMedium`); body copy is 16 sp (`bodyLarge`). 12 sp styles (`bodySmall`, `labelSmall`) are not used for anything a participant needs to read.
- **Font scaling:** everything works at the system's largest font size (200%). Use `sp`, never fixed heights on text containers (use `heightIn(min = …)`), and let long labels wrap. Check new screens with `adb shell settings put system font_scale 2.0`.
- **Contrast:** text at least 4.5:1, icons and control borders at least 3:1 (see Color).
- **Not color alone:** every status has a word next to its color (a dot + "Grabando", "Pendiente" tag).
- **Screen readers (TalkBack):** icon-only buttons have a content description; decorative drawings have none. Section titles are marked as headings. A labeled reading (`Specimen`) is read as a single item. Whole rows toggle checkboxes, not just the box.
- **Plain Spanish:** short sentences, verbs on buttons ("Aprobar", "Conectar"), no technical terms where an everyday word works.

## UI language

Spanish only (`values/strings.xml`). Code stays in English.

## Color

The brand scheme is used instead of dynamic color (Material You), because dynamic color would override the palette. Values live in `ui/theme/Color.kt` and can change.

| Role | Hex | Use |
|---|---|---|
| `primary` | `#192859` navy | Main buttons, app bar titles, key text. 12.3:1 on paper |
| `onPrimary` | `#FFFFFF` | |
| `secondary` | `#28469e` blue | Links, selected states, progress, active tabs. 7.4:1 on paper |
| `tertiary` / highlight | `#f27533` orange | **The highlight.** Recording indicator, the one key word in a headline (like a marker highlight), primary action of the review flow. Dark text on top (6.1:1) |
| `warning` (custom) | `#f6a321` amber | Pending review, low battery, storage almost full. Fill only, dark text on top |
| `background` / `surface` | `#F3EFE6` paper | Screens |
| `surfaceVariant` | `#E4DFD2` | Cards, grouped sections (the darker paper box in the reference) |
| `onSurface` | `#1A1A1A` ink | Body text. 15.2:1 |
| `outline` | `#1A1A1A` at ~60% | 1 dp hairlines |
| `error` | Material default `#BA1A1A` | Kept separate from orange so errors are not confused with the highlight |

Dark theme: navy `#192859`-based surfaces, paper-colored text, the same orange and amber accents.

## Type

- **Display/headline/title:** one bundled serif with a calm editorial feel (candidate: *Newsreader* or *Source Serif 4*, OFL, a single variable `.ttf` in `res/font/`). No downloadable fonts, to avoid a network fetch at startup.
- **Body/label:** the system font (Roboto). It's native and costs nothing.
- **Numbers** (sensor values, timestamps, durations): system font with tabular figures (`fontFeatureSettings = "tnum"`), so values don't jump while they update.

## Shape and lines

- Corners: 8 dp for cards and fields, 12 dp for sheets. Buttons keep the Material 3 default pill shape (native first).
- Cards are outlined (1 dp hairline) with 0 elevation. No shadows anywhere.
- Lists are separated by hairline dividers.

## "Anatomía de un sistema" details

Use these sparingly, on at most one element per screen, for example the device status header or an empty state:

- Thin crosshair `+` marks and corner ticks around a framed block, drawn with a cheap `Canvas`.
- A faint grid-paper background, only behind the pendant/device illustration.
- Sensor readings laid out like a labeled specimen: small uppercase label, large tabular value, unit.

## Don't

- No gradients, glassmorphism, shadows or blurred backgrounds.
- No custom buttons, switches or sliders (use the M3 ones, themed).
- No image assets where a vector or `Canvas` line does the job.
