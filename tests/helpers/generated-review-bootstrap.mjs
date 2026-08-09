import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

import ts from "typescript";

const reviewDocument = await readFile(
  new URL("../../app/workbench/review-document.ts", import.meta.url),
  "utf8",
);

export function generatedReviewBootstrap(reviewCommentBindings = []) {
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
    RUNTIME_VISUAL_CONTRACT_VERSION: 1,
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
    REVIEW_RUNTIME_VISUAL_CANDIDATE_LIMIT: 128,
    REVIEW_RUNTIME_VISUAL_SOURCE_BOX_ATTRIBUTES: [
      "class",
      "height",
      "hidden",
      "style",
      "width",
    ],
  });
  new vm.Script(transpiled).runInContext(context);
  return context.reviewBootstrap(
    "review-session",
    "before",
    `sha256:${"a".repeat(64)}`,
    reviewCommentBindings,
  );
}
