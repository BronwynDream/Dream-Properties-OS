"use client";

import Link from "next/link";

function shortRelative(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}d ago`;
  return d.toISOString().slice(0, 10);
}

export default function InboxRow({
  batchId,
  sender,
  subject,
  fileCount,
  createdAt,
}: {
  batchId: string;
  sender: string;
  subject: string;
  fileCount: number;
  createdAt: string;
}) {
  return (
    <Link href={`/triage/${batchId}`} className="lead-row" prefetch={false}>
      <div className="lead-row-sender">{sender}</div>
      <div className="lead-row-subject">{subject}</div>
      <div className="lead-row-meta">
        <span>{fileCount === 0 ? "no files" : `${fileCount} file${fileCount === 1 ? "" : "s"}`}</span>
        <span>·</span>
        <span>{shortRelative(createdAt)}</span>
      </div>
    </Link>
  );
}
