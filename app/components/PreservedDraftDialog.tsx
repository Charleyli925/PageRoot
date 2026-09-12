"use client";

import { useEffect, useRef, useState } from "react";
import type { PreservedDraftSummary, VersionWorkflowOutcome } from "../application/version-workflow.js";

type Props = {
  open: boolean;
  contextKey: string;
  onClose(): void;
  onLoad(): Promise<VersionWorkflowOutcome<{ entries: PreservedDraftSummary[] }>>;
  onRestore(recoveryId: string): Promise<VersionWorkflowOutcome>;
};

export default function PreservedDraftDialog({ open, contextKey, onClose, onLoad, onRestore }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [entries, setEntries] = useState<PreservedDraftSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) { ref.current?.close(); return; }
    let active = true;
    ref.current?.showModal();
    void onLoad().then((outcome) => {
      if (!active) return;
      if (outcome.status === "succeeded") setEntries(outcome.value.entries);
      else if ("reason" in outcome) setError(outcome.reason);
    }).catch(() => { if (active) setError("暂时无法读取保留的稿件。"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, contextKey, onLoad]);

  return <dialog ref={ref} className="cancel-ai-run-dialog preserved-draft-dialog"
    aria-labelledby="preserved-drafts-title" onCancel={(event) => { event.preventDefault(); onClose(); }} onClose={onClose}>
    <article className="cancel-ai-run-card">
      <h2 id="preserved-drafts-title">找回此前的稿件</h2>
      <p>这里保留了旧工作稿和替换前的内容。恢复时会一并找回评论，当前稿也会保留。</p>
      {loading ? <p role="status">正在读取…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {!loading && !error && !entries.length ? <p>暂无需要找回的稿件。</p> : null}
      <ul className="preserved-draft-list">
        {entries.map((entry) => <li key={entry.recoveryId}>
          <span>
            <strong>{entry.reason === "migration" ? "旧工作稿" : "此前的当前稿"}</strong>
            <small>{new Date(entry.createdAt).toLocaleString()} · 基于 V{Number(entry.basedOnVersionId.replace(/^ver_/, ""))}{entry.hasComments ? " · 含评论" : ""}</small>
          </span>
          <button type="button" className="cancel-ai-run-end" disabled={Boolean(restoring)} onClick={async () => {
            setRestoring(entry.recoveryId);
            setError("");
            try {
              const outcome = await onRestore(entry.recoveryId);
              if (outcome.status === "succeeded") onClose();
              else if ("reason" in outcome) setError(outcome.reason);
            } catch { setError("稿件尚未恢复，原有内容保留。"); }
            finally { setRestoring(null); }
          }}>{restoring === entry.recoveryId ? "正在恢复…" : "恢复为当前稿"}</button>
        </li>)}
      </ul>
      <footer><button type="button" className="cancel-ai-run-wait" onClick={onClose}>关闭</button></footer>
    </article>
  </dialog>;
}
