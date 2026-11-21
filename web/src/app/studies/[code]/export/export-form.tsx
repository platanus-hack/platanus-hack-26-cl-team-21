"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { DATASET_CHOICES, type DatasetChoice, EXPORT_FIELDS, EXPORT_FORMATS } from "@/lib/export/params";
import { DATASET_LABEL } from "./labels";

type Result = { kind: "idle" } | { kind: "working" } | { kind: "error"; message: string } | { kind: "done"; fileName: string; sha256: string };

const FORMAT_LABEL = { csv: "CSV", json: "JSON" } as const;

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary";
const inputClass = `min-h-10 rounded-lg border border-hairline bg-paper px-3 text-sm text-ink ${focusRing}`;
const labelClass = "flex flex-col gap-1 text-xs font-medium text-ink-muted";
const legendClass = "mb-1 text-xs font-medium text-ink-muted";
const radioClass = `accent-primary ${focusRing}`;
const hintClass = "text-xs text-ink-muted";

const FILE_NAME_PATTERN = /filename="([^"]+)"/;

// Posts the form to the export route and saves the returned file. Without JavaScript the same form
// still posts natively and the browser downloads the file.
export function ExportForm({ action, participants }: { action: string; participants: string[] }) {
  const router = useRouter();
  const [dataset, setDataset] = useState<DatasetChoice>("both");
  const [result, setResult] = useState<Result>({ kind: "idle" });

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult({ kind: "working" });
    try {
      const response = await fetch(action, { method: "POST", body: new FormData(event.currentTarget) });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setResult({ kind: "error", message: body?.error ?? `No se pudo generar la exportación (HTTP ${response.status}). Intenta de nuevo.` });
        return;
      }
      const fileName = FILE_NAME_PATTERN.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ?? "exportacion";
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
      // Revoking synchronously can cancel the download in some browsers; let it start first.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setResult({ kind: "done", fileName, sha256: response.headers.get("X-Content-SHA256") ?? "" });
      router.refresh(); // show the new row in the export history
    } catch {
      setResult({ kind: "error", message: "No se pudo contactar al servidor. Intenta de nuevo." });
    }
  }

  return (
    <form method="post" action={action} onSubmit={onSubmit} className="flex flex-col gap-4 rounded-lg border border-rule p-4">
      <div className="flex flex-wrap gap-8">
        <fieldset>
          <legend className={legendClass}>Formato</legend>
          <div className="flex gap-4 text-sm">
            {EXPORT_FORMATS.map((format) => (
              <label key={format} className="flex items-center gap-1.5">
                <input type="radio" name={EXPORT_FIELDS.format} value={format} defaultChecked={format === "csv"} className={radioClass} />
                {FORMAT_LABEL[format]}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className={legendClass}>Datos</legend>
          <div className="flex gap-4 text-sm">
            {DATASET_CHOICES.map((choice) => (
              <label key={choice} className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name={EXPORT_FIELDS.dataset}
                  value={choice}
                  checked={dataset === choice}
                  onChange={() => setDataset(choice)}
                  className={radioClass}
                />
                {DATASET_LABEL[choice]}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className={labelClass}>
          Participante
          <select name={EXPORT_FIELDS.participant} defaultValue="" autoComplete="off" className={inputClass}>
            <option value="">Todos</option>
            {participants.map((pseudonym) => (
              <option key={pseudonym} value={pseudonym}>
                {pseudonym}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Desde (día local)
          <input type="date" name={EXPORT_FIELDS.from} autoComplete="off" className={inputClass} />
        </label>
        <label className={labelClass}>
          Hasta (día local)
          <input type="date" name={EXPORT_FIELDS.to} autoComplete="off" className={inputClass} />
        </label>
      </div>
      <p className={`-mt-2 ${hintClass}`}>
        Las fechas son días locales de cada participante. Se incluyen las observaciones que empiezan en el rango y los intervalos de
        cobertura que lo tocan, completos y sin recortar.
      </p>

      {dataset === "observations" && (
        <p className="rounded-r-lg border-l-4 border-warning bg-paper-deep px-3 py-2 text-sm text-ink">
          Sin los intervalos de cobertura no se puede interpretar la ausencia de observaciones: en tiempo no observado no hay un cero.
          Exporta también la cobertura con los mismos filtros antes de analizar conteos o tasas.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={result.kind === "working"}
          className={`min-h-10 rounded-lg bg-primary px-4 text-sm font-medium text-on-primary hover:bg-primary/90 disabled:opacity-50 ${focusRing}`}
        >
          {result.kind === "working" ? "Generando…" : "Generar y descargar"}
        </button>
        <p className={hintClass}>CSV con ambos conjuntos se descarga como un .zip con un archivo por conjunto.</p>
      </div>

      <div aria-live="polite">
        {result.kind === "error" && <p className="text-sm text-error">{result.message}</p>}
        {result.kind === "done" && (
          <p className="text-sm text-ink">
            Descargado{" "}
            <span className="font-mono" translate="no">{result.fileName}</span>
            {result.sha256 && (
              <>
                {" "}
                · sha256 <span className="font-mono break-all" translate="no">{result.sha256}</span>
              </>
            )}
          </p>
        )}
      </div>
    </form>
  );
}
