import { readFile } from "node:fs/promises";
import ts from "typescript";

// Execute the production TypeScript models, retaining their real dependency
// graph instead of duplicating decoders in test fixtures.
const modules = new Map();
async function moduleUrl(url) {
  if (!url.pathname.endsWith(".ts")) return url.href;
  if (modules.has(url.href)) return modules.get(url.href);
  const pending = (async () => {
    const source = await readFile(url, "utf8");
    let output = ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
    }, fileName: url.pathname }).outputText;
    for (const match of [...output.matchAll(/from ["'](\.[^"']+)["']/gu)]) {
      const dependency = new URL(/\.[cm]?[jt]s$/u.test(match[1]) ? match[1] : `${match[1]}.ts`, url);
      output = output.replace(match[0], `from ${JSON.stringify(await moduleUrl(dependency))}`);
    }
    return `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
  })();
  modules.set(url.href, pending);
  return pending;
}
export async function loadWorkbenchModel(name) {
  return import(await moduleUrl(new URL(`../../app/workbench/${name}.ts`, import.meta.url)));
}
