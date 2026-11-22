/**
 * A sha256 (or any long hex) truncated in the middle, as GUIDELINES asks for code-like values. The
 * full value is one click away in a native disclosure, selected whole on click so it copies cleanly.
 */
export function Hash({ value }: { value: string }) {
  if (value.length <= 16) return <code className="font-mono">{value}</code>;
  return (
    <details className="inline-block align-top">
      <summary className="cursor-pointer font-mono whitespace-nowrap" title={value} translate="no">
        {value.slice(0, 8)}…{value.slice(-6)}
        <span className="sr-only">, mostrar el valor completo</span>
      </summary>
      <code className="mt-1 block max-w-[20rem] font-mono text-xs select-all [overflow-wrap:anywhere]" translate="no">
        {value}
      </code>
    </details>
  );
}
