/**
 * Both labels stacked in one grid cell, the inactive one invisible: the button keeps the width of
 * the longer label, so nothing around it shifts when it switches to its pending text.
 */
export function ButtonLabel({ idle, busy, isBusy }: { idle: string; busy: string; isBusy: boolean }) {
  return (
    <span className="grid">
      <span className={`col-start-1 row-start-1 ${isBusy ? "invisible" : ""}`}>{idle}</span>
      <span className={`col-start-1 row-start-1 ${isBusy ? "" : "invisible"}`} aria-hidden={!isBusy}>
        {busy}
      </span>
    </span>
  );
}
