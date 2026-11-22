// Shared Tailwind class strings for portal controls (see web/design/GUIDELINES.md). The focus ring
// comes from the global :focus-visible rule in globals.css.

/** Text link: secondary blue, always underlined (never color alone). */
export const LINK = "text-secondary underline underline-offset-2 hover:decoration-2";

/** Primary button. Only the background transitions: never `transition` on outline (focus is instant). */
export const BUTTON_PRIMARY =
  "inline-flex min-h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-on-primary transition-[background-color] duration-150 ease-out hover:bg-primary/90";

/** Native select / input. 16 px on small screens so iOS doesn't zoom on focus. */
export const FIELD = "min-h-10 max-w-full rounded-lg border border-hairline bg-paper px-3 text-base text-ink sm:text-sm";

/** Label wrapping a field. */
export const FIELD_LABEL = "flex min-w-0 flex-col gap-1 text-sm font-medium text-ink-muted";
