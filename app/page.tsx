import { redirect } from "next/navigation";

// Front door → the app. Unauthenticated users are bounced to /login by middleware.
export default function Home() {
  redirect("/dashboard");
}
