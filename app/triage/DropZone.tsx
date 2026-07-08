"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { classifyBatch } from "./actions";

// Two usage shapes:
//
// 1) /triage default (no props): pick a folder, each top-level folder becomes
//    one ingest_batch, no auto-extract, stays on /triage after upload so the
//    user can see the queue.
//
// 2) Property Record take-on (propertyId set): every dropped file goes into
//    ONE batch tied to this property (label = property address). After unpack
//    + classify, kick /api/extract too, then redirect to /triage/[batchId] so
//    the agent can review + Commit. commit_batch will link to this property
//    via ingest_batch.property_id (see commitBatch fallback in triage/actions).
export default function DropZone({
  propertyId,
  overrideLabel,
  autoExtract = false,
  variant = "primary",
  redirectToBatch = false,
}: {
  propertyId?: string;
  overrideLabel?: string;
  autoExtract?: boolean;
  variant?: "primary" | "compact";
  redirectToBatch?: boolean;
} = {}) {
  const supabase = createClient();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.setAttribute("webkitdirectory", "");
      inputRef.current.setAttribute("directory", "");
    }
  }, []);

  async function handleFiles(fileList: FileList) {
    setBusy(true);
    setMsg("Reading files…");

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setMsg("Not signed in.");
      setBusy(false);
      return;
    }

    const files = Array.from(fileList);

    // Group by top-level folder — unless propertyId is set, in which case all
    // files collapse into ONE batch tied to that property.
    const groups = new Map<string, File[]>();
    if (propertyId) {
      groups.set(overrideLabel ?? "Take-on", files);
    } else {
      for (const f of files) {
        const rel =
          (f as unknown as { webkitRelativePath?: string }).webkitRelativePath ||
          f.name;
        const top = rel.includes("/") ? rel.split("/")[0] : "Dropped files";
        if (!groups.has(top)) groups.set(top, []);
        groups.get(top)!.push(f);
      }
    }

    let created = 0;
    let failed = 0;
    const batchIds: string[] = [];

    for (const [label, groupFiles] of groups) {
      const insertPayload: Record<string, unknown> = {
        label,
        source: "drag_drop",
        created_by: user.id,
      };
      if (propertyId) insertPayload.property_id = propertyId;

      const { data: batch, error: bErr } = await supabase
        .from("ingest_batch")
        .insert(insertPayload)
        .select("id")
        .single();

      if (bErr || !batch) {
        setMsg(`Could not create batch "${label}": ${bErr?.message ?? "unknown error"}`);
        failed++;
        continue;
      }

      batchIds.push(batch.id);

      for (const f of groupFiles) {
        const rel =
          (f as unknown as { webkitRelativePath?: string }).webkitRelativePath ||
          f.name;
        const path = `${batch.id}/${rel}`;
        const { error: upErr } = await supabase.storage
          .from("staging")
          .upload(path, f, { upsert: true });
        if (upErr) failed++;
        await supabase.from("ingest_file").insert({
          batch_id: batch.id,
          original_filename: f.name,
          storage_bucket: "staging",
          storage_path: path,
          mime_type: f.type || null,
          byte_size: f.size,
          status: "uploaded",
        });
      }

      // Unpack any .eml files, then classify everything.
      let unpackNote = "";
      try {
        const upRes = await fetch("/api/unpack", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ batchId: batch.id }),
        });
        const upJson = await upRes.json();
        if (upJson && upJson.ok) {
          if (Array.isArray(upJson.errors) && upJson.errors.length > 0) {
            unpackNote = ` · unpack: ${upJson.errors.length} error(s) — retry from the review screen`;
          } else if (upJson.attachments > 0) {
            unpackNote = ` · unpacked ${upJson.attachments} attachment(s)`;
          }
        } else if (upJson && upJson.error) {
          unpackNote = ` · unpack error: ${upJson.error}`;
        }
      } catch (e) {
        unpackNote = ` · unpack call failed: ${(e as Error).message}`;
      }
      try {
        await classifyBatch(batch.id);
      } catch {
        /* classification can also be run from the batch screen */
      }

      // Property take-on runs extraction eagerly so the review page has real
      // proposed fields the moment the agent lands on it.
      if (autoExtract) {
        try {
          setMsg(`Reading documents…${unpackNote}`);
          const exRes = await fetch("/api/extract", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ batchId: batch.id }),
          });
          const exJson = await exRes.json();
          if (!exJson.ok && exJson.note) {
            unpackNote += ` · extract: ${exJson.note}`;
          }
        } catch (e) {
          unpackNote += ` · extract call failed: ${(e as Error).message}`;
        }
      }

      created++;
      if (unpackNote) setMsg((prev) => (prev ?? "") + unpackNote);
    }

    setMsg(
      `Created ${created} batch${created === 1 ? "" : "es"}` +
        (failed ? ` · ${failed} file/batch error(s)` : "") +
        ".",
    );
    setBusy(false);

    if (redirectToBatch && batchIds.length === 1) {
      router.push(`/triage/${batchIds[0]}`);
    } else {
      router.refresh();
    }
  }

  const compact = variant === "compact";

  return (
    <div>
      <div
        className="dropzone"
        role="button"
        tabIndex={0}
        onClick={() => !busy && inputRef.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && !busy && inputRef.current?.click()}
        style={compact ? { padding: "24px 20px" } : undefined}
      >
        {busy ? (
          <span>Uploading…</span>
        ) : propertyId ? (
          <>
            <strong>Drop this property&apos;s folder here</strong>
            <span>
              Everything you drop lands on this property record. Unpack + classify +
              extract runs automatically; review + commit on the next screen.
            </span>
          </>
        ) : (
          <>
            <strong>Choose a folder to migrate</strong>
            <span>One folder = one deal. Nested folders each become their own batch.</span>
          </>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => e.target.files && handleFiles(e.target.files)}
      />
      {msg && <p className="dz-msg">{msg}</p>}
    </div>
  );
}
