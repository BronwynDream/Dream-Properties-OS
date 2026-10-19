"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { resolveFeedback } from "@/app/feedback/actions";

export default function ResolveButton({ id, done }: { id: string; done: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      className="adddocs-link"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await resolveFeedback(id, !done);
          router.refresh();
        })
      }
    >
      {pending ? "…" : done ? "Reopen" : "Mark done"}
    </button>
  );
}
