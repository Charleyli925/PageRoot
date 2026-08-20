// Version lineage projection for the current-project console.
//
// The project console shows one project's versions as a tree: every version
// declares which version it was modified from, so branches appear whenever a
// user goes back to an older version and works forward again. This module owns
// the two pure decisions behind that view and stays dependency-free so it can be
// unit tested directly:
//
// 1. Lane layout. Sequential work stays on the lane it inherited; a version that
//    branches off a version which is no longer a lane tip opens a new lane and
//    records one fork edge. Lanes are never recycled, so an edge can only ever
//    move outward and rendered connectors do not cross.
// 2. Entry title. Version manifests carry no AI-authored change summary (the
//    completion and candidate protocols have no summary field), so the only
//    stable, meaningful label is what the user themselves asked for that round.

export type VersionLineageInput = Readonly<{
  id: string;
  ordinal: number;
  basedOnVersionId?: string | null;
  previousVersionId?: string | null;
}>;

export type VersionGraphRow = Readonly<{
  versionId: string;
  ordinal: number;
  lane: number;
  row: number;
}>;

export type VersionGraphEdge = Readonly<{
  fromVersionId: string;
  toVersionId: string;
  fromLane: number;
  toLane: number;
  fromRow: number;
  toRow: number;
}>;

// A run of sequential work drawn as one straight line down a single lane.
export type VersionGraphSegment = Readonly<{
  lane: number;
  fromRow: number;
  toRow: number;
}>;

export type VersionGraphLayout = Readonly<{
  rows: ReadonlyArray<VersionGraphRow>;
  segments: ReadonlyArray<VersionGraphSegment>;
  edges: ReadonlyArray<VersionGraphEdge>;
  laneCount: number;
}>;

// The version a given version was modified from. `basedOnVersionId` is the
// authoritative lineage pointer; `previousVersionId` only orders official
// versions and is the fallback for records that predate the based-on field.
function lineageParent(version: VersionLineageInput): string | null {
  return version.basedOnVersionId || version.previousVersionId || null;
}

export function versionGraphLayout(
  versions: ReadonlyArray<VersionLineageInput>,
): VersionGraphLayout {
  // Oldest first: a tree reads downward from the import, and a fork must be
  // drawn after the version it forked from.
  const ordered = [...versions].sort((a, b) => a.ordinal - b.ordinal);
  const rowOf = new Map<string, number>();
  const laneOf = new Map<string, number>();
  const laneTip = new Map<number, string>();
  const rows: VersionGraphRow[] = [];
  const segments: VersionGraphSegment[] = [];
  const edges: VersionGraphEdge[] = [];
  let laneCount = 0;

  ordered.forEach((version, row) => {
    const parent = lineageParent(version);
    let lane: number | null = null;
    if (parent) {
      for (const [candidate, tip] of laneTip) {
        if (tip === parent) {
          lane = candidate;
          break;
        }
      }
    }
    if (lane === null) {
      // Continuing the parent's lane is impossible, so this version starts its
      // own lane. Lanes are never reused, which keeps connectors untangled.
      lane = 0;
      while (laneTip.has(lane)) lane += 1;
      const parentLane = parent === null ? undefined : laneOf.get(parent);
      const parentRow = parent === null ? undefined : rowOf.get(parent);
      if (parentLane !== undefined && parentRow !== undefined) {
        edges.push(Object.freeze({
          fromVersionId: parent as string,
          toVersionId: version.id,
          fromLane: parentLane,
          toLane: lane,
          fromRow: parentRow,
          toRow: row,
        }));
      }
    } else {
      const parentRow = rowOf.get(parent as string);
      if (parentRow !== undefined) {
        segments.push(Object.freeze({ lane, fromRow: parentRow, toRow: row }));
      }
    }
    laneTip.set(lane, version.id);
    laneOf.set(version.id, lane);
    rowOf.set(version.id, row);
    laneCount = Math.max(laneCount, lane + 1);
    rows.push(Object.freeze({
      versionId: version.id,
      ordinal: version.ordinal,
      lane,
      row,
    }));
  });

  return Object.freeze({
    rows: Object.freeze(rows),
    segments: Object.freeze(segments),
    edges: Object.freeze(edges),
    laneCount,
  });
}

export type VersionTitleComment = Readonly<{
  label: string;
  text: string;
}>;

export type VersionTitleInput = Readonly<{
  isInitial: boolean;
  comments: ReadonlyArray<VersionTitleComment>;
  directEditCount: number;
  // The round's requirement, joined from the user's own comment texts when the
  // request was frozen. This is what names a version on current projects, whose
  // version records do not carry the comments themselves.
  requirement?: string | null;
  // Set when this version restarted work from an older version rather than
  // continuing the previous one, so a branch is still legible when the round's
  // requirement text is not in the payload.
  branchedFromOrdinal?: number | null;
}>;

const TITLE_LENGTH_LIMIT = 80;

function condense(value: string): string {
  const collapsed = value.replace(/\s+/gu, " ").trim();
  return collapsed.length > TITLE_LENGTH_LIMIT
    ? `${collapsed.slice(0, TITLE_LENGTH_LIMIT)}…`
    : collapsed;
}

// What the user asked for that round, in their own words. Version manifests
// have no dependable AI-authored summary and every managed file in a project
// shares one name, so neither can title a version. When the round's requirement
// is not in the payload the title stays empty on purpose: the row still carries
// its V-number and time, which reads as intentional, whereas a filler label
// would repeat identically on every row and say nothing.
export function versionEntryTitle(input: VersionTitleInput): string {
  if (input.isInitial) return "原始导入";
  const [first] = input.comments;
  if (first) {
    const text = condense(first.text);
    const label = condense(first.label);
    const head = text && label ? `${label}：${text}` : text || label;
    if (head) {
      return input.comments.length > 1
        ? `${head} 等 ${input.comments.length} 条`
        : head;
    }
  }
  if (input.requirement) {
    const requirement = condense(input.requirement);
    if (requirement) return requirement;
  }
  if (input.directEditCount > 0) {
    return `本地编辑 · ${input.directEditCount} 处`;
  }
  if (input.branchedFromOrdinal) {
    return `从 V${input.branchedFromOrdinal} 分出`;
  }
  return "";
}
