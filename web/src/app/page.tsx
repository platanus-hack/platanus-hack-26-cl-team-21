import { redirect } from "next/navigation";

// No landing page yet: the study list is the portal's home.
export default function Home() {
  redirect("/studies");
}
