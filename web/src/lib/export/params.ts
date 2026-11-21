// What a researcher can ask for in an export, and how a submitted form is validated. Shared by the
// export page (form field names, labels of past exports) and the route handler.

export const EXPORT_FORMATS = ["csv", "json"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const DATASET_CHOICES = ["observations", "coverage_intervals", "both"] as const;
export type DatasetChoice = (typeof DATASET_CHOICES)[number];
export type Dataset = Exclude<DatasetChoice, "both">;

// Form field names (also the keys stored in exports.params.filters).
export const EXPORT_FIELDS = { format: "format", dataset: "dataset", participant: "participant", from: "from", to: "to" } as const;

export type ExportFilters = {
  participant: string | null; // pseudonym
  // Inclusive range of local days (YYYY-MM-DD), each participant's own timezone.
  dateFrom: string | null;
  dateTo: string | null;
};

export type ExportRequest = { format: ExportFormat; datasets: Dataset[]; filters: ExportFilters };

// Stored as exports.params: enough to reproduce the same export later.
export type ExportParams = {
  datasets: Dataset[];
  filters: { participant: string | null; date_from: string | null; date_to: string | null; date_basis: "participant_local_day" };
};

export function toExportParams(request: ExportRequest): ExportParams {
  return {
    datasets: request.datasets,
    filters: {
      participant: request.filters.participant,
      date_from: request.filters.dateFrom,
      date_to: request.filters.dateTo,
      date_basis: "participant_local_day",
    },
  };
}

function isLocalDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function text(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export type ParseResult = { ok: true; request: ExportRequest } | { ok: false; message: string };

// Error messages are shown to the researcher, so they are in Spanish.
export function parseExportRequest(form: FormData, participants: string[]): ParseResult {
  const format = EXPORT_FORMATS.find((f) => f === text(form, EXPORT_FIELDS.format));
  if (!format) return { ok: false, message: "Elige un formato: CSV o JSON." };

  const dataset = DATASET_CHOICES.find((d) => d === text(form, EXPORT_FIELDS.dataset));
  if (!dataset) return { ok: false, message: "Elige qué datos exportar." };
  const datasets: Dataset[] = dataset === "both" ? ["observations", "coverage_intervals"] : [dataset];

  const participant = text(form, EXPORT_FIELDS.participant);
  if (participant && !participants.includes(participant)) {
    return { ok: false, message: `El participante ${participant} no pertenece a este estudio.` };
  }

  const dateFrom = text(form, EXPORT_FIELDS.from);
  const dateTo = text(form, EXPORT_FIELDS.to);
  if ((dateFrom && !isLocalDay(dateFrom)) || (dateTo && !isLocalDay(dateTo))) {
    return { ok: false, message: "Las fechas deben tener el formato AAAA-MM-DD." };
  }
  if (dateFrom && dateTo && dateFrom > dateTo) {
    return { ok: false, message: "La fecha inicial no puede ser posterior a la final." };
  }

  return { ok: true, request: { format, datasets, filters: { participant, dateFrom, dateTo } } };
}
