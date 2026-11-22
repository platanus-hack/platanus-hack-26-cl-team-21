import type { CSSProperties } from "react";
import type { COVERAGE_STATUS } from "@observatorio/db";

// Spanish UI labels shared by every portal page, keyed by the values stored in the DB. Unknown
// values fall back to the stored value (or the DB label) so nothing is hidden.

export function label(labels: Record<string, string>, value: string) {
  return labels[value] ?? value;
}

// --- Studies, participants, protocols ---

export const STUDY_STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  active: "Activo",
  paused: "Pausado",
  closed: "Cerrado",
};

export const PARTICIPANT_STATUS_LABELS: Record<string, string> = {
  enrolled: "Inscrito",
  active: "Activo",
  withdrawn: "Retirado",
  completed: "Finalizado",
};

export const PROTOCOL_STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  published: "Publicado",
  retired: "Retirado",
};

// --- Coverage ---

export type CoverageStatus = (typeof COVERAGE_STATUS)[number];
/**
 * Not a coverage_intervals status: time inside the participant's study period with no coverage
 * row at all (nothing uploaded). ADR 0002 §5: it is shown as not observed, never as zero.
 */
export type NoRecord = "no_record";
export type CoverageBandStatus = CoverageStatus | NoRecord;
export type NotObservedStatus = Exclude<CoverageBandStatus, "observed">;

// Encoding: observed time is the only solid fill. Every non-observed reason is hatched (texture is
// the "not observed" cue, independent of colour) and grouped by who caused it, one hue per group;
// the two reasons inside a group differ by hatch angle. Only three hues are used because more
// categorical hues can't stay distinguishable for colour-blind readers, so the legend, tooltips
// and tables always name the reason in text as well.
const AQUA = "#1baf7a";
const BLUE = "#2a78d6";
const ORANGE = "#eb6834";
const GRAY_LIGHT = "#c3c2b7";
const GRAY_DARK = "#898781";

function hatch(color: string, angle: 45 | 135): CSSProperties {
  const ink = `color-mix(in srgb, ${color} 62%, black)`;
  return { backgroundColor: color, backgroundImage: `repeating-linear-gradient(${angle}deg, ${color} 0 5px, ${ink} 5px 7px)` };
}

export const COVERAGE_STATUS_LABELS: Record<CoverageBandStatus, string> = {
  observed: "Observado",
  excluded_by_participant: "Excluido por el participante",
  privacy_switch: "Interruptor de privacidad",
  device_off: "Dispositivo apagado",
  low_battery: "Batería baja",
  no_upload: "No subido",
  low_quality: "Calidad insuficiente",
  no_record: "Sin registro",
};

export const COVERAGE_STATUS_STYLES: Record<CoverageBandStatus, CSSProperties> = {
  observed: { backgroundColor: AQUA },
  excluded_by_participant: hatch(BLUE, 45),
  privacy_switch: hatch(BLUE, 135),
  device_off: hatch(GRAY_LIGHT, 45),
  low_battery: hatch(GRAY_DARK, 135),
  no_upload: hatch(ORANGE, 45),
  low_quality: hatch(ORANGE, 135),
  no_record: {
    backgroundColor: "transparent",
    backgroundImage: "repeating-linear-gradient(45deg, transparent 0 5px, rgba(137,135,129,0.45) 5px 6px)",
  },
};

export const COVERAGE_STATUS_GROUPS: { title: string; statuses: CoverageBandStatus[] }[] = [
  { title: "Observado", statuses: ["observed"] },
  { title: "Decisión del participante", statuses: ["excluded_by_participant", "privacy_switch"] },
  { title: "Dispositivo", statuses: ["device_off", "low_battery"] },
  { title: "Datos y procesamiento", statuses: ["no_upload", "low_quality"] },
  { title: "Sin información", statuses: ["no_record"] },
];

// --- Human review ---

// Review statuses that can appear in v_current_observations ('rejected' rows are hidden by the view).
export const VISIBLE_REVIEW_STATUSES = ["pending", "confirmed", "corrected"] as const;
export type VisibleReviewStatus = (typeof VISIBLE_REVIEW_STATUSES)[number];

export const REVIEW_STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  confirmed: "Confirmada",
  corrected: "Corregida",
  rejected: "Rechazada",
};

export const REVIEW_STATUS_BADGE_CLASS: Record<string, string> = {
  pending: "bg-paper-deep text-ink",
  // Outlined: on these pages the only fills are data and warnings.
  confirmed: "ring-1 ring-inset ring-primary text-primary",
  corrected: "ring-1 ring-inset ring-secondary text-secondary",
};

// --- Event types ---

// Keyed by event_types.key, which is stable across protocol versions. The DB label (written by the
// protocol author, possibly in English) is the fallback for keys not listed here.
const EVENT_TYPE_LABELS: Record<string, string> = {
  eating_episode: "Episodio de alimentación",
  drinking_episode: "Episodio de bebida",
};

const EVENT_TYPE_PLURALS: Record<string, string> = {
  eating_episode: "episodios de alimentación",
  drinking_episode: "episodios de bebida",
};

export function eventTypeLabel(key: string, dbLabel: string) {
  return EVENT_TYPE_LABELS[key] ?? dbLabel;
}

/** Lower-case event label agreeing with `count` ("1 episodio de bebida", "2 episodios de bebida"). */
export function eventCountLabel(key: string, dbLabel: string, count: number) {
  return count === 1 ? eventTypeLabel(key, dbLabel).toLowerCase() : (EVENT_TYPE_PLURALS[key] ?? eventTypeLabel(key, dbLabel).toLowerCase());
}

// --- Observation attributes ---

// Known attributes of the eating protocol, in protocol order. Free-text values the model produces
// (e.g. visible_items) are shown as stored.
const ATTRIBUTE_LABELS: Record<string, string> = {
  episode_kind: "Tipo",
  visible_items: "Elementos visibles",
  context: "Contexto",
};

const ATTRIBUTE_VALUES: Record<string, Record<string, string>> = {
  episode_kind: { meal: "comida", snack: "colación", drink: "bebida" },
  context: { seated_table: "sentado a la mesa", desk: "escritorio", standing: "de pie", walking: "caminando", kitchen: "cocina" },
};

export function attributeLabel(key: string) {
  return ATTRIBUTE_LABELS[key] ?? key;
}

export function attributeValue(key: string, value: unknown): string {
  if (Array.isArray(value)) return value.length === 0 ? "—" : value.map((v) => attributeValue(key, v)).join(", ");
  if (typeof value === "string") return ATTRIBUTE_VALUES[key]?.[value] ?? value;
  if (value === null || value === undefined) return "—";
  // Model output can nest objects: read them as "clave: valor" pairs, not raw JSON.
  if (typeof value === "object") {
    const entries = Object.entries(value);
    return entries.length === 0 ? "—" : entries.map(([k, v]) => `${attributeLabel(k)}: ${attributeValue(k, v)}`).join("; ");
  }
  return String(value);
}

/** Known attributes first in protocol order (jsonb returns keys sorted by length), then the rest. */
export function formatAttributes(attributes: Record<string, unknown>): { key: string; label: string; value: string }[] {
  const known = Object.keys(ATTRIBUTE_LABELS);
  const rank = (key: string) => (known.includes(key) ? known.indexOf(key) : known.length);
  return Object.entries(attributes)
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([key, value]) => ({ key, label: attributeLabel(key), value: attributeValue(key, value) }));
}

// --- Sensors ---

// Uncalibrated sensors keep their raw scale: they are relative context, not certified units.
const SENSORS: Record<string, { label: string; unit: string; decimals: number }> = {
  temperature_c: { label: "Temperatura ambiente (DHT11)", unit: "°C", decimals: 1 },
  humidity_pct: { label: "Humedad relativa (DHT11)", unit: "%", decimals: 0 },
  sound_level_raw: { label: "Nivel de sonido (KY-037)", unit: "valor crudo, no son dB", decimals: 0 },
  co_raw: { label: "CO (MQ-7)", unit: "valor crudo, sin calibrar", decimals: 0 },
  flammable_gas_raw: { label: "Gas inflamable / humo (MQ-2)", unit: "valor crudo, sin calibrar", decimals: 0 },
  battery_mv: { label: "Voltaje de batería (pack 2S)", unit: "mV", decimals: 0 },
};

export const SENSOR_ORDER = Object.keys(SENSORS);

export function sensorInfo(key: string, unit: string) {
  return SENSORS[key] ?? { label: key, unit, decimals: 1 };
}
