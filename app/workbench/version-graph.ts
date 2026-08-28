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
  // Build a real pre-order tree rather than sorting every Version globally.
  // This keeps a parent's complete subtree together: when V4 is a second child
  // of V2, it is rendered after V2's V3/V5/... branch instead of being pulled
  // upward merely because its ordinal is smaller than a later descendant.
  const byId = new Map(versions.map((version) => [version.id, version]));
  const children = new Map<string, VersionLineageInput[]>();
  const roots: VersionLineageInput[] = [];
  for (const version of versions) {
    const parent = lineageParent(version);
    if (parent && byId.has(parent)) {
      const siblings = children.get(parent) || [];
      siblings.push(version);
      children.set(parent, siblings);
    } else {
      roots.push(version);
    }
  }
  const sortByOrdinal = (left: VersionLineageInput, right: VersionLineageInput) => (
    left.ordinal - right.ordinal || left.id.localeCompare(right.id)
  );
  roots.sort(sortByOrdinal);
  for (const siblings of children.values()) siblings.sort(sortByOrdinal);
  const ordered: VersionLineageInput[] = [];
  const visited = new Set<string>();
  const visit = (version: VersionLineageInput) => {
    if (visited.has(version.id)) return;
    visited.add(version.id);
    ordered.push(version);
    for (const child of children.get(version.id) || []) visit(child);
  };
  for (const root of roots) visit(root);
  // Malformed or forward-compatible records with a cycle/duplicate parent do
  // not disappear from the read-only view. Keep their deterministic ordinal
  // order, but never invent a connector for an unseen parent.
  [...versions].sort(sortByOrdinal).forEach((version) => visit(version));

  const rowOf = new Map<string, number>();
  const laneOf = new Map<string, number>();
  const rows: VersionGraphRow[] = [];
  const segments: VersionGraphSegment[] = [];
  const edges: VersionGraphEdge[] = [];
  let nextLane = 0;

  // A first child continues its parent's vertical rail. Every additional
  // child gets a new rail immediately to the right. Pre-order traversal means
  // each branch is completely drawn before its sibling's elbow, so rails and
  // elbows never cross.
  const append = (version: VersionLineageInput, lane: number) => {
    const row = rows.length;
    const parent = lineageParent(version);
    const parentRow = parent === null ? undefined : rowOf.get(parent);
    const parentLane = parent === null ? undefined : laneOf.get(parent);
    if (parentRow !== undefined && parentLane !== undefined) {
      if (lane === parentLane) {
        segments.push(Object.freeze({ lane, fromRow: parentRow, toRow: row }));
      } else {
        edges.push(Object.freeze({
          fromVersionId: parent as string,
          toVersionId: version.id,
          fromLane: parentLane,
          toLane: lane,
          fromRow: parentRow,
          toRow: row,
        }));
      }
    }
    laneOf.set(version.id, lane);
    rowOf.set(version.id, row);
    rows.push(Object.freeze({
      versionId: version.id,
      ordinal: version.ordinal,
      lane,
      row,
    }));
    const descendants = children.get(version.id) || [];
    descendants.forEach((child, index) => {
      const childLane = index === 0 ? lane : nextLane++;
      append(child, childLane);
    });
  };

  for (const root of roots) append(root, nextLane++);
  // `ordered` contains any records not reachable from a root. Render them as
  // separate roots to keep the layout total without claiming a parent link.
  for (const version of ordered) {
    if (rowOf.has(version.id)) continue;
    append(version, nextLane++);
  }

  return Object.freeze({
    rows: Object.freeze(rows),
    segments: Object.freeze(segments),
    edges: Object.freeze(edges),
    laneCount: nextLane,
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
