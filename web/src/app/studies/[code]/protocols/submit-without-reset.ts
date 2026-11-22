import { type FormEvent, startTransition } from "react";

/**
 * onSubmit handler that dispatches a useActionState action without React's automatic form reset.
 * `<form action={fn}>` resets the form after the action; for controlled selects and checkboxes
 * that native reset makes the DOM show default values while React state (what gets submitted)
 * keeps the real ones, and on errors it throws away what the researcher typed. The submit button
 * is passed as submitter, so its name/value ("intent") reaches the action.
 */
export function submitWithoutReset(dispatch: (formData: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const formData = new FormData(event.currentTarget, submitter);
    startTransition(() => dispatch(formData));
  };
}
