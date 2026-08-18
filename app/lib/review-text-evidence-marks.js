/**
 * Frozen character-evidence marks for AI review.
 *
 * These decorations are overlay-only. Marker spans must keep authored color,
 * font size, weight, line-height and existing decorations. Do not restyle the
 * glyphs themselves with color, emphasis, underline or background.
 */

export const REVIEW_TEXT_EVIDENCE_REMOVED_COLOR = "#c74f4a";
export const REVIEW_TEXT_EVIDENCE_ADDED_COLOR = "#239b56";

export const REVIEW_TEXT_EVIDENCE_MARKER_CSS = `
  html[data-pageroot-review-filter="all"] [data-pageroot-review-text="removed"],
  html[data-pageroot-review-filter="text"] [data-pageroot-review-text="removed"],
  html[data-pageroot-review-filter="all"] [data-pageroot-review-text="added"],
  html[data-pageroot-review-filter="text"] [data-pageroot-review-text="added"] {
    background: transparent !important;
    color: inherit !important;
    font: inherit !important;
    font-size: inherit !important;
    font-weight: inherit !important;
    font-style: inherit !important;
    line-height: inherit !important;
    letter-spacing: inherit !important;
    word-spacing: inherit !important;
    text-decoration: none !important;
    -webkit-text-emphasis: none !important;
    text-emphasis: none !important;
  }
`;

const FORBIDDEN_MARKER_DECLARATIONS = [
  { property: "color", allow: /^inherit$/iu },
  { property: "font-size", allow: /^inherit$/iu },
  { property: "font-weight", allow: /^inherit$/iu },
  { property: "line-height", allow: /^inherit$/iu },
  { property: "background", allow: /^transparent$/iu },
  { property: "text-decoration", allow: /^none$/iu },
  { property: "text-decoration-line", allow: /^(?:none|inherit)$/iu },
  { property: "text-emphasis", allow: /^none$/iu },
  { property: "text-emphasis-style", allow: /^none$/iu },
  { property: "-webkit-text-emphasis", allow: /^none$/iu },
  { property: "-webkit-text-emphasis-style", allow: /^none$/iu },
];

function parseDeclarations(block) {
  return block.split(";").map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    const separator = entry.indexOf(":");
    if (separator < 0) return null;
    return {
      property: entry.slice(0, separator).trim().toLowerCase(),
      value: entry.slice(separator + 1).replace(/!important/iu, "").trim(),
    };
  }).filter(Boolean);
}

export function reviewTextEvidenceMarkerBlocks(css) {
  const source = String(css || "");
  const blocks = [];
  const pattern = /((?:[^{}]*\[data-pageroot-review-text="(?:added|removed)"\][^{}]*)+)\{([^}]+)\}/gu;
  let match = pattern.exec(source);
  while (match) {
    const tones = [...match[1].matchAll(/\[data-pageroot-review-text="(added|removed)"\]/gu)]
      .map((item) => item[1]);
    const declarations = parseDeclarations(match[2]);
    [...new Set(tones)].forEach((tone) => {
      blocks.push({ tone, declarations });
    });
    match = pattern.exec(source);
  }
  return blocks;
}

export function reviewTextEvidenceStyleViolations(css) {
  const violations = [];
  const blocks = reviewTextEvidenceMarkerBlocks(css);
  if (!blocks.some((block) => block.tone === "added")
    || !blocks.some((block) => block.tone === "removed")) {
    violations.push("missing added or removed character-evidence rule");
  }
  blocks.forEach((block) => {
    FORBIDDEN_MARKER_DECLARATIONS.forEach((rule) => {
      block.declarations
        .filter((declaration) => declaration.property === rule.property)
        .forEach((declaration) => {
          if (!rule.allow.test(declaration.value)) {
            violations.push(
              block.tone + " " + rule.property + " must stay " + String(rule.allow)
                + ", got " + declaration.value,
            );
          }
        });
    });
    const color = block.declarations.find((declaration) => declaration.property === "color");
    if (!color || color.value.toLowerCase() !== "inherit") {
      violations.push(block.tone + " must set color: inherit");
    }
    const emphasis = block.declarations.find((declaration) => (
      declaration.property === "text-emphasis"
      || declaration.property === "text-emphasis-style"
      || declaration.property === "-webkit-text-emphasis"
      || declaration.property === "-webkit-text-emphasis-style"
    ));
    if (!emphasis || emphasis.value.toLowerCase() !== "none") {
      violations.push(block.tone + " must disable text-emphasis");
    }
  });
  return violations;
}

export function reviewTextEvidenceGraphemeEnd(value, start) {
  const source = String(value || "");
  const index = Math.max(0, Math.trunc(Number(start) || 0));
  if (index >= source.length) return source.length;
  const code = source.charCodeAt(index);
  if (code >= 0xd800 && code <= 0xdbff && index + 1 < source.length) {
    const extra = source.charCodeAt(index + 1);
    if (extra >= 0xdc00 && extra <= 0xdfff) return index + 2;
  }
  return index + 1;
}

export function reviewTextEvidenceIsWhitespaceCode(code) {
  return code === 0x0009
    || (code >= 0x000a && code <= 0x000d)
    || code === 0x0020
    || code === 0x00a0
    || code === 0x1680
    || (code >= 0x2000 && code <= 0x200a)
    || code === 0x2028
    || code === 0x2029
    || code === 0x202f
    || code === 0x205f
    || code === 0x3000
    || code === 0xfeff;
}

export function reviewTextEvidenceUnits(value) {
  const source = String(value || "");
  const units = [];
  let index = 0;
  while (index < source.length) {
    const end = reviewTextEvidenceGraphemeEnd(source, index);
    if (!reviewTextEvidenceIsWhitespaceCode(source.charCodeAt(index))) {
      units.push({ start: index, end });
    }
    index = end;
  }
  return units;
}

export function reviewTextEvidenceMarkGeometry(rect, fontSize, scale) {
  const left = Number(rect?.left) || 0;
  const top = Number(rect?.top) || 0;
  const right = Number(rect?.right) || 0;
  const bottom = Number(rect?.bottom) || 0;
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  const em = Number.isFinite(fontSize) && fontSize > 0 ? fontSize : Math.max(8, height * 0.8);
  const uiScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const extra = Math.max(0, height - em);
  const glyphTop = top + extra / 2;
  const glyphBottom = glyphTop + em;
  const strikeThickness = Math.max(1.15, em * 0.08) * uiScale;
  const dash = Math.max(2, em * 0.16) * uiScale;
  const gap = Math.max(1.35, em * 0.11) * uiScale;
  const inset = Math.min(width * 0.08, Math.max(0.4, em * 0.04));
  const dotRadius = Math.max(1.4, em * 0.09) * uiScale;
  const dotGap = Math.max(0.7, em * 0.04) * uiScale;
  const dotY = glyphBottom + dotGap + dotRadius;
  return {
    centerX: (left + right) / 2,
    glyphTop,
    glyphBottom,
    strikeY: glyphTop + em * 0.52,
    strikeLeft: left + inset,
    strikeRight: Math.max(left + inset, right - inset),
    strikeThickness,
    dash,
    gap,
    dotX: (left + right) / 2,
    dotY,
    dotRadius,
    addedClearance: Math.max(0, (dotY + dotRadius) - bottom),
  };
}
