import { agentProviderError } from "../providers/agent-provider-contract.mjs";

function frozenNpmPackage({
  packageName,
  version,
  integrity,
  tarballUrl,
  nodeModulesPath,
  platform = null,
  arch = null,
}) {
  return Object.freeze({
    packageName,
    version,
    integrity,
    tarballUrl,
    nodeModulesPath: nodeModulesPath || packageName,
    ...(platform ? { platform } : {}),
    ...(arch ? { arch } : {}),
  });
}

export const QODER_MANAGED_RELEASE = Object.freeze({
  providerId: "qoder",
  runtimeId: "acp",
  displayName: "Qoder",
  securityProfile: "client-mediated",
  installable: true,
  distribution: Object.freeze({
    type: "npm",
    packageName: "@qoder-ai/qodercli",
    minVersion: "1.1.27",
    executableRelativePath: "package/bundle/qodercli.js",
    managedRelease: Object.freeze({
      version: "1.1.27",
      integrity: "sha512-3rWp/L831HRqVhWWiWPXL+VZr7PYjH8aFnVWhHJI6G7Yp8s97zfGlyNCUJd0OIO/LJIo9gb4gFy4eLShRQcZtA==",
      tarballUrl: "https://registry.npmjs.org/@qoder-ai/qodercli/-/qodercli-1.1.27.tgz",
    }),
    closure: Object.freeze([]),
  }),
});

const CODEX_ACP_CLOSURE = Object.freeze([
  frozenNpmPackage({
    packageName: "@openai/codex",
    version: "0.148.0",
    integrity: "sha512-bh5kH9+BMrFaHGmLeoSansPdfRksvr4UXzjQInns/KRO7r8VJ+6AAW+SqUsE8XcG3+OW/mI4EEy8Gpo9UDXGvQ==",
    tarballUrl: "https://registry.npmjs.org/@openai/codex/-/codex-0.148.0.tgz",
    nodeModulesPath: "@openai/codex",
  }),
  frozenNpmPackage({
    packageName: "@openai/codex",
    version: "0.148.0-darwin-arm64",
    integrity: "sha512-xgBPFiF1fHUlRS7HE6wGB56LjBJh16kGD7b4TTbwdVBZNB4QDkTok+vdkAGrfpVkfKcwGNhPSKDgCw+KMZOVug==",
    tarballUrl: "https://registry.npmjs.org/@openai/codex/-/codex-0.148.0-darwin-arm64.tgz",
    nodeModulesPath: "@openai/codex-darwin-arm64",
    platform: "darwin",
    arch: "arm64",
  }),
  frozenNpmPackage({
    packageName: "@openai/codex",
    version: "0.148.0-darwin-x64",
    integrity: "sha512-qepQolhJutfOp+e9i7L3xsi8aoWeCUiiRq274WMWqRj50rKTrXxsuAgkAwDbqEfT3G5VynhYZuQvDsW37JgdNQ==",
    tarballUrl: "https://registry.npmjs.org/@openai/codex/-/codex-0.148.0-darwin-x64.tgz",
    nodeModulesPath: "@openai/codex-darwin-x64",
    platform: "darwin",
    arch: "x64",
  }),
  frozenNpmPackage({
    packageName: "@openai/codex",
    version: "0.148.0-linux-arm64",
    integrity: "sha512-51DCd+izzk6n4mMh4w2utWj3lTLhSTnCOEJQfRh0LS9nBDkcYZcK3iSKOST6fByRIlLSXuLO33LlYYA1VPot6A==",
    tarballUrl: "https://registry.npmjs.org/@openai/codex/-/codex-0.148.0-linux-arm64.tgz",
    nodeModulesPath: "@openai/codex-linux-arm64",
    platform: "linux",
    arch: "arm64",
  }),
  frozenNpmPackage({
    packageName: "@openai/codex",
    version: "0.148.0-linux-x64",
    integrity: "sha512-uDT9s7AfMr9xLuJX3ZLVWHgHkUpCnZ33CZjZEdVQhrYCIErkDHsCW5TG290nNjaKngK0WxGt5uCcxeUHv9MWWA==",
    tarballUrl: "https://registry.npmjs.org/@openai/codex/-/codex-0.148.0-linux-x64.tgz",
    nodeModulesPath: "@openai/codex-linux-x64",
    platform: "linux",
    arch: "x64",
  }),
  frozenNpmPackage({
    packageName: "@openai/codex",
    version: "0.148.0-win32-arm64",
    integrity: "sha512-a8iOwLzs8UdnlWDHjgK3W/YSBBsUImG8X5XLBjengp3XGJRruhiIsQtUDUOYimCmotKPM4aX7Ub6zjl/KPxMQQ==",
    tarballUrl: "https://registry.npmjs.org/@openai/codex/-/codex-0.148.0-win32-arm64.tgz",
    nodeModulesPath: "@openai/codex-win32-arm64",
    platform: "win32",
    arch: "arm64",
  }),
  frozenNpmPackage({
    packageName: "@openai/codex",
    version: "0.148.0-win32-x64",
    integrity: "sha512-/Jg8eYw0BqTGNUpnrzzWlK2kbu29NWg7t6pnUDEfxqpTUf+mK8r3okXQn60Zjbk9InYZ4d8SwSjrtOa+i5hSPw==",
    tarballUrl: "https://registry.npmjs.org/@openai/codex/-/codex-0.148.0-win32-x64.tgz",
    nodeModulesPath: "@openai/codex-win32-x64",
    platform: "win32",
    arch: "x64",
  }),
  frozenNpmPackage({
    packageName: "@agentclientprotocol/sdk",
    version: "1.4.0",
    integrity: "sha512-/eufudw+aFY1LKLolT6yFE6UMmYRl7fMJ/DEONSIyR6wI3slHWITBsANRGqXEY8FRzqUxwh7QEaGiZHcJPVThg==",
    tarballUrl: "https://registry.npmjs.org/@agentclientprotocol/sdk/-/sdk-1.4.0.tgz",
    nodeModulesPath: "@agentclientprotocol/sdk",
  }),
  frozenNpmPackage({
    packageName: "zod",
    version: "4.4.3",
    integrity: "sha512-ytENFjIJFl2UwYglde2jchW2Hwm4GJFLDiSXWdTrJQBIN9Fcyp7n4DhxJEiWNAJMV1/BqWfW/kkg71UDcHJyTQ==",
    tarballUrl: "https://registry.npmjs.org/zod/-/zod-4.4.3.tgz",
  }),
  frozenNpmPackage({
    packageName: "diff",
    version: "9.0.0",
    integrity: "sha512-svtcdpS8CgJyqAjEQIXdb3OjhFVVYjzGAPO8WGCmRbrml64SPw/jJD4GoE98aR7r25A0XcgrK3F02yw9R/vhQw==",
    tarballUrl: "https://registry.npmjs.org/diff/-/diff-9.0.0.tgz",
  }),
  frozenNpmPackage({
    packageName: "vscode-jsonrpc",
    version: "9.0.2",
    integrity: "sha512-SbQSV9yRemARxeXw6LU5sS6Zq0e9/DgCCX5yelH263ZQWukbTk8EF8fjTrr1dziasf4GwlJbvTwFnTrnQFWZXQ==",
    tarballUrl: "https://registry.npmjs.org/vscode-jsonrpc/-/vscode-jsonrpc-9.0.2.tgz",
  }),
  frozenNpmPackage({
    packageName: "open",
    version: "11.0.1",
    integrity: "sha512-NzwMUB6C1D0+Kd+9iMS/H4k+Ck3cTX6Ckyfr/gAGlmvSE1LUQZnEZvWBi4PYmMwH/S5SMeTXnE+9uAz8uF+pWw==",
    tarballUrl: "https://registry.npmjs.org/open/-/open-11.0.1.tgz",
  }),
  frozenNpmPackage({
    packageName: "is-in-ssh",
    version: "1.0.0",
    integrity: "sha512-jYa6Q9rH90kR1vKB6NM7qqd1mge3Fx4Dhw5TVlK1MUBqhEOuCagrEHMevNuCcbECmXZ0ThXkRm+Ymr51HwEPAw==",
    tarballUrl: "https://registry.npmjs.org/is-in-ssh/-/is-in-ssh-1.0.0.tgz",
  }),
  frozenNpmPackage({
    packageName: "wsl-utils",
    version: "1.0.0",
    integrity: "sha512-Hl0ZOAs672vg+06kfujwRhoS6/jehvULrlFkuF2dRu6pHgA8U06h3xqNIqNNU1LTXPcedxByAR4GS6pwQK0mgA==",
    tarballUrl: "https://registry.npmjs.org/wsl-utils/-/wsl-utils-1.0.0.tgz",
  }),
  frozenNpmPackage({
    packageName: "powershell-utils",
    version: "0.1.0",
    integrity: "sha512-dM0jVuXJPsDN6DvRpea484tCUaMiXWjuCn++HGTqUWzGDjv5tZkEZldAJ/UMlqRYGFrD/etByo4/xOuC/snX2A==",
    tarballUrl: "https://registry.npmjs.org/powershell-utils/-/powershell-utils-0.1.0.tgz",
    nodeModulesPath: "wsl-utils/node_modules/powershell-utils",
  }),
  frozenNpmPackage({
    packageName: "powershell-utils",
    version: "0.2.0",
    integrity: "sha512-ZlsFlG7MtSFCoc5xreOvBAozCJ6Pf06opgJjh9ONEv418xpZSAzNjstD36C6+JwOnfSqOW/9uDkqKjezTdxZhw==",
    tarballUrl: "https://registry.npmjs.org/powershell-utils/-/powershell-utils-0.2.0.tgz",
  }),
  frozenNpmPackage({
    packageName: "is-wsl",
    version: "3.1.0",
    integrity: "sha512-UcVfVfaK4Sc4m7X3dUSoHoozQGBEFeDC+zVo06t98xe8CzHSZZBekNXH+tu0NalHolcJ/QAGqS46Hef7QXBIMw==",
    tarballUrl: "https://registry.npmjs.org/is-wsl/-/is-wsl-3.1.0.tgz",
  }),
  frozenNpmPackage({
    packageName: "define-lazy-prop",
    version: "3.0.0",
    integrity: "sha512-N+MeXYoqr3pOgn8xfyRPREN7gHakLYjhsHhWGT3fWAiL4IkAt0iDw14QiiEm2bE30c5XX5q0FtAA3CK5f9/BUg==",
    tarballUrl: "https://registry.npmjs.org/define-lazy-prop/-/define-lazy-prop-3.0.0.tgz",
  }),
  frozenNpmPackage({
    packageName: "is-inside-container",
    version: "1.0.0",
    integrity: "sha512-KIYLCCJghfHZxqjYBE7rEy0OBuTd5xCHS7tHVgvCLkx7StIoaxwNW3hCALgEUjFfeRk+MG/Qxmp/vtETEF3tRA==",
    tarballUrl: "https://registry.npmjs.org/is-inside-container/-/is-inside-container-1.0.0.tgz",
  }),
  frozenNpmPackage({
    packageName: "is-docker",
    version: "3.0.0",
    integrity: "sha512-eljcgEDlEns/7AXFosB5K/2nCM4P7FQPkGc/DWLy5rmFEWvZayGrik1d9/QIY5nJ4f9YsVvBkA6kJpHn9rISdQ==",
    tarballUrl: "https://registry.npmjs.org/is-docker/-/is-docker-3.0.0.tgz",
  }),
  frozenNpmPackage({
    packageName: "default-browser",
    version: "5.5.1",
    integrity: "sha512-m1pAzaJgZ/gssEqlOhJkPJp8Xly7QyW6xcrkUa2KKcDeDSEMP7X8xipU3snUcfisTQx0w1AGae+9UtJSfVnXGw==",
    tarballUrl: "https://registry.npmjs.org/default-browser/-/default-browser-5.5.1.tgz",
  }),
  frozenNpmPackage({
    packageName: "bundle-name",
    version: "4.1.0",
    integrity: "sha512-tjwM5exMg6BGRI+kNmTntNsvdZS1X8BFYS6tnJ2hdH0kVxM6/eVZ2xy+FqStSWvYmtfFMDLIxurorHwDKfDz5Q==",
    tarballUrl: "https://registry.npmjs.org/bundle-name/-/bundle-name-4.1.0.tgz",
  }),
  frozenNpmPackage({
    packageName: "default-browser-id",
    version: "5.0.0",
    integrity: "sha512-A6p/pu/6fyBcA1TRz/GqWYPViplrftcW2gZC9q79ngNCKAeR/X3gcEdXQHl4KNXV+3wgIJ1CPkJQ3IHM6lcsyA==",
    tarballUrl: "https://registry.npmjs.org/default-browser-id/-/default-browser-id-5.0.0.tgz",
  }),
  frozenNpmPackage({
    packageName: "run-applescript",
    version: "7.1.0",
    integrity: "sha512-DPe5pVFaAsinSaV6QjQ6gdiedWDcRCbUuiQfQa2wmWV7+xC9bGulGI8+TdRmoFkAPaBXk8CrAbnlY2ISniJ47Q==",
    tarballUrl: "https://registry.npmjs.org/run-applescript/-/run-applescript-7.1.0.tgz",
  }),
]);

export const CODEX_ACP_MANAGED_RELEASE = Object.freeze({
  providerId: "codex",
  runtimeId: "acp",
  displayName: "Codex",
  securityProfile: "client-mediated",
  installable: true,
  distribution: Object.freeze({
    type: "npm",
    packageName: "@agentclientprotocol/codex-acp",
    minVersion: "1.7.0",
    executableRelativePath: "package/dist/index.js",
    managedRelease: Object.freeze({
      version: "1.7.0",
      integrity: "sha512-+nUhAJyunx8Zc7r3jjLPoMPPUkkk02TmBIosln4l+ugRNUOdNQAMm6toZo7xb+mF1yM5zxJB83qvy/bPmOTaaw==",
      tarballUrl: "https://registry.npmjs.org/@agentclientprotocol/codex-acp/-/codex-acp-1.7.0.tgz",
    }),
    closure: CODEX_ACP_CLOSURE,
  }),
});

export const SHIPPED_ACP_CATALOG = Object.freeze([
  QODER_MANAGED_RELEASE,
  CODEX_ACP_MANAGED_RELEASE,
]);

export function catalogEntryByProviderId(providerId, entries = SHIPPED_ACP_CATALOG) {
  return entries.find((entry) => entry.providerId === providerId) || null;
}

export function closurePackagesForInstall(entry, {
  platform = process.platform,
  arch = process.arch,
} = {}) {
  const packages = Array.isArray(entry?.distribution?.closure)
    ? entry.distribution.closure
    : [];
  return Object.freeze(packages.filter((item) => {
    if (item.platform && item.platform !== platform) return false;
    if (item.arch && item.arch !== arch) return false;
    return true;
  }));
}

export function assertInstallableCatalogEntry(entry, providerId) {
  if (!entry) {
    throw agentProviderError(
      "AGENT_PROVIDER_UNSUPPORTED",
      "The selected Agent is not in PageRoot's ACP catalog.",
      { status: 404 },
    );
  }
  if (entry.installable !== true || entry.distribution?.type !== "npm") {
    throw agentProviderError(
      "AGENT_INSTALL_UNSUPPORTED",
      "This Agent cannot be installed from PageRoot.",
      { status: 409 },
    );
  }
  if (entry.providerId !== providerId) {
    throw agentProviderError(
      "AGENT_SELECTION_UNSUPPORTED",
      "The requested Agent provider selection is unsupported.",
      { status: 409 },
    );
  }
  return entry;
}
