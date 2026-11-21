# Researcher portal — design guidelines

Same brand as the Android app ([`android/design/GUIDELINES.md`](../../android/design/GUIDELINES.md)), adapted to a desktop tool for researchers who read dense data for long stretches.

Keywords: **clean line, anatomía de un sistema, edición científica, contraste, minimal.** Reference mood: editorial/technical print. A warm paper background, black hairlines, a serif display face and one flat highlight color. Think of a lab notebook or a journal's data supplement, not a SaaS dashboard.

## Priorities (in order)

1. **Native and fast.** Semantic HTML (`<table>`, `<form>`, `<button>`, `<details>`, `<dialog>`) styled with Tailwind, rendered on the server. No UI component library, no client-side charting library where a `<div>` band or inline SVG does the job. Add `"use client"` only for real interaction. The brand is applied through the theme tokens in `src/app/globals.css`, never by rebuilding native controls.
2. **Contrast.** All text meets WCAG AA (4.5:1). Orange and amber are fills only, never text on the paper background.
3. **Minimal.** One accent per page. Hairlines instead of shadows. No decorative animation.

## Accessibility

WCAG 2.2 AA. These rules are not optional.

- **Keyboard first:** everything works with the keyboard alone, in reading order. Focus is always visible: a 2 px `secondary` outline with 2 px offset (`focus-visible:outline-2 outline-offset-2`). Never remove the outline without replacing it.
- **Targets:** at least 24 × 24 px for any control (WCAG 2.5.8); buttons and form fields are at least 40 px tall. Links in tables get the whole cell as their hit area when the cell is the link.
- **Text size:** body copy is 16 px (`text-base`), content at least 14 px (`text-sm`). 12 px (`text-xs`) only for secondary labels such as axis ticks or uppercase specimen labels, and never for anything that carries meaning on its own.
- **Zoom and reflow:** the portal works at 200% browser zoom and reflows down to 320 px wide without horizontal scrolling of the page. Wide tables scroll inside their own container. Use `rem`, not fixed heights on text containers.
- **Not color alone:** every status has a word (a dot + "Observado", a "Pendiente" tag). Charts add a second cue (texture, shape or a direct label) and always have a legend.
- **Screen readers:** one `<h1>` per page and a real heading hierarchy. Tables use `<th scope>` and a `<caption>` (it can be visually hidden). Icon-only buttons have an `aria-label`; decorative drawings have `aria-hidden`. Each chart has a text alternative: a summary sentence or the same data as a table.
- **Motion:** respect `prefers-reduced-motion`. The only motion allowed is short state feedback (≤150 ms).
- **Plain Spanish:** short sentences, verbs on buttons ("Exportar", "Filtrar"). Scientific terms are fine when they are the precise word (coverage, provenance); explain them once.

## UI language

Spanish only. Code stays in English. Labels for enums live in `src/lib/labels.ts`.

## Color

Values live in `src/app/globals.css` as CSS variables exposed to Tailwind through `@theme`, so components use `bg-paper`, `text-ink`, `border-hairline` and never raw hex or the stock `zinc`/`neutral` grays.

| Token | Hex | Use |
|---|---|---|
| `primary` | `#192859` navy | Main buttons, page titles, key text. 11.6:1 on paper |
| `on-primary` | `#FFFFFF` | Text on navy |
| `secondary` | `#28469e` blue | Links, selected states, active tabs, focus ring. 7.0:1 on paper |
| `highlight` | `#f27533` orange | **The highlight.** The one key word in a headline (like a marker highlight), the main call to action of a page. Fill only, ink text on top (6.1:1) |
| `warning` | `#f6a321` amber | Caveats that change how data should be read: partial coverage, an episode outside observed time, stale data. Not routine states: "Pendiente" review is on almost every row, so it stays neutral (`paper-deep`). Fill only, ink text on top (8.4:1) |
| `paper` | `#F2E7E1` | Page background |
| `paper-deep` | `#E3D7CD` | Cards, grouped sections, table header rows |
| `ink` | `#1A1A1A` | Body text. 14.3:1 |
| `ink-muted` | `#45423C` | Secondary text, captions, metadata. 8.2:1 on paper, 7.1:1 on `paper-deep` |
| `hairline` | `#1A1A1A` at ~60% | 1 px borders of controls, cards and framed blocks (3:1 for control borders) |
| `rule` | `#1A1A1A` at ~15% | Table row dividers and section rules, where a 60% line would be too loud |
| `error` | `#BA1A1A` | Errors only. 5.3:1 on paper. Kept separate from orange so errors are not confused with the highlight |

Stock Tailwind grays fail on paper (`zinc-500` is about 4.2:1), so muted text is always `ink-muted`.

**Light only.** The portal has no dark theme: don't add `dark:` variants or a `prefers-color-scheme: dark` block. `color-scheme: light` keeps native controls light too.

### Data colors

Charts and the coverage timeline use their own palette, defined once in `src/lib/labels.ts` (`COVERAGE_STATUS_STYLES`). It stays separate from the brand tokens:

- Observed time is the only solid fill; every non-observed reason is hatched, so "not observed" never reads as "nothing happened" (principle 2 in `AGENTS.md`).
- Hues are grouped by who caused the gap (participant, device, data/processing), at most three, distinguished within a group by hatch angle.
- Data hues are never reused for UI chrome, and brand colors are never used to encode data. The one-accent rule does not apply inside a chart.

## Type

- **Display/headline/title:** *Newsreader*, the same serif as the app. Self-hosted through `next/font` (no runtime request to Google), one variable font, used for `h1`–`h3` and large numbers in summary cards.
- **Body/label/UI:** the system font stack (`ui-sans-serif, system-ui, …`). It's native and costs nothing. Geist is dropped.
- **Numbers** (sensor values, timestamps, durations, counts): `tabular-nums`, right-aligned in tables, so columns line up and values don't jump.
- **Code-like values** (hashes, IDs, versions): `font-mono`, truncated in the middle with the full value in a `title` and copyable.

## Layout

- Max content width `max-w-6xl`, generous whitespace, left-aligned text.
- Tables are the default way to show records: hairline row dividers, no zebra stripes, `paper-deep` header row, sticky header on long tables.
- Every measurement links to its evidence and shows its coverage next to it, never on a separate page.

## Shape and lines

- Corners: 8 px (`rounded-lg`) for cards, fields and buttons; 12 px for dialogs. Small tags are fully rounded.
- Cards are outlined (1 px hairline), no elevation. No shadows anywhere.
- Lists and table rows are separated by hairline dividers.

## "Anatomía de un sistema" details

Use these sparingly, on at most one element per page, for example the study overview header or an empty state:

- Thin crosshair `+` marks and corner ticks around a framed block, drawn with CSS borders or a small inline SVG.
- A faint grid-paper background, only behind a device or protocol diagram.
- Key figures laid out like a labeled specimen: small uppercase label, large tabular value in the serif, unit.

## Don't

- No gradients, glassmorphism, shadows or blurred backgrounds.
- No custom selects, checkboxes or date pickers (use the native ones, themed with `accent-color` and borders).
- No raster images where SVG or CSS lines do the job.
- No spinners for server-rendered content; use `loading.tsx` with a plain skeleton or text.
