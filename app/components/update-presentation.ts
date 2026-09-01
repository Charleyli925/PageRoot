import type { ApplicationUpdateResult } from "../workbench/types";

export type UpdatePresentation = Readonly<{
  tone: "neutral" | "checking" | "current" | "available" | "ready" | "unavailable";
  title: string;
  detail: string;
}>;

export function architectureLabel(architecture: string | null | undefined): string {
  if (architecture === "arm64") return "Apple silicon";
  if (architecture === "x64") return "Intel";
  return "macOS";
}

export function updatePresentation({
  result,
  updatesAvailable,
  manualCheckPending,
  manualCheckFailed,
}: {
  result: ApplicationUpdateResult | null;
  updatesAvailable: boolean;
  manualCheckPending: boolean;
  manualCheckFailed: boolean;
}): UpdatePresentation {
  if (!updatesAvailable) {
    return {
      tone: "neutral",
      title: "浏览器预览不检查应用更新",
      detail: "自动更新只在正式签名的 macOS 应用中启用。",
    };
  }
  if (manualCheckFailed) {
    return {
      tone: "unavailable",
      title: "本机更新服务暂时不可用",
      detail: "当前编辑不受影响，可以稍后重新检查。",
    };
  }
  if (!result) {
    return {
      tone: "checking",
      title: "正在读取更新状态",
      detail: "源页正在连接本机更新服务。",
    };
  }
  if (manualCheckPending || result.status === "checking") {
    return {
      tone: "checking",
      title: "正在检查更新",
      detail: "正在核对 GitHub 上最新的正式版本。",
    };
  }
  if (result.status === "current") {
    return {
      tone: "current",
      title: "当前已是最新版本",
      detail: `PageRoot ${result.currentVersion} 已是最新的正式版本。`,
    };
  }
  if (result.status === "available") {
    return {
      tone: "available",
      title: `PageRoot ${result.latestVersion || "新版本"} 可以下载`,
      detail: "点击下载后仍可继续编辑；下载完成时再决定是否重启。",
    };
  }
  if (result.status === "downloading") {
    return {
      tone: "available",
      title: `正在下载 PageRoot ${result.latestVersion || "新版本"}`,
      detail: "你可以继续编辑；下载完成后可在侧栏或设置中重启安装。",
    };
  }
  if (result.status === "downloaded") {
    return {
      tone: "ready",
      title: `PageRoot ${result.latestVersion || "新版本"} 已准备好`,
      detail: "点击重启后会先写入当前编辑，然后安装新版本。",
    };
  }
  if (result.status === "installing") {
    return {
      tone: "ready",
      title: "源页即将重新打开",
      detail: "新版本安装完成后会自动回到源页。",
    };
  }
  if (result.status === "unavailable") {
    return {
      tone: "unavailable",
      title: "暂时无法连接更新服务",
      detail: "当前编辑不受影响，可以稍后重新检查。",
    };
  }
  if (result.status === "unsupported") {
    return {
      tone: "neutral",
      title: "当前构建不检查应用更新",
      detail: "自动更新只在正式签名的 macOS 应用中启用。",
    };
  }
  return {
    tone: "neutral",
    title: "自动更新已开启",
    detail: "启动后会检查一次；应用保持打开时，每 4 小时检查一次。",
  };
}
