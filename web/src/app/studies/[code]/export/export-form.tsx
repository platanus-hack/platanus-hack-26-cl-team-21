"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";
import { DATASET_CHOICES, type DatasetChoice, EXPORT_FIELDS, EXPORT_FORMATS } from "@/lib/export/params";
import { DATASET_LABEL } from "./labels";
import { ButtonLabel } from "@/components/button-label";
import { Hash } from "@/components/hash";
import { BUTTON_PRIMARY, FIELD, FIELD_LABEL } from "@/lib/ui";

type Result = { kind: "idle" } | { kind: "working" } | { kind: "error"; message: string } | { kind: "done"; fileName: string; sha256: string };

const FORMAT_LABEL = { csv: "CSV", json: "JSON" } as const;

const legendClass = "mb-1 text-sm font-medium text-ink-muted";
const radioLabelClass = "flex min-h-10 items-center gap-2";
const hintClass = "text-sm text-ink-muted";

const FILE_NAME_PATTERN = /filename="([^"]+)"/;

// Posts the form to the export route and saves the returned file. Without JavaScript the same form
// still posts natively and the browser downloads the file.
export function ExportForm({ action, participants }: { action: string; participants: string[] }) {
  const router = useRouter();
  const [dataset, setDataset] = useState<DatasetChoice>("both");
  const [result, setResult] = useState<Result>({ kind: "idle" });
  const busy = result.kind === "working";
  // State updates land on the next render; a ref blocks a second submit fired before that (double click).
  const inFlight = useRef(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
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
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <form method="post" action={action} onSubmit={onSubmit} className="flex flex-col gap-4 rounded-lg border border-rule p-4">
      <div className="flex flex-wrap gap-8">
        <fieldset>
          <legend className={legendClass}>Formato</legend>
          <div className="flex flex-wrap gap-x-4 text-sm">
            {EXPORT_FORMATS.map((format) => (
              <label key={format} className={radioLabelClass}>
                <input type="radio" name={EXPORT_FIELDS.format} value={format} defaultChecked={format === "csv"} className="accent-primary" />
                {FORMAT_LABEL[format]}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className={legendClass}>Datos</legend>
          <div className="flex flex-wrap gap-x-4 text-sm">
            {DATASET_CHOICES.map((choice) => (
              <label key={choice} className={radioLabelClass}>
                <input
                  type="radio"
                  name={EXPORT_FIELDS.dataset}
                  value={choice}
                  checked={dataset === choice}
                  onChange={() => setDataset(choice)}
                  className="accent-primary"
                />
                {DATASET_LABEL[choice]}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className={FIELD_LABEL}>
          Participante
          <select name={EXPORT_FIELDS.participant} defaultValue="" autoComplete="off" className={FIELD}>
            <option value="">Todos</option>
            {participants.map((pseudonym) => (
              <option key={pseudonym} value={pseudonym}>
                {pseudonym}
              </option>
            ))}
          </select>
        </label>
        <label className={FIELD_LABEL}>
          Desde (día local)
          <input type="date" name={EXPORT_FIELDS.from} autoComplete="off" className={FIELD} />
        </label>
        <label className={FIELD_LABEL}>
          Hasta (día local)
          <input type="date" name={EXPORT_FIELDS.to} autoComplete="off" className={FIELD} />
        </label>
      </div>
      <p className={`-mt-2 ${hintClass}`}>
        Las fechas son días locales de cada participante. Se incluyen las observaciones que empiezan en el rango y los intervalos de
        cobertura que lo tocan, completos y sin recortar.
      </p>

      {dataset === "observations" && (
        <p className="rounded-r-lg border-l-4 border-warning bg-paper-deep px-3 py-2 text-sm text-ink transition-opacity duration-150 ease-out starting:opacity-0">
          Sin los intervalos de cobertura no se puede interpretar la ausencia de observaciones: en tiempo no observado no hay un cero.
          Exporta también la cobertura con los mismos filtros antes de analizar conteos o tasas.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {/* aria-disabled instead of disabled: full contrast while busy, and focus stays on the button. */}
        <button type="submit" aria-disabled={busy} className={`${BUTTON_PRIMARY} aria-disabled:cursor-progress`}>
          <ButtonLabel idle="Generar y descargar" busy="Generando…" isBusy={busy} />
        </button>
        <p className={hintClass}>CSV con ambos conjuntos se descarga como un .zip con un archivo por conjunto.</p>
      </div>

      <div aria-live="polite">
        {result.kind === "error" && <p className="text-sm text-error">{result.message}</p>}
        {result.kind === "done" && (
          <div className="text-sm text-ink">
            Descargado{" "}
            <span className="font-mono" translate="no">{result.fileName}</span>
            {result.sha256 && (
              <>
                {" "}
                · sha256 <Hash value={result.sha256} />
              </>
            )}
          </div>
        )}
      </div>
    </form>
  );
}
