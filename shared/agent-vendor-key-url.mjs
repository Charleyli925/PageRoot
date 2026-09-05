const HTTPS_ORIGIN = "https:";

export const AGENT_VENDOR_KEY_PAGES = Object.freeze({
  deepseek: Object.freeze({
    url: "https://platform.deepseek.com/api_keys",
    hostSuffixes: Object.freeze(["deepseek.com"]),
  }),
  zhipu: Object.freeze({
    url: "https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys",
    hostSuffixes: Object.freeze(["bigmodel.cn"]),
  }),
  dashscope: Object.freeze({
    url: "https://bailian.console.aliyun.com/?tab=model#/api-key",
    hostSuffixes: Object.freeze(["aliyun.com"]),
  }),
  openai: Object.freeze({
    url: "https://platform.openai.com/api-keys",
    hostSuffixes: Object.freeze(["openai.com"]),
  }),
});

export const AGENT_VENDOR_KEY_VENDOR_IDS = Object.freeze(Object.keys(AGENT_VENDOR_KEY_PAGES));

function hostAllowed(hostname, suffixes) {
  const host = String(hostname || "").trim().toLowerCase().replace(/\.$/u, "");
  if (!host || host.includes(":") || /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host)) return false;
  return suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

export function publicAgentVendorKeyUrl(vendorId) {
  const page = AGENT_VENDOR_KEY_PAGES[String(vendorId || "").trim()];
  if (!page) return null;
  let parsed;
  try {
    parsed = new URL(page.url);
  } catch {
    return null;
  }
  if (parsed.protocol !== HTTPS_ORIGIN) return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.port && parsed.port !== "443") return null;
  if (!hostAllowed(parsed.hostname, page.hostSuffixes)) return null;
  return parsed.toString();
}
