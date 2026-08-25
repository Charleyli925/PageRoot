"use client";

import { FileHtmlIcon } from "@phosphor-icons/react/dist/csr/FileHtml";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";

import type { BackgroundProjectResult, RegisteredProject } from "./types";
import { formatProjectTimestamp } from "./project-model";

type RegisteredProjectListProps = {
  projects: RegisteredProject[];
  error: string;
  activeProjectId: string | null;
  actionsDisabled: boolean;
  canForgetRecent: boolean;
  statusForSource: (sourcePath: string) => BackgroundProjectResult | null;
  onOpen: (projectId: string) => void;
  onForgetRecent: (sourcePath: string) => void;
  onRetry: () => void;
};

// A row that cannot be opened explains itself in place, so the list never
// invites a click that would only come back as REGISTERED_PROJECT_UNAVAILABLE,
// and it names the one recovery the write path also accepts: put the folder
// back where it was registered.
const BLOCKED_AVAILABILITY = Object.freeze({
  unavailable: Object.freeze({
    badge: "暂不可用",
    detail: "项目文件夹已不在原登记位置；放回后自动恢复。",
  }),
  invalid: Object.freeze({
    badge: "项目记录异常",
    detail: "项目记录无法核对，暂时不能打开。",
  }),
});

function blockedNote(project: RegisteredProject) {
  return project.availability === "ready"
    ? null
    : BLOCKED_AVAILABILITY[project.availability];
}

// One badge per row keeps the row grid stable, so the reasons are ranked: why
// the row is unopenable wins over what it currently is, and the Registry's own
// pending-candidate signal is the last thing worth saying.
function rowBadge(
  project: RegisteredProject,
  active: boolean,
  liveStatus: BackgroundProjectResult | null,
): { label: string; state?: string } | null {
  const blocked = blockedNote(project);
  if (blocked) return { label: blocked.badge, state: "error" };
  if (active) return { label: "当前项目" };
  if (liveStatus) return { label: liveStatus.label, state: liveStatus.state };
  if (project.hasPendingCandidate) return { label: "新版本可查看", state: "ready" };
  return null;
}

export default function RegisteredProjectList({
  projects,
  error,
  activeProjectId,
  actionsDisabled,
  canForgetRecent,
  statusForSource,
  onOpen,
  onForgetRecent,
  onRetry,
}: RegisteredProjectListProps) {
  return (
    <section className="recent-files">
      <header>
        <strong>全部项目</strong>
        {projects.length ? <small>{projects.length} 个项目</small> : null}
      </header>
      {error ? (
        <section className="recent-projects-error" role="status">
          <span>{error}</span>
          <button type="button" onClick={() => onRetry()}>
            重试读取
          </button>
        </section>
      ) : null}
      {/* Registry membership decides who is listed here, and the desktop layer
          has already applied Recent's lastOpenedAt ordering. Sorting again
          would make this view a second ordering owner (ADR 0024). */}
      <div className="project-catalog-rows">
        {projects.length ? projects.map((project, index) => {
          const blocked = blockedNote(project);
          const active = Boolean(
            activeProjectId && project.projectId === activeProjectId,
          );
          const liveStatus = project.activeSourcePath
            ? statusForSource(project.activeSourcePath)
            : null;
          const badge = rowBadge(project, active, liveStatus);
          const recentSourcePath = project.lastOpenedAt && project.activeSourcePath
            ? project.activeSourcePath
            : null;
          return (
            <div className="recent-file-item" key={project.projectId}>
              <button
                className="recent-file-row"
                type="button"
                data-tooltip={blocked
                  ? `${project.projectName}\n${blocked.detail}`
                  : project.projectName}
                data-tooltip-wrap="true"
                // The first row has the dialog title above it, so its tooltip
                // drops below instead of covering the heading.
                data-tooltip-side={index === 0 ? "below" : undefined}
                disabled={actionsDisabled || active || Boolean(blocked)}
                onClick={() => onOpen(project.projectId)}
              >
                <FileHtmlIcon aria-hidden="true" size={16} weight="duotone" />
                <strong>{project.projectName}</strong>
                {badge ? (
                  <em className="recent-project-status" data-state={badge.state}>
                    {badge.label}
                  </em>
                ) : null}
                <time
                  dateTime={project.lastOpenedAt
                    ? new Date(project.lastOpenedAt).toISOString()
                    : undefined}
                >
                  {formatProjectTimestamp(project.lastOpenedAt)}
                </time>
              </button>
              {/* Recent only ranks the catalog, so this clears the row's
                  lastOpenedAt and drops it to name order; the project stays a
                  Registry member either way (ADR 0024). */}
              {canForgetRecent && recentSourcePath ? (
                <button
                  className="recent-file-remove"
                  type="button"
                  aria-label={`清除 ${project.projectName} 的最近打开时间`}
                  title="清除最近打开时间"
                  onClick={() => onForgetRecent(recentSourcePath)}
                >
                  <XIcon aria-hidden="true" size={13} weight="bold" />
                </button>
              ) : null}
            </div>
          );
        }) : !error ? (
          <span className="recent-projects-empty">还没有项目</span>
        ) : null}
      </div>
    </section>
  );
}
