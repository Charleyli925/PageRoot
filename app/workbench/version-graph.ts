// Pure Version entry titles; lineage fields remain available for details.

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
