import Link from "next/link";
import type { ReactNode } from "react";
import { type CoverageBandStatus, COVERAGE_STATUS_LABELS, COVERAGE_STATUS_STYLES } from "@/lib/labels";

// An illustrative day (06:00–24:00), not participant data: it shows how the portal draws coverage.
const DAY_START = 6;
const DAY_HOURS = 18;
const SEGMENTS: { from: number; to: number; status: CoverageBandStatus }[] = [
  { from: 6, to: 8, status: "device_off" },
  { from: 8, to: 12.5, status: "observed" },
  { from: 12.5, to: 13, status: "privacy_switch" },
  { from: 13, to: 16, status: "observed" },
  { from: 16, to: 17, status: "excluded_by_participant" },
  { from: 17, to: 21, status: "observed" },
  { from: 21, to: 22, status: "low_battery" },
  { from: 22, to: 24, status: "device_off" },
];
const EPISODES: { from: number; to: number; hollow: boolean }[] = [
  { from: 8.33, to: 8.67, hollow: false },
  { from: 13.17, to: 13.75, hollow: false },
  { from: 15, to: 15.15, hollow: true },
  { from: 19.5, to: 20.17, hollow: false },
];
const TICKS = [6, 9, 12, 15, 18, 21, 24];
const LEGEND = [...new Set(SEGMENTS.map((s) => s.status))];

const pct = (hour: number) => `${((hour - DAY_START) / DAY_HOURS) * 100}%`;
const span = (from: number, to: number) => ({ left: pct(from), width: `${((to - from) / DAY_HOURS) * 100}%` });

export default function Home() {
  return (
    <div className="flex flex-col gap-16 py-8">
      <section aria-labelledby="hero-title" className="flex max-w-3xl flex-col items-start gap-6">
        <p className="text-sm font-medium uppercase tracking-wider text-ink-muted">Portal de investigadores</p>
        <h1 id="hero-title" className="font-serif text-4xl leading-tight font-medium text-primary sm:text-5xl">
          Cada medición, con su <mark className="rounded-sm bg-highlight px-1 text-ink">evidencia</mark> y su cobertura.
        </h1>
        <p className="text-lg text-ink">
          Un colgante registra video y sensores bajo un protocolo de observación. El participante revisa y aprueba lo que se
          sube. El análisis extrae solo las variables que define el protocolo, y cada una queda enlazada al fragmento de video
          que la respalda.
        </p>
        <Link
          href="/studies"
          className="inline-flex min-h-12 items-center rounded-lg bg-primary px-6 text-base font-medium text-on-primary hover:bg-primary/90"
        >
          Ver estudios
        </Link>
      </section>

      <figure className="relative flex flex-col gap-6 border border-hairline p-6 sm:p-8">
        <CornerTicks />
        <figcaption className="flex flex-col gap-1">
          <span className="font-serif text-2xl font-medium">Anatomía de un día</span>
          <span className="text-sm text-ink-muted">
            Día de ejemplo. El tiempo sin observar se dibuja rayado y nunca se reporta como cero.
          </span>
        </figcaption>

        <div aria-hidden>
          <div className="relative h-12 overflow-hidden rounded-lg ring-1 ring-ink/15">
            {SEGMENTS.map((s) => (
              <span key={s.from} className="absolute inset-y-0" style={{ ...span(s.from, s.to), ...COVERAGE_STATUS_STYLES[s.status] }} />
            ))}
            {EPISODES.map((e) => (
              <span
                key={e.from}
                className={`absolute inset-y-2 min-w-1.5 rounded-sm ring-2 ring-paper ${e.hollow ? "border-2 border-ink bg-paper" : "bg-ink"}`}
                style={span(e.from, e.to)}
              />
            ))}
          </div>
          <div className="relative mt-1 h-4 text-xs tabular-nums text-ink-muted">
            {TICKS.map((h) => (
              <span
                key={h}
                className={`absolute ${h === DAY_START ? "" : h === DAY_START + DAY_HOURS ? "-translate-x-full" : "-translate-x-1/2"}`}
                style={{ left: pct(h) }}
              >
                {String(h).padStart(2, "0")}:00
              </span>
            ))}
          </div>
        </div>

        <dl className="grid gap-6 border-t border-rule pt-6 sm:grid-cols-3">
          <Specimen label="Tiempo observado" value="11 h 30 min" unit="de 18 h" />
          <Specimen label="Episodios detectados" value="4" unit="3 de alimentación, 1 de bebida" />
          <Specimen label="Sin observar" value="6 h 30 min" unit="sin conteos" />
        </dl>

        <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm" aria-label="Leyenda">
          {LEGEND.map((status) => (
            <li key={status} className="flex items-center gap-2">
              <span className="inline-block h-3.5 w-6 rounded-sm ring-1 ring-ink/15" style={COVERAGE_STATUS_STYLES[status]} aria-hidden />
              {COVERAGE_STATUS_LABELS[status]}
            </li>
          ))}
          <li className="flex items-center gap-2">
            <span className="inline-block h-3.5 w-2 rounded-sm bg-ink" aria-hidden />
            Alimentación
          </li>
          <li className="flex items-center gap-2">
            <span className="inline-block h-3.5 w-2 rounded-sm border-2 border-ink bg-paper" aria-hidden />
            Bebida
          </li>
        </ul>
      </figure>

      <section aria-labelledby="principles-title" className="flex flex-col gap-6">
        <h2 id="principles-title" className="font-serif text-2xl font-medium">
          Qué puede afirmar el observatorio
        </h2>
        <dl className="grid gap-x-10 gap-y-6 border-t border-rule pt-6 md:grid-cols-3">
          <Principle term="Evidencia auténtica">
            Los clips son cortes del material original, con su hash y sus tiempos de inicio y fin. Nada se genera ni se
            re-renderiza.
          </Principle>
          <Principle term="Cobertura explícita">
            Cada intervalo está observado o tiene un motivo: decisión del participante, interruptor de privacidad, dispositivo
            apagado, batería baja, calidad insuficiente o falta de datos.
          </Principle>
          <Principle term="Trazabilidad completa">
            Cada observación guarda la versión del protocolo, del modelo, del pipeline y del firmware que la produjo.
          </Principle>
        </dl>
        <p className="max-w-3xl text-sm text-ink-muted">
          Estudio de demostración: episodios de alimentación y bebida. Medimos cuándo, cuántas veces, cuánto duran y en qué
          contexto observable. No estimamos calorías, porciones ni nutrientes.
        </p>
      </section>
    </div>
  );
}

function Specimen({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs font-medium uppercase tracking-wider text-ink-muted">{label}</dt>
      <dd className="font-serif text-3xl tabular-nums text-ink">{value}</dd>
      <dd className="text-sm text-ink-muted">{unit}</dd>
    </div>
  );
}

function Principle({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <dt className="font-medium text-ink">{term}</dt>
      <dd className="text-ink-muted">{children}</dd>
    </div>
  );
}

// "Anatomía de un sistema" detail: corner ticks on the one framed block of the page.
function CornerTicks() {
  const tick = "pointer-events-none absolute size-3 border-ink";
  return (
    <>
      <span aria-hidden className={`${tick} -top-px -left-px border-t-2 border-l-2`} />
      <span aria-hidden className={`${tick} -top-px -right-px border-t-2 border-r-2`} />
      <span aria-hidden className={`${tick} -bottom-px -left-px border-b-2 border-l-2`} />
      <span aria-hidden className={`${tick} -bottom-px -right-px border-b-2 border-r-2`} />
    </>
  );
}
