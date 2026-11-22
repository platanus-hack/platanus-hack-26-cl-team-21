import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { label, PROTOCOL_STATUS_LABELS } from "@/lib/labels";
import { listProtocolVersions, type ProtocolVersionSummary } from "@/lib/protocols/queries";
import { getStudyByCode } from "@/lib/queries/studies";
import { AssignedCount } from "./assigned-count";
import { formatInstant, suggestNextLabel, versionHref } from "./helpers";
import { CopySourceSelect, NewDraftForm } from "./new-draft-form";
import { ProtocolStatusBadge } from "./status-badge";
import { cardClass, sectionTitle } from "./styles";

type Props = PageProps<"/studies/[code]/protocols">;

export default function ProtocolsPage({ params }: Props) {
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className={sectionTitle}>Versiones del protocolo</h2>
        <p className="max-w-3xl text-sm text-ink-muted">
          Un protocolo define qué observa el modelo: las instrucciones de observación, los tipos de evento y las variables que se
          extraen de cada uno. Una versión publicada es inmutable y queda identificada por el sha256 de su definición; para cambiar
          el método se crea un borrador nuevo, se edita y se publica. Solo las versiones publicadas se pueden asignar a participantes.
        </p>
      </section>
      <Suspense fallback={<p className="text-sm text-ink-muted">Cargando versiones…</p>}>
        <ProtocolsContent params={params} />
      </Suspense>
    </div>
  );
}

async function ProtocolsContent({ params }: Pick<Props, "params">) {
  const { code } = await params;
  await connection();
  const study = await getStudyByCode(code);
  if (!study) notFound();
  const versions = await listProtocolVersions(study.id);
  const copyable = versions
    .filter((version) => version.status !== "draft")
    .toSorted((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));
  const taken = versions.map((version) => version.versionLabel);
  const suggested = copyable[0] ? suggestNextLabel(copyable[0].versionLabel, taken) : suggestNextLabel("protocolo-v0", taken);

  return (
    <>
      <VersionTable studyCode={study.code} versions={versions} />
      <section className={cardClass}>
        <h2 className="text-base font-semibold">
          Nuevo borrador
        </h2>
        <p className="max-w-3xl text-sm text-ink-muted">
          Una copia conserva la definición de la versión base (sensores, cámara, fuera de alcance, instrucciones, tipos de evento y
          variables) y queda enlazada a ella como versión anterior.
        </p>
        <NewDraftForm studyCode={study.code} suggestedLabel={suggested} submitLabel="Crear borrador">
          <CopySourceSelect
            versions={copyable.map((version) => ({
              id: version.id,
              versionLabel: version.versionLabel,
              statusLabel: label(PROTOCOL_STATUS_LABELS, version.status),
            }))}
          />
        </NewDraftForm>
      </section>
    </>
  );
}

function VersionTable({ studyCode, versions }: { studyCode: string; versions: ProtocolVersionSummary[] }) {
  if (versions.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-ink-muted">
        Este estudio aún no tiene versiones de protocolo. Crea un borrador para empezar.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200">
      <table className="w-full text-left text-sm">
        <thead className="bg-zinc-50 text-xs text-ink-muted">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Versión</th>
            <th scope="col" className="px-3 py-2 font-medium">Estado</th>
            <th scope="col" className="px-3 py-2 font-medium">Basada en</th>
            <th scope="col" className="px-3 py-2 font-medium">Publicada (hora de Santiago)</th>
            <th scope="col" className="px-3 py-2 font-medium">sha256 de la definición</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Participantes asignados</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {versions.map((version) => (
            <tr key={version.id} className="align-top">
              <td className="px-3 py-2">
                <Link href={versionHref(studyCode, version.versionLabel)} className="font-mono font-medium break-all underline underline-offset-2" translate="no">
                  {version.versionLabel}
                </Link>
                {version.changeNote && <span className="mt-0.5 block max-w-xs text-xs text-ink-muted">{version.changeNote}</span>}
              </td>
              <td className="px-3 py-2">
                <ProtocolStatusBadge status={version.status} />
              </td>
              <td className="px-3 py-2 font-mono break-all" translate="no">
                {version.parentLabel ?? <span className="font-sans text-ink-muted">—</span>}
              </td>
              <td className="px-3 py-2">
                {version.publishedAt ? (
                  <>
                    <span className="whitespace-nowrap tabular-nums">{formatInstant(version.publishedAt)}</span>
                    {version.publishedBy && <span className="block text-xs text-ink-muted">por {version.publishedBy}</span>}
                  </>
                ) : (
                  <span className="text-ink-muted">Sin publicar</span>
                )}
              </td>
              <td className="px-3 py-2 font-mono text-xs" translate="no">
                {version.definitionSha256 ? (
                  <span title={version.definitionSha256}>{version.definitionSha256.slice(0, 12)}…</span>
                ) : (
                  <span className="font-sans text-ink-muted">Se calcula al publicar</span>
                )}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                <AssignedCount version={version} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
