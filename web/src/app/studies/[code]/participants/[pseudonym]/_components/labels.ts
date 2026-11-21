import type { CSSProperties } from "react";
import type { BandStatus } from "@/lib/queries/timeline";

// Spanish UI labels and the coverage colour encoding for the participant timeline.
//
// Encoding: observed time is the only solid fill. Every non-observed reason is hatched (texture is
// the "not observed" cue, independent of colour) and grouped by who caused it, one hue per group;
// the two reasons inside a group differ by hatch angle. Only three hues are used because more
// categorical hues can't stay distinguishable for colour-blind readers; the legend, tooltips and
// the per-day table always name the reason in text as well.

const AQUA = "#1baf7a";
const BLUE = "#2a78d6";
const ORANGE = "#eb6834";
const GRAY_LIGHT = "#c3c2b7";
const GRAY_DARK = "#898781";

type StatusStyle = { label: string; group: "observed" | "participant" | "device" | "data" | "unknown"; style: CSSProperties };

function hatch(color: string, angle: 45 | 135): CSSProperties {
  const ink = `color-mix(in srgb, ${color} 62%, black)`;
  return { backgroundColor: color, backgroundImage: `repeating-linear-gradient(${angle}deg, ${color} 0 5px, ${ink} 5px 7px)` };
}

export const STATUS: Record<BandStatus, StatusStyle> = {
  observed: { label: "Observado", group: "observed", style: { backgroundColor: AQUA } },
  excluded_by_participant: { label: "Excluido por el participante", group: "participant", style: hatch(BLUE, 45) },
  privacy_switch: { label: "Interruptor de privacidad", group: "participant", style: hatch(BLUE, 135) },
  device_off: { label: "Dispositivo apagado", group: "device", style: hatch(GRAY_LIGHT, 45) },
  low_battery: { label: "Batería baja", group: "device", style: hatch(GRAY_DARK, 135) },
  no_upload: { label: "No subido", group: "data", style: hatch(ORANGE, 45) },
  low_quality: { label: "Baja calidad", group: "data", style: hatch(ORANGE, 135) },
  no_record: {
    label: "Sin registro de cobertura",
    group: "unknown",
    style: { backgroundColor: "transparent", backgroundImage: "repeating-linear-gradient(45deg, transparent 0 5px, rgba(137,135,129,0.45) 5px 6px)" },
  },
};

export const STATUS_GROUPS: { title: string; statuses: BandStatus[] }[] = [
  { title: "Observado", statuses: ["observed"] },
  { title: "Decisión del participante", statuses: ["excluded_by_participant", "privacy_switch"] },
  { title: "Dispositivo", statuses: ["device_off", "low_battery"] },
  { title: "Datos y procesamiento", statuses: ["no_upload", "low_quality"] },
];

export const PARTICIPANT_STATUS: Record<string, string> = {
  enrolled: "Inscrito",
  active: "Activo",
  withdrawn: "Retirado",
  completed: "Completado",
};

export const REVIEW_STATUS: Record<string, { label: string; className: string }> = {
  pending: { label: "Pendiente de revisión", className: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
  confirmed: { label: "Confirmada por revisor", className: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  corrected: { label: "Corregida por revisor", className: "bg-sky-50 text-sky-800 dark:bg-sky-950 dark:text-sky-300" },
};

const EVENT_LABELS: Record<string, string> = {
  eating_episode: "Episodio de alimentación",
  drinking_episode: "Episodio de bebida",
};

export const eventLabel = (key: string, fallback: string) => EVENT_LABELS[key] ?? fallback;

const EVENT_PLURALS: Record<string, string> = {
  eating_episode: "episodios de alimentación",
  drinking_episode: "episodios de bebida",
};

/** Lower-case event label agreeing with `count` ("1 episodio de bebida", "2 episodios de bebida"). */
export const eventCountLabel = (key: string, fallback: string, count: number) =>
  count === 1 ? eventLabel(key, fallback).toLowerCase() : (EVENT_PLURALS[key] ?? eventLabel(key, fallback).toLowerCase());

export const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Drinking is drawn hollow, everything else solid, so the two read apart without colour. */
export const isHollowMarker = (eventKey: string) => eventKey === "drinking_episode";

const ATTRIBUTE_LABELS: Record<string, string> = {
  episode_kind: "Tipo",
  visible_items: "Elementos visibles",
  context: "Contexto",
};

const ATTRIBUTE_VALUES: Record<string, Record<string, string>> = {
  episode_kind: { meal: "comida", snack: "colación", drink: "bebida" },
  context: { seated_table: "sentado a la mesa", desk: "escritorio", standing: "de pie", walking: "caminando", kitchen: "cocina" },
};

export const attributeLabel = (key: string) => ATTRIBUTE_LABELS[key] ?? key;

/** Known attributes in protocol order (jsonb returns keys sorted by length), then the rest. */
export function sortedAttributes(attributes: Record<string, unknown>) {
  const known = Object.keys(ATTRIBUTE_LABELS);
  const rank = (key: string) => (known.includes(key) ? known.indexOf(key) : known.length);
  return Object.entries(attributes).sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
}

export function attributeValue(key: string, value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => attributeValue(key, v)).join(", ");
  if (typeof value === "string") return ATTRIBUTE_VALUES[key]?.[value] ?? value;
  if (value === null || value === undefined) return "—";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

// Uncalibrated sensors keep their raw scale: they are relative context, not certified units.
const SENSORS: Record<string, { label: string; unit: string; decimals: number }> = {
  temperature_c: { label: "Temperatura ambiente (DHT11)", unit: "°C", decimals: 1 },
  humidity_pct: { label: "Humedad relativa (DHT11)", unit: "%", decimals: 0 },
  sound_level_raw: { label: "Nivel de sonido (KY-037)", unit: "valor crudo, no son dB", decimals: 0 },
  co_raw: { label: "CO (MQ-7)", unit: "valor crudo, sin calibrar", decimals: 0 },
  flammable_gas_raw: { label: "Gas inflamable / humo (MQ-2)", unit: "valor crudo, sin calibrar", decimals: 0 },
  battery_mv: { label: "Voltaje de batería (pack 2S)", unit: "mV", decimals: 0 },
};

export const sensorInfo = (key: string, unit: string) => SENSORS[key] ?? { label: key, unit, decimals: 1 };
