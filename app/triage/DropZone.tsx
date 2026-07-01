"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { classifyBatch } from "./actions";

// v1: choose a folder (or several nested folders). Each top-level folder becomes
// one ingest_batch; files upload to the private 'staging' bucket and are recorded
// as ingest_file rows. No extraction yet — this proves the plumbing.
export default function DropZone() {
  const supabase = createClient();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // webkitdirectory isn't a typed JSX attribute — set it on the DOM node.
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

    // group files by their top-level folder
    const files = Array.from(fileList);
    const groups = new Map<string, File[]>();
    for (const f of files) {
      const rel = (f as unknown as { webkitRelativePath?: string }).webkitRelativePath || f.name;
      const top = rel.includes("/") ? rel.split("/")[0] : "Dropped files";
      if (!groups.has(top)) groups.set(top, []);
      groups.get(top)!.push(f);
    }

    let created = 0;
    let failed = 0;
    for (const [label, groupFiles] of groups) {
      const { data: batch, error: bErr } = await supabase
        .from("ingest_batch")
        .insert({ label, source: "drag_drop", created_by: user.id })
        .select("id")
        .single();

      if (bErr || !batch) {
        setMsg(`Could not create batch "${label}": ${bErr?.message ?? "unknown error"}`);
        failed++;
        continue;
      }

      for (const f of groupFiles) {
        const rel = (f as unknown as { webkitRelativePath?: string }).webkitRelativePath || f.name;
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
      // auto-classify the freshly uploaded batch
      try {
        await classifyBatch(batch.id);
      } catch {
        /* classification can also be run from the batch screen */
      }
      created++;
    }

    setMsg(
      `Created ${created} batch${created === 1 ? "" : "es"}` +
        (failed ? ` · ${failed} file/batch error(s)` : "") +
        ".",
    );
    setBusy(false);
    router.refresh();
  }

  return (
    <div>
      <div
        className="dropzone"
        role="button"
        tabIndex={0}
        onClick={() => !busy && inputRef.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && !busy && inputRef.current?.click()}
      >
        {busy ? (
          <span>Uploading…</span>
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
