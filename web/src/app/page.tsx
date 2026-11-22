import Link from "next/link";
import type { ReactNode } from "react";
import { RigoIsotype } from "@/components/brand";
import { CornerTicks, Specimen } from "@/components/specimen";
import { formatDuration, formatLocalDay } from "@/lib/format";
import { eventCountLabel } from "@/lib/labels";
import { CoverageLegend } from "@/components/coverage-legend";
import { DayTimeline } from "@/components/day-timeline";
import { ObservationList } from "@/components/observation-list";
import { EXAMPLE_DAY, EXAMPLE_OBSERVATION, EXAMPLE_TIME_ZONE } from "./_fixtures/example-day";
import { CircuitBackground } from "@/components/ui/circuit-background";

export default function Home() {
  const { summary } = EXAMPLE_DAY;
  const episodes = summary.counts.reduce((sum, c) => sum + c.count, 0);
  const breakdown = summary.counts.map((c) => `${c.count} ${eventCountLabel(c.eventKey, c.eventLabel, c.count)}`).join(", ");

  return (
    <div className="flex flex-col gap-12">
      <CircuitBackground data-hero className="-mt-8 [margin-inline:calc(50%-50vw)] w-screen!">
        <section aria-labelledby="hero-title" className="pointer-events-none mx-auto flex w-full max-w-6xl flex-col items-start justify-center gap-5 px-6">
          <div className="flex items-center gap-2 text-sm font-medium tracking-wider text-white/70 uppercase">
            <RigoIsotype className="h-4 w-auto text-warning" />
            <span>Portal de investigadores</span>
          </div>
          <h1 id="hero-title" className="max-w-3xl font-serif text-4xl leading-tight font-medium text-white sm:text-6xl">
            Cada medición, con su <mark className="rounded-sm bg-highlight px-1 text-ink">evidencia</mark> y su cobertura.
          </h1>
          <p className="max-w-3xl text-lg text-white/80">
            Un colgante registra video y sensores bajo un protocolo de observación. El participante revisa y aprueba lo que se sube. El
            análisis extrae solo las variables que define el protocolo, y cada una queda enlazada al fragmento de video que la respalda.
          </p>
          <Link
            href="/studies"
            className="pointer-events-auto inline-flex min-h-12 items-center rounded-lg bg-white px-6 text-base font-medium text-primary transition-[background-color] duration-150 ease-out hover:bg-white/90"
          >
            Ver estudios
          </Link>
        </section>
      </CircuitBackground>

      {/* The real timeline and observation card, fed an example day (see _fixtures/example-day.ts). */}
      <section aria-labelledby="anatomy-title" className="relative flex flex-col gap-6 border border-hairline p-6 sm:p-8">
        <CornerTicks />
        <div className="flex flex-col gap-1">
          <h2 id="anatomy-title" className="font-serif text-2xl font-medium">
            Anatomía de un día
          </h2>
          <p className="text-sm text-ink-muted">Día de ejemplo. El tiempo sin observar se dibuja rayado y nunca se reporta como cero.</p>
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="font-medium">{formatLocalDay(EXAMPLE_DAY.day, "long")}</h3>
          <DayTimeline day={EXAMPLE_DAY} timeZone={EXAMPLE_TIME_ZONE} linkMarkers={false} />
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
          <dl className="grid content-start gap-6 sm:grid-cols-3 lg:grid-cols-1">
            <Specimen
              label="Tiempo observado"
              value={formatDuration(summary.observedMs / 1000)}
              unit={`de ${formatDuration(summary.periodMs / 1000)}`}
            />
            <Specimen label="Episodios detectados" value={String(episodes)} unit={breakdown} />
            <Specimen label="Sin observar" value={formatDuration((summary.periodMs - summary.observedMs) / 1000)} unit="sin conteos" />
          </dl>
          <div className="flex flex-col gap-2">
            <p className="text-sm text-ink-muted">Cada episodio enlaza a su evidencia:</p>
            <ObservationList observations={[EXAMPLE_OBSERVATION]} timeZone={EXAMPLE_TIME_ZONE} />
          </div>
        </div>

        <CoverageLegend showNoRecord={false} />
      </section>

      <section aria-labelledby="principles-title" className="flex flex-col gap-6">
        <h2 id="principles-title" className="font-serif text-2xl font-medium">
          Qué puede afirmar el observatorio
        </h2>
        <dl className="grid gap-x-10 gap-y-6 border-t border-rule pt-6 md:grid-cols-3">
          <Principle term="Evidencia auténtica">
            Los clips son cortes del material original, con su hash y sus tiempos de inicio y fin. Nada se genera ni se re-renderiza.
          </Principle>
          <Principle term="Cobertura explícita">
            Cada intervalo está observado o tiene un motivo: decisión del participante, interruptor de privacidad, dispositivo apagado,
            batería baja, calidad insuficiente o falta de datos.
          </Principle>
          <Principle term="Trazabilidad completa">
            Cada observación guarda la versión del protocolo, del modelo, del pipeline y del firmware que la produjo.
          </Principle>
        </dl>
        <p className="max-w-3xl text-sm text-ink-muted">
          Estudio de demostración: episodios de alimentación y bebida. Medimos cuándo, cuántas veces, cuánto duran y en qué contexto
          observable. No estimamos calorías, porciones ni nutrientes.
        </p>
      </section>
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
