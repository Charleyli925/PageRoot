// Architecture gate AST queries.
//
// ARCHITECTURE_CONTRACT.md reserves source-string tests for packaging,
// dependency and security boundaries. Runtime coordination must be proven
// through structure and behavior instead. These helpers give the architecture
// gate structural queries that survive renames, reflows, comments and
// formatting, so a semantically equivalent refactor cannot fail the gate and a
// dead string cannot pass it.

import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

function scriptKindFor(filePath) {
  switch (path.extname(filePath)) {
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".ts":
      return ts.ScriptKind.TS;
    case ".jsx":
      return ts.ScriptKind.JSX;
    default:
      return ts.ScriptKind.JS;
  }
}

// Parses one module into a reusable handle. Callers keep the handle so a file
// is read and parsed once per gate run.
export async function loadModule(filePath) {
  const text = await readFile(filePath, "utf8");
  return parseModule(filePath, text);
}

export function parseModule(filePath, text) {
  const sourceFile = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(filePath),
  );
  return { filePath, text, sourceFile };
}

function visit(node, callback) {
  callback(node);
  node.forEachChild((child) => visit(child, callback));
}

function eachNode(handle, callback) {
  visit(handle.sourceFile, callback);
}

function memberName(node) {
  const name = node.name;
  if (!name) {
    return null;
  }
  if (ts.isPrivateIdentifier(name)) {
    // PrivateIdentifier text already carries the leading '#'.
    return name.text;
  }
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
    return name.text;
  }
  return null;
}

// Renders a callee or reference into a normalized dotted path such as
// "this.#projectSession.register" or "bridgeClient.projectFile". Returns null
// for expressions that do not form a static path (computed access, calls in the
// middle of the chain, and similar dynamic shapes).
function expressionPath(node) {
  if (ts.isIdentifier(node)) {
    return node.text;
  }
  if (ts.isPrivateIdentifier(node)) {
    return node.text;
  }
  if (node.kind === ts.SyntaxKind.ThisKeyword) {
    return "this";
  }
  if (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node)) {
    return expressionPath(node.expression);
  }
  if (ts.isPropertyAccessExpression(node)) {
    const left = expressionPath(node.expression);
    if (left === null) {
      return null;
    }
    const right = ts.isPrivateIdentifier(node.name)
      ? node.name.text
      : node.name.text;
    return `${left}.${right}`;
  }
  return null;
}

function findClass(handle, className) {
  let found = null;
  eachNode(handle, (node) => {
    if (found) {
      return;
    }
    if (
      (ts.isClassDeclaration(node) || ts.isClassExpression(node))
      && node.name?.text === className
    ) {
      found = node;
    }
  });
  return found;
}

function hasExportModifier(node) {
  return Boolean(
    node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
  );
}

// Dependency boundary: the module imports the given specifier. Also matches
// export-from and dynamic import() with a literal specifier.
export function importsModule(handle, specifier) {
  let found = false;
  eachNode(handle, (node) => {
    if (found) {
      return;
    }
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier)
      && node.moduleSpecifier.text === specifier
    ) {
      found = true;
      return;
    }
    if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length > 0
      && ts.isStringLiteral(node.arguments[0])
      && node.arguments[0].text === specifier
    ) {
      found = true;
    }
  });
  return found;
}

// Export contract: the module exports `name`. `kind` narrows the declaration
// form to "class", "function" or "variable" when the contract depends on it.
export function exportsSymbol(handle, name, { kind = null } = {}) {
  let found = false;
  eachNode(handle, (node) => {
    if (found) {
      return;
    }
    if (ts.isClassDeclaration(node) && node.name?.text === name) {
      if ((kind === null || kind === "class") && hasExportModifier(node)) {
        found = true;
      }
      return;
    }
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      if ((kind === null || kind === "function") && hasExportModifier(node)) {
        found = true;
      }
      return;
    }
    if (ts.isVariableStatement(node) && hasExportModifier(node)) {
      if (kind !== null && kind !== "variable") {
        return;
      }
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === name) {
          found = true;
          return;
        }
      }
      return;
    }
    // export { name } / export { local as name }
    if (ts.isExportDeclaration(node) && node.exportClause
      && ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) {
        if (element.name.text === name) {
          found = true;
          return;
        }
      }
    }
  });
  return found;
}

// Structure: the class declares `member`, which may be a private field such as
// "#registrationPromise", a method, or an accessor.
export function classHasMember(handle, className, member) {
  const declaration = findClass(handle, className);
  if (!declaration) {
    return false;
  }
  return declaration.members.some((node) => memberName(node) === member);
}

// Structure: the class member is initialized by constructing `constructorName`,
// for example `#drainCoordinator = new DrainCoordinator()`.
export function classMemberConstructs(handle, className, member, constructorName) {
  const declaration = findClass(handle, className);
  if (!declaration) {
    return false;
  }
  return declaration.members.some((node) => {
    if (memberName(node) !== member || !ts.isPropertyDeclaration(node)) {
      return false;
    }
    const initializer = node.initializer;
    return Boolean(
      initializer
      && ts.isNewExpression(initializer)
      && expressionPath(initializer.expression) === constructorName,
    );
  });
}

function callMatches(node, { callPath, method }) {
  const callee = node.expression;
  if (callPath !== null) {
    return expressionPath(callee) === callPath;
  }
  // Receiver-agnostic match: the call ends in `.method(...)`.
  if (ts.isPropertyAccessExpression(callee)) {
    const name = ts.isPrivateIdentifier(callee.name)
      ? callee.name.text
      : callee.name.text;
    return name === method;
  }
  if (ts.isIdentifier(callee)) {
    return callee.text === method;
  }
  return false;
}

function scopeNode(handle, { withinClass, withinMember }) {
  if (!withinClass) {
    return handle.sourceFile;
  }
  const declaration = findClass(handle, withinClass);
  if (!declaration) {
    return null;
  }
  if (!withinMember) {
    return declaration;
  }
  return declaration.members.find((node) => memberName(node) === withinMember) ?? null;
}

// Coordination: a call to `path` (exact dotted callee) or `method` (any
// receiver) exists, optionally restricted to one class or class member.
export function hasCall(handle, { path: callPath = null, method = null, withinClass = null, withinMember = null } = {}) {
  if (callPath === null && method === null) {
    throw new Error("hasCall requires either a path or a method.");
  }
  const scope = scopeNode(handle, { withinClass, withinMember });
  if (!scope) {
    return false;
  }
  let found = false;
  visit(scope, (node) => {
    if (found) {
      return;
    }
    if (ts.isCallExpression(node) && callMatches(node, { callPath, method })) {
      found = true;
    }
  });
  return found;
}

// Coordination: the module constructs `className` somewhere.
export function constructsClass(handle, className) {
  let found = false;
  eachNode(handle, (node) => {
    if (found) {
      return;
    }
    if (ts.isNewExpression(node) && expressionPath(node.expression) === className) {
      found = true;
    }
  });
  return found;
}

// Shape: an object literal declares property `name`. `valueKind` may be
// "object", "function" or "identifier" when the contract depends on the value
// form rather than only the key.
export function hasObjectProperty(handle, name, { valueKind = null } = {}) {
  let found = false;
  eachNode(handle, (node) => {
    if (found || !ts.isObjectLiteralExpression(node)) {
      return;
    }
    for (const property of node.properties) {
      if (memberName(property) !== name) {
        continue;
      }
      if (valueKind === null) {
        found = true;
        return;
      }
      if (ts.isShorthandPropertyAssignment(property)) {
        if (valueKind === "identifier") {
          found = true;
          return;
        }
        continue;
      }
      if (ts.isMethodDeclaration(property)) {
        if (valueKind === "function") {
          found = true;
          return;
        }
        continue;
      }
      if (!ts.isPropertyAssignment(property)) {
        continue;
      }
      const value = property.initializer;
      if (valueKind === "object" && ts.isObjectLiteralExpression(value)) {
        found = true;
        return;
      }
      if (
        valueKind === "function"
        && (ts.isArrowFunction(value) || ts.isFunctionExpression(value))
      ) {
        found = true;
        return;
      }
      if (valueKind === "identifier" && ts.isIdentifier(value)) {
        found = true;
        return;
      }
    }
  });
  return found;
}

// Counts calls to `method` regardless of receiver. Used for budget metrics such
// as React hook density.
export function countCalls(handle, method) {
  let total = 0;
  eachNode(handle, (node) => {
    if (ts.isCallExpression(node) && callMatches(node, { callPath: null, method })) {
      total += 1;
    }
  });
  return total;
}
