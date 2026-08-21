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
  aggregateReviewBadgeLabels,
  reviewBadgeFactCount,
  reviewBadgeLabelText,
} from "../../app/lib/review-badge-aggregation.js";
import {
  reviewRegionAnnotations,
} from "../../app/lib/review-region-annotation.js";

const reviewDocument = await readFile(
  new URL("../../app/workbench/review-document.ts", import.meta.url),
  "utf8",
);

export function generatedReviewBootstrap(
  reviewCommentBindings = [],
  runtimeProjectionBindings = [],
  side = "before",
) {
  const sourceFile = ts.createSourceFile(
    "review-document.ts",
    reviewDocument,
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
    reviewDocument.slice(declaration.getStart(sourceFile), declaration.end),
    {
      compilerOptions: {
        module: ts.ModuleKind.None,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const context = vm.createContext({
    RUNTIME_VISUAL_CONTRACT_VERSION: 2,
    RUNTIME_VISUAL_CONTRACT: {
      identityAttributeLimit: 24,
      pageBudget: {
        hostAtoms: 4_096,
        atoms: 8_192,
        nodes: 8_192,
        canvasPixels: 4_194_304,
        hostValueLength: 200_000,
        valueLength: 400_000,
      },
    },
    REVIEW_PROJECTION_FACTS_PER_ELEMENT_LIMIT: 24,
    REVIEW_RUNTIME_VISUAL_CANDIDATE_LIMIT: 128,
    REVIEW_RUNTIME_VISUAL_SOURCE_BOX_ATTRIBUTES: [
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
  });
  // The bootstrap receives its helpers as `${fn.toString()}` injections, so a
  // new injection that is not also provided here fails deep inside the vm with a
  // bare ReferenceError. Compare the two lists up front and name the gap.
  const injected = [...reviewDocument.matchAll(
    /^\s*const (\w+) = \$\{\1\.toString\(\)\};$/gmu,
  )].map((match) => match[1]);
  const missing = injected.filter((name) => !(name in context));
  assert.deepEqual(
    missing,
    [],
    `review-document.ts injects ${missing.join(", ")} into the bootstrap; add it to this harness context too`,
  );
  assert.ok(injected.length > 0, "expected to find toString() injections to verify");
  new vm.Script(transpiled).runInContext(context);
  return context.reviewBootstrap(
    "review-session",
    side,
    `sha256:${"a".repeat(64)}`,
    reviewCommentBindings,
    runtimeProjectionBindings,
  );
}
