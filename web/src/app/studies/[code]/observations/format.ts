import type { CoverageStatus, VisibleReviewStatus } from "@/lib/queries/observations";

// Spanish UI labels and formatters for the observation list. Data values the model produces
// (e.g. visible_items) are shown as they are stored.

export const COVERAGE_STATUS_LABEL: Record<CoverageStatus, string> = {
  observed: "Observado",
  excluded_by_participant: "Excluido por el participante",
  privacy_switch: "Interruptor de privacidad",
  device_off: "Dispositivo apagado",
  low_battery: "Batería baja",
  no_upload: "No subido",
  low_quality: "Calidad insuficiente",
};

export const REVIEW_STATUS_LABEL: Record<VisibleReviewStatus, string> = {
  pending: "Pendiente",
  confirmed: "Confirmada",
  corrected: "Corregida",
};

const EVENT_TYPE_LABEL: Record<string, string> = {
  eating_episode: "Episodio de comida",
  drinking_episode: "Episodio de bebida",
};

export function eventTypeLabel(key: string, fallback: string) {
  return EVENT_TYPE_LABEL[key] ?? fallback;
}

const EPISODE_KIND_LABEL: Record<string, string> = { meal: "comida", snack: "colación", drink: "bebida" };
const CONTEXT_LABEL: Record<string, string> = {
  seated_table: "sentado a la mesa",
  desk: "escritorio",
  standing: "de pie",
  walking: "caminando",
  kitchen: "cocina",
};

// Known attributes of the eating protocol first, in a fixed order; anything else as key: value.
export function formatAttributes(attributes: Record<string, unknown>): { label: string; value: string }[] {
  const { episode_kind, visible_items, context, ...rest } = attributes;
  const items: { label: string; value: string }[] = [];
  if (typeof episode_kind === "string") items.push({ label: "Tipo", value: EPISODE_KIND_LABEL[episode_kind] ?? episode_kind });
  if (Array.isArray(visible_items)) {
    items.push({ label: "Visible", value: visible_items.length ? visible_items.map(String).join(", ") : "—" });
  }
  if (typeof context === "string") items.push({ label: "Contexto", value: CONTEXT_LABEL[context] ?? context });
  for (const [key, value] of Object.entries(rest)) {
    items.push({ label: key, value: typeof value === "string" ? value : JSON.stringify(value) });
  }
  return items;
}

export function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (hours) parts.push(`${hours} h`);
  if (minutes) parts.push(`${minutes} min`);
  if (seconds || parts.length === 0) parts.push(`${seconds} s`);
  return parts.join(" ");
}

const hoursFormat = new Intl.NumberFormat("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const shareFormat = new Intl.NumberFormat("es-CL", { style: "percent", maximumFractionDigits: 0 });
const confidenceFormat = new Intl.NumberFormat("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatHours = (seconds: number) => `${hoursFormat.format(seconds / 3600)} h`;
// Share of time in the scope (coverage), never used for model confidence.
export const formatShare = (part: number, total: number) => (total > 0 ? shareFormat.format(part / total) : "—");
// Model confidence is a raw 0–1 model score, not a calibrated probability: no "%".
export const formatConfidence = (confidence: number | null) => (confidence === null ? "—" : confidenceFormat.format(confidence));
