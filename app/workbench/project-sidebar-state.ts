export type ProjectExpansionState = Readonly<{
  expandedProjectIds: Readonly<Record<string, true>>;
  touchedProjectIds: Readonly<Record<string, true>>;
}>;

export type SidebarProjectRecency = Readonly<{
  projectId: string;
  projectName: string;
  lastUpdatedAt?: string | null;
}>;

function projectUpdatedTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function compareSidebarProjects(
  left: SidebarProjectRecency,
  right: SidebarProjectRecency,
): number {
  const leftTimestamp = projectUpdatedTimestamp(left.lastUpdatedAt);
  const rightTimestamp = projectUpdatedTimestamp(right.lastUpdatedAt);
  if (leftTimestamp === null && rightTimestamp !== null) return 1;
  if (leftTimestamp !== null && rightTimestamp === null) return -1;
  if (leftTimestamp !== null && rightTimestamp !== null && leftTimestamp !== rightTimestamp) {
    return rightTimestamp - leftTimestamp;
  }
  return left.projectName.localeCompare(right.projectName, "zh-CN")
    || left.projectId.localeCompare(right.projectId);
}

export function sortSidebarProjects<T extends SidebarProjectRecency>(
  projects: readonly T[],
): T[] {
  return [...projects].sort(compareSidebarProjects);
}

function copyKnownIds(ids: readonly string[]): Set<string> {
  return new Set(ids.filter((id) => typeof id === "string" && id.length > 0));
}

function sameRecord(
  left: Readonly<Record<string, true>>,
  right: Readonly<Record<string, true>>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => right[key] === true);
}

export function createProjectExpansionState(
  currentProjectId: string | null = null,
): ProjectExpansionState {
  return {
    expandedProjectIds: currentProjectId
      ? { [currentProjectId]: true }
      : {},
    touchedProjectIds: {},
  };
}

export function toggleProjectExpansion(
  state: ProjectExpansionState,
  projectId: string,
): ProjectExpansionState {
  if (!projectId) return state;
  const expandedProjectIds = { ...state.expandedProjectIds };
  if (expandedProjectIds[projectId]) delete expandedProjectIds[projectId];
  else expandedProjectIds[projectId] = true;
  return {
    expandedProjectIds,
    touchedProjectIds: {
      ...state.touchedProjectIds,
      [projectId]: true,
    },
  };
}

export function reconcileProjectExpansionState(
  state: ProjectExpansionState,
  knownProjectIds: readonly string[],
  currentProjectId: string | null,
): ProjectExpansionState {
  const known = copyKnownIds(knownProjectIds);
  const expandedProjectIds = Object.fromEntries(
    Object.entries(state.expandedProjectIds)
      .filter(([projectId]) => known.has(projectId)),
  ) as Record<string, true>;
  const touchedProjectIds = Object.fromEntries(
    Object.entries(state.touchedProjectIds)
      .filter(([projectId]) => known.has(projectId)),
  ) as Record<string, true>;

  if (
    currentProjectId
    && known.has(currentProjectId)
    && !touchedProjectIds[currentProjectId]
  ) {
    expandedProjectIds[currentProjectId] = true;
  }

  if (
    sameRecord(expandedProjectIds, state.expandedProjectIds)
    && sameRecord(touchedProjectIds, state.touchedProjectIds)
  ) return state;
  return { expandedProjectIds, touchedProjectIds };
}
