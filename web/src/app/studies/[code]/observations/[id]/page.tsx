import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Hash } from "@/components/hash";
import { Loading, SkeletonBar } from "@/components/skeleton";
import { getClipUrl, getObservationEvidence, type ObservationEvidence } from "@/lib/evidence/queries";
import { formatDate, formatDuration, formatConfidence, formatTime } from "@/lib/format";
import { eventTypeLabel, formatAttributes, label, REVIEW_STATUS_BADGE_CLASS, REVIEW_STATUS_LABELS } from "@/lib/labels";
import { getStudyByCode } from "@/lib/queries/studies";
import { LINK } from "@/lib/ui";
import { ReviewForm } from "./review-form";

type Props = PageProps<"/studies/[code]/observations/[id]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  return { title: `Evidencia · ${code}` };
}

export default function EvidencePage(props: Props) {
  return (
    <Suspense
      fallback={
        <Loading label="Cargando evidencia…">
          <SkeletonBar className="h-8 w-64" />
          <SkeletonBar className="h-64 w-full max-w-2xl" />
        </Loading>
      }
    >
      <EvidenceContent {...props} />
    </Suspense>
  );
}

async function EvidenceContent({ params }: Props) {
  await connection();
  const { code, id } = await params;
  const study = await getStudyByCode(code);
  if (!study) notFound();
  const observation = await getObservationEvidence(study.id, id);
  if (!observation) notFound();
  const clipUrl = observation.superseded ? null : await getClipUrl(study.id, observation.id);

  const basePath = `/studies/${encodeURIComponent(study.code)}`;
  const status = observation.reviews[0]?.decision ?? "pending";
  const tz = observation.timezone;
  const durationS = (observation.endedAt.getTime() - observation.startedAt.getTime()) / 1000;

  return (
    <div className="flex flex-col gap-8">
      <Link href={`${basePath}/observations`} className={`${LINK} w-fit text-sm`}>
        ← Observaciones
      </Link>

      <header className="flex flex-col gap-2">
        <h2 className="text-xl font-medium">{eventTypeLabel(observation.eventTypeKey, observation.eventTypeLabel)}</h2>
        <p className="text-sm text-ink-muted tabular-nums">
          <Link href={`${basePath}/participants/${encodeURIComponent(observation.pseudonym)}`} className={LINK}>
            {observation.pseudonym}
          </Link>
          {" · "}
          {formatDate(observation.startedAt, tz)}, {formatTime(observation.startedAt.getTime(), tz)}–{formatTime(observation.endedAt.getTime(), tz)} ({formatDuration(durationS)}) · hora local ({tz})
        </p>
        <p className="flex flex-wrap gap-2 text-xs">
          <span className={`rounded-full px-2 py-0.5 font-medium ${REVIEW_STATUS_BADGE_CLASS[status] ?? REVIEW_STATUS_BADGE_CLASS.pending}`}>{label(REVIEW_STATUS_LABELS, status)}</span>
          {observation.superseded && <span className="rounded-full bg-warning px-2 py-0.5 font-medium text-ink">Reemplazada por una ejecución más reciente</span>}
        </p>
      </header>

      <section aria-labelledby="clip-title" className="flex flex-col gap-3">
        <h3 id="clip-title" className="text-base font-medium">Evidencia</h3>
        {clipUrl ? (
          // The clip is a cut of the original footage with a few seconds of context, never a re-rendering.
          <video controls preload="metadata" src={clipUrl} className="aspect-video w-full max-w-2xl rounded-lg bg-ink">
            Tu navegador no puede reproducir este clip.
          </video>
        ) : (
          <p className="max-w-2xl rounded-lg border border-dashed border-hairline p-6 text-sm text-ink-muted">{clipMissingReason(observation)}</p>
        )}
        <ul className="flex flex-col gap-2 text-sm">
          {observation.cuts.map((cut) => (
            <li key={`${cut.mediaAssetId}-${cut.startSecond}`} className="flex flex-col gap-0.5">
              <span className="tabular-nums">
                Segundos {cut.startSecond.toFixed(1)}–{cut.endSecond.toFixed(1)} del video original
              </span>
              <span className="text-ink-muted">
                Huella sha256 del video: <Hash value={cut.sha256} /> · dispositivo {cut.deviceSerial} · firmware {cut.firmwareVersion}
              </span>
              {!cut.inStorage && <span className="text-ink-muted">El video original ya se eliminó por la política de retención; se conserva su huella.</span>}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="detail-title" className="flex flex-col gap-3">
        <h3 id="detail-title" className="text-base font-medium">Lo que midió el modelo</h3>
        <dl className="grid max-w-xl grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {formatAttributes(observation.attributes).map((item) => (
            <div key={item.key} className="contents">
              <dt className="text-ink-muted">{item.label}</dt>
              <dd className="[overflow-wrap:anywhere]">{item.value}</dd>
            </div>
          ))}
          <dt className="text-ink-muted">Confianza del modelo</dt>
          <dd className="tabular-nums">{formatConfidence(observation.confidence)} <span className="text-ink-muted">(0 a 1, no calibrada)</span></dd>
          <dt className="text-ink-muted">Ejecución</dt>
          <dd>Modelo {observation.modelVersion} · pipeline {observation.pipelineVersion} · protocolo {observation.protocolVersion}</dd>
        </dl>
      </section>

      <section aria-labelledby="review-title" className="flex flex-col gap-4">
        <h3 id="review-title" className="text-base font-medium">Revisión humana</h3>
        {observation.superseded ? (
          <p className="text-sm text-ink-muted">Esta observación fue reemplazada: revisa la de la ejecución actual.</p>
        ) : (
          <ReviewForm studyCode={study.code} observationId={observation.id} />
        )}
        {observation.reviews.length > 0 && (
          <ol className="flex flex-col gap-2 text-sm" aria-label="Historial de revisiones">
            {observation.reviews.map((review) => (
              <li key={review.createdAt.toISOString()} className="flex flex-col">
                <span>
                  {label(REVIEW_STATUS_LABELS, review.decision)} · {formatDate(review.createdAt, tz)}, {formatTime(review.createdAt.getTime(), tz)} · {review.reviewer}
                </span>
                {review.note && <span className="text-ink-muted [overflow-wrap:anywhere]">{review.note}</span>}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function clipMissingReason(observation: ObservationEvidence) {
  if (observation.superseded) return "Esta observación fue reemplazada por una ejecución más reciente; su clip ya no se muestra.";
  if (observation.cuts.length > 0 && observation.cuts.every((cut) => !cut.inStorage)) {
    return "El video original ya se eliminó por la política de retención, y con él su clip. Quedan la huella y los segundos que lo respaldan.";
  }
  return "Todavía no hay clip para esta observación. Se genera al terminar de procesar la sesión; si el video es reciente, vuelve a intentarlo en un momento.";
}
