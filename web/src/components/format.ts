// Spanish labels and number/date formatting shared by portal pages.

// Display zone for instants that don't belong to a participant (e.g. protocol publication).
// Participant data should be shown in the participant's own timezone.
export const DISPLAY_TIME_ZONE = "America/Santiago";

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

export const COVERAGE_STATUS_LABELS: Record<string, string> = {
  observed: "Observado",
  excluded_by_participant: "Excluido por participante",
  privacy_switch: "Interruptor de privacidad",
  device_off: "Dispositivo apagado",
  low_battery: "Batería baja",
  no_upload: "No subido",
  low_quality: "Calidad insuficiente",
  // Not a coverage_intervals status: study-period time with no coverage row (nothing uploaded).
  no_record: "Sin registro",
};

export function label(labels: Record<string, string>, value: string) {
  return labels[value] ?? value;
}

const hours = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 });

/** "<1 min" for short non-zero spans (never "0 min"), "45 min" below one hour, "9,5 h" otherwise. */
export function formatDuration(seconds: number) {
  const minutes = Math.round(seconds / 60);
  if (minutes === 0) return seconds > 0 ? "<1 min" : "0 min";
  if (minutes < 60) return `${minutes} min`;
  return `${hours.format(seconds / 3600)} h`;
}

const dayFormat = new Intl.DateTimeFormat("es-CL", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** Formats a local calendar day given as YYYY-MM-DD (no timezone shift). */
export function formatLocalDay(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return dayFormat.format(new Date(Date.UTC(y, m - 1, d)));
}

const dateFormat = new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeZone: DISPLAY_TIME_ZONE });

export function formatDate(date: Date) {
  return dateFormat.format(date);
}
