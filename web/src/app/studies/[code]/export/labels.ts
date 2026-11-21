import type { DatasetChoice } from "@/lib/export/params";

// Spanish labels of the export page.

export const DATASET_LABEL: Record<DatasetChoice, string> = {
  observations: "Observaciones",
  coverage_intervals: "Intervalos de cobertura",
  both: "Ambos",
};

export const EXPORT_STATUS_LABEL: Record<string, string> = {
  queued: "En cola",
  running: "En proceso",
  ready: "Lista",
  failed: "Fallida",
};

// Exports are not tied to a participant, so their time is shown in the study's display zone.
export const DISPLAY_TIME_ZONE = "America/Santiago";

const dateTimeFormat = new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short", timeZone: DISPLAY_TIME_ZONE });

export const formatDateTime = (date: Date) => dateTimeFormat.format(date);
