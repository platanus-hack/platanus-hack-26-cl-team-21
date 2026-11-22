/**
 * The one place that defines how to read counts and coverage. Pages link to it instead of repeating
 * the caveats in small print, so each definition is stated once and can be found when needed.
 */
export function ReadingGuide() {
  return (
    <details className="rounded-lg border border-rule p-4 text-sm">
      <summary className="cursor-pointer font-medium text-secondary underline underline-offset-2">Cómo leer estos datos</summary>
      <dl className="mt-3 grid gap-3">
        <div>
          <dt className="font-medium">Conteos</dt>
          <dd className="text-ink-muted">
            Incluyen las observaciones vigentes (no rechazadas en revisión humana) y solo provienen del tiempo observado.
          </dd>
        </div>
        <div>
          <dt className="font-medium">Tiempo no observado</dt>
          <dd className="text-ink-muted">
            No equivale a ausencia de conducta: ahí no se pudo detectar nada, así que no se reporta un cero. Se muestra con su motivo.
          </dd>
        </div>
        <div>
          <dt className="font-medium">Periodo de estudio</dt>
          <dd className="text-ink-muted">
            Va desde la primera asignación del participante a un protocolo hasta el fin de la última, su retiro u hoy, lo que ocurra
            primero. “Sin registro” es tiempo de ese periodo sin datos subidos.
          </dd>
        </div>
        <div>
          <dt className="font-medium">Días y horas</dt>
          <dd className="text-ink-muted">En la zona horaria de cada participante.</dd>
        </div>
        <div>
          <dt className="font-medium">Confianza del modelo</dt>
          <dd className="text-ink-muted">Puntaje de 0 a 1 que entrega el modelo. No es una probabilidad calibrada.</dd>
        </div>
      </dl>
    </details>
  );
}
