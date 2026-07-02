"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { nameAllBatches } from "./actions";

export default function QueueActions({ hasUnnamed }: { hasUnnamed: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (!hasUnnamed) return null;

  return (
    <button
      className="ghost-dark"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await nameAllBatches();
          router.refresh();
        })
      }
    >
      {pending ? "Naming…" : "Name batches from documents"}
    </button>
  );
}
