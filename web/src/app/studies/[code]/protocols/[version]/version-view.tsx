import { eventTypeLabel } from "@/lib/labels";
import { canonicalJson } from "@/lib/protocols/definition";
import { VARIABLE_TYPE_LABELS, type VariableType } from "@/lib/protocols/model";
import { type ProtocolVersionDetail, readVariables, stringList } from "@/lib/protocols/queries";
import { cardClass, focusRing, hintClass, sectionTitle } from "../styles";

// Read-only views of a stored definition. Definitions are read defensively: versions created
// before the editor (the seeded eating-v1) have no prompt or variables, and must still render.

const muted = "text-sm text-zinc-600 dark:text-zinc-400";
const codeBlock = "max-h-96 overflow-auto rounded-md bg-zinc-50 p-3 font-mono text-xs dark:bg-zinc-900";

export function VersionView({ version }: { version: ProtocolVersionDetail }) {
  const { definition } = version;
  const prompt = typeof definition.observation_prompt === "string" ? definition.observation_prompt.trim() : "";
  const variables = readVariables(definition);
  const hasVariablesKey = Array.isArray(definition.variables);

  return (
    <div className="flex flex-col gap-6">
      <section className={cardClass}>
        <h2 className={sectionTitle}>
          Instrucciones de observación
        </h2>
        {prompt ? (
          <p className="text-sm break-words whitespace-pre-wrap">{prompt}</p>
        ) : (
          <p className={muted}>Esta versión no tiene instrucciones de observación en su definición (se creó antes del editor de protocolos).</p>
        )}
      </section>

      <section className={cardClass}>
        <h2 className={sectionTitle}>
          Tipos de evento
        </h2>
        {version.eventTypes.length === 0 ? (
          <p className={muted}>Esta versión no define tipos de evento.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                <tr>
                  <th scope="col" className="py-2 pr-4 font-medium">Clave</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Nombre</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Variables</th>
                  <th scope="col" className="py-2 font-medium">Esquema de atributos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {version.eventTypes.map((eventType) => {
                  const names = hasVariablesKey
                    ? variables.filter((variable) => variable.applies_to.includes(eventType.key)).map((variable) => variable.name)
                    : schemaPropertyNames(eventType.attributesSchema);
                  return (
                    <tr key={eventType.id} className="align-top">
                      <td className="py-2 pr-4 font-mono" translate="no">
                        {eventType.key}
                      </td>
                      <td className="py-2 pr-4">
                        {eventTypeLabel(eventType.key, eventType.label)}
                        {eventTypeLabel(eventType.key, eventType.label) !== eventType.label && (
                          <span className="block text-xs text-zinc-500 dark:text-zinc-400">En el protocolo: {eventType.label}</span>
                        )}
                      </td>
                      <td className="py-2 pr-4 font-mono" translate="no">
                        {names.length > 0 ? names.join(", ") : <span className="font-sans text-zinc-500 dark:text-zinc-400">ninguna</span>}
                      </td>
                      <td className="py-2">
                        <JsonDetails summary="Ver JSON Schema" value={eventType.attributesSchema} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={cardClass}>
        <h2 className={sectionTitle}>
          Variables
        </h2>
        {!hasVariablesKey ? (
          <p className={muted}>
            Esta versión no declara variables en su definición (se creó antes del editor de protocolos). Sus atributos están solo en el
            esquema JSON de cada tipo de evento, arriba. Al copiarla como borrador, el editor los convierte en variables; si un esquema usa reglas que no puede representar, la copia se rechaza.
          </p>
        ) : variables.length === 0 ? (
          <p className={muted}>Sin variables: las observaciones no llevan atributos.</p>
        ) : (
          <VariableTable variables={variables} />
        )}
      </section>

      <SettingsSection definition={definition} />
    </div>
  );
}

function VariableTable({ variables }: { variables: ReturnType<typeof readVariables> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-zinc-200 text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          <tr>
            <th scope="col" className="py-2 pr-4 font-medium">Nombre</th>
            <th scope="col" className="py-2 pr-4 font-medium">Tipo</th>
            <th scope="col" className="py-2 pr-4 font-medium">Valores permitidos</th>
            <th scope="col" className="py-2 pr-4 font-medium">Obligatoria</th>
            <th scope="col" className="py-2 pr-4 font-medium">Aplica a</th>
            <th scope="col" className="py-2 font-medium">Descripción</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {variables.map((variable) => (
            <tr key={variable.name} className="align-top">
              <td className="py-2 pr-4 font-mono" translate="no">
                {variable.name}
              </td>
              <td className="py-2 pr-4">{VARIABLE_TYPE_LABELS[variable.type as VariableType] ?? variable.type}</td>
              <td className="py-2 pr-4 font-mono" translate="no">
                {variable.allowed_values?.length ? variable.allowed_values.join(", ") : <span className="font-sans text-zinc-500 dark:text-zinc-400">—</span>}
              </td>
              <td className="py-2 pr-4">{variable.required ? "Sí" : "No"}</td>
              <td className="py-2 pr-4 font-mono" translate="no">
                {variable.applies_to.join(", ")}
              </td>
              <td className="py-2">{variable.description ?? <span className="text-zinc-500 dark:text-zinc-400">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Scope and capture settings of a published or retired version. */
function SettingsSection({ definition }: { definition: Record<string, unknown> }) {
  return (
    <section className={cardClass}>
      <h2 className={sectionTitle}>Alcance y captura</h2>
      <OutOfScopeList items={stringList(definition.out_of_scope)} />
      <CaptureSettings definition={definition} />
    </section>
  );
}

/** Capture settings alone, for drafts (their out-of-scope list is edited in the form). */
export function CaptureSection({ definition }: { definition: Record<string, unknown> }) {
  return (
    <section className={cardClass}>
      <h2 className={sectionTitle}>Captura</h2>
      <CaptureSettings definition={definition} />
    </section>
  );
}

function OutOfScopeList({ items }: { items: string[] }) {
  return (
    <div>
      <h3 className="text-sm font-medium">Fuera de alcance</h3>
      {items.length > 0 ? (
        <>
          <p className={hintClass}>Este protocolo no mide lo siguiente; el modelo no debe reportarlo.</p>
          <ul className="mt-1 flex flex-wrap gap-2">
            {items.map((item) => (
              <li key={item} className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs dark:bg-zinc-800" translate="no">
                {item}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className={muted}>No declara nada fuera de alcance.</p>
      )}
    </div>
  );
}

/** Sensors and camera: the portal doesn't edit them; a copy keeps the base version's. */
function CaptureSettings({ definition }: { definition: Record<string, unknown> }) {
  const { sensors, camera } = definition;
  return (
    <div>
      <h3 className="text-sm font-medium">Sensores y cámara</h3>
      <p className={hintClass}>Se heredan de la versión base y no se editan desde el portal.</p>
      {sensors === undefined && camera === undefined ? (
        <p className={muted}>Sin configuración de sensores ni de cámara en la definición.</p>
      ) : (
        <div className="mt-1 flex flex-wrap gap-3">
          {sensors !== undefined && <JsonDetails summary="Sensores" value={sensors} />}
          {camera !== undefined && <JsonDetails summary="Cámara" value={camera} />}
        </div>
      )}
    </div>
  );
}

export function DefinitionJson({ definition }: { definition: Record<string, unknown> }) {
  return (
    <details className="text-sm">
      <summary className={`w-fit cursor-pointer rounded underline underline-offset-2 ${focusRing}`}>Ver la definición completa (JSON)</summary>
      <p className={`${hintClass} mt-2`}>
        JSON canónico (claves ordenadas, sin espacios). Al publicar desde el portal, el sha256 se calcula sobre este texto.
      </p>
      <pre className={`${codeBlock} mt-1 break-all whitespace-pre-wrap`} translate="no">
        {canonicalJson(definition)}
      </pre>
    </details>
  );
}

function JsonDetails({ summary, value }: { summary: string; value: unknown }) {
  return (
    <details className="text-sm">
      <summary className={`w-fit cursor-pointer rounded underline underline-offset-2 ${focusRing}`}>{summary}</summary>
      <pre className={`${codeBlock} mt-1`} translate="no">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

function schemaPropertyNames(schema: unknown): string[] {
  const properties = (schema as { properties?: unknown } | null)?.properties;
  return typeof properties === "object" && properties !== null ? Object.keys(properties) : [];
}
