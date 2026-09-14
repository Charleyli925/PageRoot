import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { parse } from "acorn";

const JAVASCRIPT_RUNTIME_EXTENSIONS = new Set([".cjs", ".js", ".mjs"]);
const RUNTIME_PROVIDED_MODULES = new Set(["electron"]);
const BUILTIN_MODULES = new Set(
  builtinModules.flatMap((moduleName) => [moduleName, `node:${moduleName}`]),
);

function runtimeResourcePath(value, {
  platform = process.platform,
  arch = process.arch,
} = {}) {
  return String(value || "")
    .replaceAll("${platform}", platform)
    .replaceAll("${arch}", arch);
}

export function managedRuntimeModules(packageJson, options) {
  const modules = new Set();
  for (const resource of packageJson?.build?.extraResources || []) {
    const from = runtimeResourcePath(resource?.from, options);
    const to = runtimeResourcePath(resource?.to, options);
    if (!from || to !== from) continue;
    const match = from.match(/^node_modules\/((?:@[^/]+\/)?[^/]+)$/u);
    if (match) modules.add(match[1]);
  }
  return modules;
}

function isJavaScriptRuntimeFile(filePath) {
  return JAVASCRIPT_RUNTIME_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function collectJavaScriptRuntimeFiles(root, destination) {
  const information = lstatSync(root);
  if (information.isSymbolicLink()) {
    throw new Error(`Packaged runtime source must not be a symbolic link: ${root}`);
  }
  if (information.isFile()) {
    if (isJavaScriptRuntimeFile(root)) destination.add(root);
    return;
  }
  if (!information.isDirectory()) return;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    collectJavaScriptRuntimeFiles(path.join(root, entry.name), destination);
  }
}

export function packagedRuntimeSourceFiles(root, packageJson) {
  const files = new Set();
  for (const entry of packageJson?.build?.files || []) {
    if (
      typeof entry !== "string"
      || entry.startsWith("!")
      || /[?*{}[\]]/u.test(entry)
      || !isJavaScriptRuntimeFile(entry)
    ) continue;
    const absolute = path.resolve(root, entry);
    if (!existsSync(absolute)) {
      throw new Error(`Packaged application source is missing: ${entry}`);
    }
    collectJavaScriptRuntimeFiles(absolute, files);
  }
  for (const resource of packageJson?.build?.extraResources || []) {
    const source = runtimeResourcePath(resource?.from);
    if (!source || source.startsWith("node_modules/")) continue;
    const absolute = path.resolve(root, source);
    if (!existsSync(absolute)) continue;
    collectJavaScriptRuntimeFiles(absolute, files);
  }
  return Object.freeze(
    [...files]
      .map((absolute) => path.relative(root, absolute).replaceAll(path.sep, "/"))
      .sort(),
  );
}

function staticString(node) {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (
    node?.type === "TemplateLiteral"
    && node.expressions?.length === 0
    && node.quasis?.length === 1
  ) return node.quasis[0].value.cooked;
  return null;
}

export function bareRuntimeModuleName(specifier) {
  if (
    typeof specifier !== "string"
    || specifier.length === 0
    || specifier.startsWith(".")
    || specifier.startsWith("/")
    || specifier.startsWith("#")
    || /^[a-z][a-z0-9+.-]*:/iu.test(specifier)
    || BUILTIN_MODULES.has(specifier)
  ) return null;
  if (specifier.startsWith("@")) {
    const [scope, name] = specifier.split("/");
    return scope && name ? `${scope}/${name}` : null;
  }
  return specifier.split("/")[0] || null;
}

export function importedRuntimeModules(source, { fileName = "runtime source" } = {}) {
  let program;
  try {
    program = parse(String(source), {
      allowHashBang: true,
      ecmaVersion: "latest",
      sourceType: "module",
    });
  } catch (cause) {
    throw new Error(`Unable to parse packaged ${fileName}: ${cause.message}`, { cause });
  }
  const specifiers = new Set();
  const pending = [program];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node || typeof node !== "object") continue;
    if (
      node.type === "ImportDeclaration"
      || node.type === "ExportAllDeclaration"
      || node.type === "ExportNamedDeclaration"
      || node.type === "ImportExpression"
    ) {
      const value = staticString(node.source);
      if (value) specifiers.add(value);
    } else if (
      node.type === "CallExpression"
      && node.callee?.type === "Identifier"
      && node.callee.name === "require"
    ) {
      const value = staticString(node.arguments?.[0]);
      if (value) specifiers.add(value);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) pending.push(...value);
      else if (value && typeof value === "object") pending.push(value);
    }
  }
  return Object.freeze(
    [...new Set(
      [...specifiers]
        .map(bareRuntimeModuleName)
        .filter((moduleName) => moduleName && !RUNTIME_PROVIDED_MODULES.has(moduleName)),
    )].sort(),
  );
}

export function requiredRuntimeModuleClosure(directModules, packageLock) {
  const required = new Set();
  const missingPackages = new Set();
  const pending = [...directModules];
  while (pending.length > 0) {
    const moduleName = pending.pop();
    if (required.has(moduleName)) continue;
    required.add(moduleName);
    const packagePath = `node_modules/${moduleName}`;
    const lockedPackage = packageLock?.packages?.[packagePath];
    if (!lockedPackage) {
      missingPackages.add(packagePath);
      continue;
    }
    const dependencies = new Set(Object.keys(lockedPackage.dependencies || {}));
    for (const peerName of Object.keys(lockedPackage.peerDependencies || {})) {
      if (lockedPackage.peerDependenciesMeta?.[peerName]?.optional !== true) {
        dependencies.add(peerName);
      }
    }
    for (const optionalName of Object.keys(lockedPackage.optionalDependencies || {})) {
      if (packageLock.packages[`node_modules/${optionalName}`]) dependencies.add(optionalName);
    }
    pending.push(...dependencies);
  }
  return Object.freeze({
    requiredModules: Object.freeze([...required].sort()),
    missingPackages: Object.freeze([...missingPackages].sort()),
  });
}

export function evaluatePackagedSourceRuntimeClosure(root, packageJson, packageLock) {
  const sourceFiles = packagedRuntimeSourceFiles(root, packageJson);
  const directModules = new Set();
  for (const relativePath of sourceFiles) {
    for (const moduleName of importedRuntimeModules(
      readFileSync(path.join(root, relativePath), "utf8"),
      { fileName: relativePath },
    )) directModules.add(moduleName);
  }
  const undeclaredDirectModules = [...directModules]
    .filter((moduleName) => !packageJson?.dependencies?.[moduleName])
    .sort();
  const required = requiredRuntimeModuleClosure(directModules, packageLock);
  const managed = managedRuntimeModules(packageJson);
  const missingResources = required.requiredModules
    .filter((moduleName) => !managed.has(moduleName));
  const unexpectedResources = [...managed]
    .filter((moduleName) => !required.requiredModules.includes(moduleName))
    .sort();
  return Object.freeze({
    sourceFiles,
    directModules: Object.freeze([...directModules].sort()),
    requiredModules: required.requiredModules,
    managedModules: Object.freeze([...managed].sort()),
    undeclaredDirectModules: Object.freeze(undeclaredDirectModules),
    missingPackages: required.missingPackages,
    missingResources: Object.freeze(missingResources),
    unexpectedResources: Object.freeze(unexpectedResources),
    passed: (
      undeclaredDirectModules.length === 0
      && required.missingPackages.length === 0
      && missingResources.length === 0
      && unexpectedResources.length === 0
    ),
  });
}
