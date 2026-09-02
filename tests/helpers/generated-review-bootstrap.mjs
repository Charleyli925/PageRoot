import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

import ts from "typescript";

import {
  alignReviewTextEvidenceDotRows,
  reviewTextEvidenceGraphemeEnd,
  reviewTextEvidenceIsPunctuationCode,
  reviewTextEvidenceMarkGeometry,
} from "../../app/lib/review-text-evidence-marks.js";
import {
  normalizeReviewExactAtomOccurrences,
  normalizeReviewFocusGroupPlans,
  REVIEW_PROJECTION_FACTS_SERIALIZED_LENGTH_LIMIT,
} from "../../app/lib/review-projection-facts.js";
import {
  aggregateReviewBadgeLabels,
  reviewBadgeFactCount,
  reviewBadgeLabelText,
} from "../../app/lib/review-badge-aggregation.js";
import {
  reviewRegionAnnotations,
} from "../../app/lib/review-region-annotation.js";
import { OPAQUE_SANDBOX_STORAGE_BOOTSTRAP } from "../../app/lib/opaque-sandbox-storage.js";

const reviewRuntimeProjection = await readFile(
  new URL("../../app/workbench/review/runtime-projection.ts", import.meta.url),
  "utf8",
);

export function generatedReviewBootstrap(
  reviewCommentBindings = [],
  side = "before",
  reviewVisualStableIds = [],
  reviewFocusGroupPlans = [],
  reviewExactAtomOccurrences = [],
) {
  const sourceFile = ts.createSourceFile(
    "runtime-projection.ts",
    reviewRuntimeProjection,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const declaration = sourceFile.statements.find((node) => (
    ts.isFunctionDeclaration(node)
    && node.name?.text === "reviewBootstrap"
  ));
  assert.ok(declaration, "reviewBootstrap declaration must exist");
  const transpiled = ts.transpileModule(
    reviewRuntimeProjection.slice(declaration.getStart(sourceFile), declaration.end),
    {
      compilerOptions: {
        module: ts.ModuleKind.None,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const context = vm.createContext({
    REVIEW_BOOTSTRAP_IDENTITY_ATTRIBUTE_LIMIT: 24,
    REVIEW_PROJECTION_FACTS_SERIALIZED_LENGTH_LIMIT,
    normalizeReviewFocusGroupPlans,
    normalizeReviewExactAtomOccurrences,
    REVIEW_COMMENT_BINDING_SOURCE_BOX_ATTRIBUTES: [
      "class",
      "height",
      "hidden",
      "style",
      "width",
    ],
    reviewTextEvidenceGraphemeEnd,
    reviewTextEvidenceIsPunctuationCode,
    reviewTextEvidenceMarkGeometry,
    alignReviewTextEvidenceDotRows,
    reviewBadgeLabelText,
    reviewBadgeFactCount,
    aggregateReviewBadgeLabels,
    reviewRegionAnnotations,
    OPAQUE_SANDBOX_STORAGE_BOOTSTRAP,
  });
  // The bootstrap receives its helpers as `${fn.toString()}` injections, so a
  // new injection that is not also provided here fails deep inside the vm with a
  // bare ReferenceError. Compare the two lists up front and name the gap.
  const injected = [...reviewRuntimeProjection.matchAll(
    /^\s*const (\w+) = \$\{\1\.toString\(\)\};$/gmu,
  )].map((match) => match[1]);
  const missing = injected.filter((name) => !(name in context));
  assert.deepEqual(
    missing,
    [],
    `runtime-projection.ts injects ${missing.join(", ")} into the bootstrap; add it to this harness context too`,
  );
  assert.ok(injected.length > 0, "expected to find toString() injections to verify");
  new vm.Script(transpiled).runInContext(context);
  const bootstrap = context.reviewBootstrap(
    "review-session",
    side,
    reviewCommentBindings,
    reviewVisualStableIds,
    reviewFocusGroupPlans,
    reviewExactAtomOccurrences,
  );
  new vm.Script(bootstrap);
  return bootstrap;
}
