export type ProjectExpansionState = Readonly<{
  expandedProjectIds: Readonly<Record<string, true>>;
  touchedProjectIds: Readonly<Record<string, true>>;
}>;

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
