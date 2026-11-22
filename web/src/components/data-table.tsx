import { type ReactNode, useId } from "react";

// One table look for the whole portal (GUIDELINES: paper-deep header row, hairline dividers, sticky
// header on long tables). The frame scrolls on its own, so it is a focusable, named region:
// keyboard users can scroll it, and the sticky header sticks inside it.

export const TH = "sticky top-0 z-10 bg-paper-deep px-3 py-2 text-left align-bottom font-medium";
/** Row header cell (the participant or study key), kept visible while the table scrolls sideways. */
export const TH_ROW = "sticky left-0 bg-inherit px-3 py-2 text-left align-top font-normal";
export const TD = "px-3 py-2 align-top";
export const NUM = "text-right tabular-nums";
/** Body row: the opaque background lets the sticky row header cover what scrolls under it. */
export const TR = "bg-paper";

/** `paged` tables are already short (the page does the limiting), so only wide content scrolls, sideways. */
export function TableFrame({ caption, children, paged = false }: { caption: string; children: ReactNode; paged?: boolean }) {
  const id = useId();
  return (
    <div role="region" aria-labelledby={id} tabIndex={0} className={`rounded-lg border border-rule ${paged ? "overflow-x-auto" : "max-h-[70vh] overflow-auto"}`}>
      <table className="w-full text-sm">
        <caption id={id} className="sr-only">
          {caption}
        </caption>
        {children}
      </table>
    </div>
  );
}

/** Table body with hairline dividers between rows. */
export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-rule">{children}</tbody>;
}
