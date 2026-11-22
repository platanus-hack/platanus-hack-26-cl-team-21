import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { deleteDraftAction, retireVersionAction } from "@/lib/protocols/actions";
import { definitionSha256, draftRevision } from "@/lib/protocols/definition";
import { getProtocolVersion, listProtocolVersions, type ProtocolVersionDetail, readVariables, stringList } from "@/lib/protocols/queries";
import { getStudyByCode } from "@/lib/queries/studies";
import { AssignedCount } from "../assigned-count";
import { formatInstant, protocolsHref, suggestNextLabel } from "../helpers";
import { FixedCopySource, NewDraftForm } from "../new-draft-form";
import { ProtocolStatusBadge } from "../status-badge";
import { cardClass, hintClass } from "../styles";
import { ConfirmActionForm } from "./confirm-action-form";
import { DraftEditor } from "./draft-editor";
import { CaptureSection, DefinitionJson, VersionView } from "./version-view";

type Props = PageProps<"/studies/[code]/protocols/[version]">;

export default function ProtocolVersionPage({ params }: Props) {
  return (
    <Suspense fallback={<p className="text-sm text-ink-muted">Cargando versión…</p>}>
      <VersionContent params={params} />
    </Suspense>
  );
}

async function VersionContent({ params }: Pick<Props, "params">) {
  const { code, version: versionLabel } = await params;
  await connection();
  const study = await getStudyByCode(code);
  if (!study) notFound();
  const [version, siblings] = await Promise.all([getProtocolVersion(study.id, versionLabel), listProtocolVersions(study.id)]);
  if (!version) notFound();

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Ruta" className="text-sm">
        <Link href={protocolsHref(study.code)} className="underline underline-offset-2">
          Versiones del protocolo
        </Link>
        <span className="text-ink-muted"> / </span>
        <span className="font-mono break-all" translate="no" aria-current="page">
          {version.versionLabel}
        </span>
      </nav>
      <VersionHeader version={version} />
      {version.status === "draft" ? (
        <>
          <DraftEditor
            studyCode={study.code}
            versionId={version.id}
            initial={{
              versionLabel: version.versionLabel,
              changeNote: version.changeNote ?? "",
              observationPrompt: typeof version.definition.observation_prompt === "string" ? version.definition.observation_prompt : "",
              outOfScope: stringList(version.definition.out_of_scope),
              eventTypes: version.eventTypes.map(({ key, label }) => ({ key, label })),
              variables: readVariables(version.definition),
            }}
            revision={draftRevision(version)}
          />
          <CaptureSection definition={version.definition} />
          <DefinitionJson definition={version.definition} />
          <section className={cardClass}>
            <h2 className="text-base font-semibold">
              Eliminar borrador
            </h2>
            <ConfirmActionForm
              action={deleteDraftAction}
              studyCode={study.code}
              versionId={version.id}
              triggerLabel="Eliminar borrador…"
              confirmLabel="Eliminar borrador"
              pendingLabel="Eliminando…"
            >
              <p>
                Se eliminan el borrador <span className="font-mono">{version.versionLabel}</span> y sus tipos de evento. No se puede
                deshacer. Las versiones publicadas no se ven afectadas.
              </p>
            </ConfirmActionForm>
          </section>
        </>
      ) : (
        <>
          <ImmutableActions
            studyCode={study.code}
            version={version}
            suggestedLabel={suggestNextLabel(
              version.versionLabel,
              siblings.map((sibling) => sibling.versionLabel),
            )}
          />
          <VersionView version={version} />
          <DefinitionJson definition={version.definition} />
        </>
      )}
    </div>
  );
}

function VersionHeader({ version }: { version: ProtocolVersionDetail }) {
  const shaMatches = version.definitionSha256 !== null && definitionSha256(version.definition) === version.definitionSha256;
  return (
    <header className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-mono text-xl font-semibold break-all" translate="no">
          {version.versionLabel}
        </h2>
        <ProtocolStatusBadge status={version.status} />
      </div>
      {version.changeNote && <p className="max-w-3xl text-sm text-ink-muted">{version.changeNote}</p>}
      <dl className="grid max-w-3xl grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-ink-muted">Basada en</dt>
        <dd className="font-mono" translate="no">
          {version.parentLabel ?? <span className="font-sans">— (creada desde cero)</span>}
        </dd>
        <dt className="text-ink-muted">Publicada</dt>
        <dd>
          {version.publishedAt ? `${formatInstant(version.publishedAt)} (hora de Santiago)${version.publishedBy ? ` por ${version.publishedBy}` : ""}` : "Sin publicar"}
        </dd>
        <dt className="text-ink-muted">sha256 de la definición</dt>
        <dd>
          {version.definitionSha256 ? (
            <>
              <span className="font-mono text-xs break-all" translate="no">
                {version.definitionSha256}
              </span>
              <span className={`block ${hintClass}`}>
                {shaMatches
                  ? "Coincide con el JSON canónico de la definición guardada."
                  : "No coincide con el JSON canónico de la definición guardada. El portal siempre lo calcula así, de modo que esta versión no se publicó desde el portal."}
              </span>
            </>
          ) : (
            "Se calcula al publicar."
          )}
        </dd>
        <dt className="text-ink-muted">Participantes asignados</dt>
        <dd className="tabular-nums">
          <AssignedCount version={version} />
        </dd>
      </dl>
    </header>
  );
}

function ImmutableActions({ studyCode, version, suggestedLabel }: { studyCode: string; version: ProtocolVersionDetail; suggestedLabel: string }) {
  return (
    <section className={cardClass}>
      <h2 className="text-base font-semibold">
        {version.status === "published" ? "Versión publicada: no se puede editar" : "Versión retirada: no se puede editar"}
      </h2>
      <p className="max-w-3xl text-sm text-ink-muted">
        Las observaciones registradas con esta versión apuntan a esta definición exacta. Para cambiar el método, cópiala como un nuevo
        borrador, edítalo y publícalo.
      </p>
      <NewDraftForm studyCode={studyCode} suggestedLabel={suggestedLabel} submitLabel="Copiar como nuevo borrador">
        <FixedCopySource versionId={version.id} />
      </NewDraftForm>
      {version.status === "published" && (
        <ConfirmActionForm
          action={retireVersionAction}
          studyCode={studyCode}
          versionId={version.id}
          triggerLabel="Retirar versión…"
          confirmLabel="Retirar versión"
          pendingLabel="Retirando…"
          success="Versión retirada."
        >
          <p>
            Retirar indica que <span className="font-mono">{version.versionLabel}</span> no debe usarse en nuevas asignaciones. La
            definición no cambia, sigue siendo inmutable y los participantes asignados mantienen su asignación (
            {version.currentParticipants} ahora). El portal no permite volver a publicarla.
          </p>
        </ConfirmActionForm>
      )}
    </section>
  );
}
