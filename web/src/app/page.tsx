import { redirect } from "next/navigation";

// Only redirects, so there is no UI for instant-navigation validation to render (it would log
// NEXT_REDIRECT as an error in dev).
export const instant = false;

// No landing page yet: the study list is the portal's home.
export default function Home() {
  redirect("/studies");
}
