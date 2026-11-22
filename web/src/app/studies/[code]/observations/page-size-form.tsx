import Form from "next/form";
import { SubmitButton } from "@/components/submit-button";
import { FIELD } from "@/lib/ui";

/** Rows-per-page picker. Submitted with a button, not on change (WCAG 3.2.2); with no `page` field it lands on page 1. */
export function PageSizeForm({
  action,
  size,
  sizes,
  hidden,
}: {
  action: string;
  size: number;
  sizes: readonly number[];
  hidden: [string, string][];
}) {
  return (
    <Form
      action={action}
      className="flex items-center gap-2 text-sm text-ink-muted"
    >
      {hidden.map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <label htmlFor="page-size">Filas por página</label>
      <select
        id="page-size"
        name="size"
        defaultValue={size}
        className={`${FIELD} min-h-10`}
      >
        {sizes.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <SubmitButton idle="Aplicar" busy="Aplicando…" />
    </Form>
  );
}
