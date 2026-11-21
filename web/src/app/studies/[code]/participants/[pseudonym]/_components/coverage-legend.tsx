import type { CSSProperties } from "react";
import { STATUS, STATUS_GROUPS } from "./labels";

function Swatch({ style }: { style: CSSProperties }) {
  return <span className="inline-block h-3.5 w-6 shrink-0 rounded-sm ring-1 ring-black/15 dark:ring-white/15" style={style} aria-hidden />;
}

export function CoverageLegend({ showNoRecord }: { showNoRecord: boolean }) {
  const groups = showNoRecord ? [...STATUS_GROUPS, { title: "Sin información", statuses: ["no_record" as const] }] : STATUS_GROUPS;
  return (
    <div className="rounded-lg border border-black/10 p-4 text-sm dark:border-white/10">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Leyenda</h2>
      <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-6">
        {groups.map((group) => (
          <div key={group.title}>
            <p className="mb-1.5 text-xs text-zinc-500">{group.title}</p>
            <ul className="space-y-1">
              {group.statuses.map((status) => (
                <li key={status} className="flex items-center gap-2">
                  <Swatch style={STATUS[status].style} />
                  {STATUS[status].label}
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div>
          <p className="mb-1.5 text-xs text-zinc-500">Episodios detectados</p>
          <ul className="space-y-1">
            <li className="flex items-center gap-2">
              <span className="inline-block h-3.5 w-2 rounded-sm bg-zinc-950 dark:bg-white" aria-hidden />
              Alimentación
            </li>
            <li className="flex items-center gap-2">
              <span className="inline-block h-3.5 w-2 rounded-sm border-2 border-zinc-950 bg-white dark:border-white dark:bg-zinc-950" aria-hidden />
              Bebida
            </li>
          </ul>
        </div>
      </div>
      <p className="mt-3 text-xs text-zinc-500">
        Solo el tiempo observado tiene relleno sólido. El tiempo no observado no significa que no haya ocurrido nada: ahí no se
        reportan conteos.
      </p>
    </div>
  );
}
