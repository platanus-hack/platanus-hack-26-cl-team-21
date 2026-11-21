import type { ExportHistoryItem } from "@/lib/export/queries";
import { DATASET_LABEL, EXPORT_STATUS_LABEL, formatDateTime } from "./labels";

// exports.params is jsonb written by this feature, but read defensively: an older or foreign row
// must not break the page.
function describeParams(params: ExportHistoryItem["params"]) {
  const datasets = Array.isArray(params?.datasets) ? params.datasets : [];
  const filters = params?.filters ?? {};
  const data = datasets.length ? datasets.map((d) => DATASET_LABEL[d] ?? String(d)).join(" + ") : "—";
  const who = filters.participant ?? "Todos los participantes";
  const from = filters.date_from;
  const to = filters.date_to;
  const when = from && to ? (from === to ? `día ${from}` : `${from} a ${to}`) : from ? `desde ${from}` : to ? `hasta ${to}` : "Todo el periodo";
  return { data, filters: `${who} · ${when}`, files: datasets.length };
}

export function ExportHistory({ items }: { items: ExportHistoryItem[] }) {
  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
        Este estudio aún no tiene exportaciones.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-left text-sm">
        <thead className="bg-zinc-50 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Fecha (hora de Santiago)</th>
            <th scope="col" className="px-3 py-2 font-medium">Solicitada por</th>
            <th scope="col" className="px-3 py-2 font-medium">Formato</th>
            <th scope="col" className="px-3 py-2 font-medium">Datos</th>
            <th scope="col" className="px-3 py-2 font-medium">Filtros</th>
            <th scope="col" className="px-3 py-2 font-medium">sha256 del archivo</th>
            <th scope="col" className="px-3 py-2 font-medium">Estado</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {items.map((item) => {
            const described = describeParams(item.params);
            const format = item.format === "csv" && described.files > 1 ? "CSV (.zip)" : item.format.toUpperCase();
            return (
              <tr key={item.id} className="align-top">
                <td className="px-3 py-2 whitespace-nowrap tabular-nums">{formatDateTime(item.createdAt)}</td>
                <td className="px-3 py-2">{item.requestedBy}</td>
                <td className="px-3 py-2 whitespace-nowrap">{format}</td>
                <td className="px-3 py-2">{described.data}</td>
                <td className="px-3 py-2">{described.filters}</td>
                <td className="px-3 py-2 font-mono text-xs break-all" translate="no">
                  {item.sha256 ?? "—"}
                </td>
                <td className="px-3 py-2">{EXPORT_STATUS_LABEL[item.status] ?? item.status}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
