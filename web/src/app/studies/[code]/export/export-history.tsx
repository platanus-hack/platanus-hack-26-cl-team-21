import { TableFrame, TBody, TD, TH, TR } from "@/components/data-table";
import { Hash } from "@/components/hash";
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
      <p className="rounded-lg border border-dashed border-hairline p-6 text-center text-sm text-ink-muted">
        Este estudio aún no tiene exportaciones.
      </p>
    );
  }
  return (
    <TableFrame caption="Exportaciones anteriores">
      <thead className="text-ink-muted">
        <tr>
          <th scope="col" className={TH}>Fecha (hora de Santiago)</th>
          <th scope="col" className={TH}>Solicitada por</th>
          <th scope="col" className={TH}>Formato</th>
          <th scope="col" className={TH}>Datos</th>
          <th scope="col" className={TH}>Filtros</th>
          <th scope="col" className={TH}>sha256 del archivo</th>
          <th scope="col" className={TH}>Estado</th>
        </tr>
      </thead>
      <TBody>
        {items.map((item) => {
          const described = describeParams(item.params);
          const format = item.format === "csv" && described.files > 1 ? "CSV (.zip)" : item.format.toUpperCase();
          return (
            <tr key={item.id} className={TR}>
              <td className={`${TD} whitespace-nowrap tabular-nums`}>
                <time dateTime={item.createdAt.toISOString()}>{formatDateTime(item.createdAt)}</time>
              </td>
              <td className={`${TD} [overflow-wrap:anywhere]`}>{item.requestedBy}</td>
              <td className={`${TD} whitespace-nowrap`}>{format}</td>
              <td className={TD}>{described.data}</td>
              <td className={`${TD} [overflow-wrap:anywhere]`}>{described.filters}</td>
              <td className={TD}>{item.sha256 ? <Hash value={item.sha256} /> : "—"}</td>
              <td className={TD}>{EXPORT_STATUS_LABEL[item.status] ?? item.status}</td>
            </tr>
          );
        })}
      </TBody>
    </TableFrame>
  );
}
