import type { ActionState } from "@/lib/protocols/model";

// What a protocol action answered: the errors to fix, or nothing. Lives in a live region so screen
// readers hear the result of a submit.
export function ActionFeedback({ state, success }: { state: ActionState; success?: string }) {
  return (
    <div aria-live="polite">
      {state.status === "error" && (
        <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.errors.length === 1 ? (
            <p>{state.errors[0]}</p>
          ) : (
            <>
              <p className="font-medium">Corrige lo siguiente:</p>
              <ul className="mt-1 list-disc pl-5">
                {state.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      {state.status === "saved" && success && <p className="text-sm text-emerald-800">{success}</p>}
    </div>
  );
}
