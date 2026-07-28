"use client";

import {
  useEffect,
  useRef,
  type MouseEvent,
} from "react";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { CloudArrowDownIcon } from "@phosphor-icons/react/dist/csr/CloudArrowDown";
import { GithubLogoIcon } from "@phosphor-icons/react/dist/csr/GithubLogo";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";

export type AboutApplicationUpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "current"
  | "unsupported"
  | "unavailable";

export type AboutApplicationUpdateResult = {
  status: AboutApplicationUpdateStatus;
  currentVersion: string;
  latestVersion: string | null;
  architecture: string;
  downloadPercent: number | null;
  publishedAt: string | null;
};

type AboutPageRootDialogProps = {
  open: boolean;
  appVersion: string;
  updateResult: AboutApplicationUpdateResult | null;
  updatesAvailable: boolean;
  manualCheckPending: boolean;
  manualCheckFailed: boolean;
  repositoryOpenFailed: boolean;
  onClose: () => void;
  onCheckForUpdates: () => void;
  onDownloadUpdate: () => void;
  onRequestRestart: () => void;
  onOpenRepository: () => void;
};

type UpdatePresentation = {
  tone: "neutral" | "checking" | "current" | "available" | "ready" | "unavailable";
  eyebrow: string;
  title: string;
  detail: string;
};

function architectureLabel(architecture: string | null | undefined): string {
  if (architecture === "arm64") return "Apple silicon";
  if (architecture === "x64") return "Intel";
  return "macOS";
}

function updatePresentation({
  result,
  updatesAvailable,
  manualCheckPending,
  manualCheckFailed,
}: {
  result: AboutApplicationUpdateResult | null;
  updatesAvailable: boolean;
  manualCheckPending: boolean;
  manualCheckFailed: boolean;
}): UpdatePresentation {
  if (!updatesAvailable) {
    return {
      tone: "neutral",
      eyebrow: "桌面更新",
      title: "浏览器预览不检查应用更新",
      detail: "自动更新只在正式签名的 macOS 应用中启用。",
    };
  }
  if (manualCheckFailed) {
    return {
      tone: "unavailable",
      eyebrow: "检查未完成",
      title: "本机更新服务暂时不可用",
      detail: "当前编辑不受影响，可以稍后重新检查。",
    };
  }
  if (!result) {
    return {
      tone: "checking",
      eyebrow: "Stable 频道",
      title: "正在读取更新状态",
      detail: "源页正在连接本机更新服务。",
    };
  }
  if (manualCheckPending || result.status === "checking") {
    return {
      tone: "checking",
      eyebrow: "Stable 频道",
      title: "正在检查更新",
      detail: "正在核对 GitHub 上最新的正式版本。",
    };
  }
  if (result.status === "current") {
    return {
      tone: "current",
      eyebrow: "Stable 频道",
      title: "当前已是最新版本",
      detail: `PageRoot ${result.currentVersion} 已是最新的正式版本。`,
    };
  }
  if (result.status === "available") {
    return {
      tone: "available",
      eyebrow: "发现新版本",
      title: `PageRoot ${result.latestVersion || "新版本"} 可以下载`,
      detail: "点击下载后仍可继续编辑；下载完成时再决定是否重启。",
    };
  }
  if (result.status === "downloading") {
    return {
      tone: "available",
      eyebrow: "后台下载",
      title: `正在下载 PageRoot ${result.latestVersion || "新版本"}`,
      detail: "你可以继续编辑；下载完成后源页会询问是否现在重启。",
    };
  }
  if (result.status === "downloaded") {
    return {
      tone: "ready",
      eyebrow: "可以安装",
      title: `PageRoot ${result.latestVersion || "新版本"} 已准备好`,
      detail: "重启前会先确认当前编辑、评论和项目资料已经安全写入。",
    };
  }
  if (result.status === "installing") {
    return {
      tone: "ready",
      eyebrow: "正在安装",
      title: "源页即将重新打开",
      detail: "新版本安装完成后会自动回到源页。",
    };
  }
  if (result.status === "unavailable") {
    return {
      tone: "unavailable",
      eyebrow: "检查未完成",
      title: "暂时无法连接更新服务",
      detail: "当前编辑不受影响，可以稍后重新检查。",
    };
  }
  if (result.status === "unsupported") {
    return {
      tone: "neutral",
      eyebrow: "桌面更新",
      title: "当前构建不检查应用更新",
      detail: "自动更新只在正式签名的 macOS 应用中启用。",
    };
  }
  return {
    tone: "neutral",
    eyebrow: "Stable 频道",
    title: "自动更新已开启",
    detail: "启动后会检查一次；应用保持打开时，每 4 小时检查一次。",
  };
}

export default function AboutPageRootDialog({
  open,
  appVersion,
  updateResult,
  updatesAvailable,
  manualCheckPending,
  manualCheckFailed,
  repositoryOpenFailed,
  onClose,
  onCheckForUpdates,
  onDownloadUpdate,
  onRequestRestart,
  onOpenRepository,
}: AboutPageRootDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const presentation = updatePresentation({
    result: updateResult,
    updatesAvailable,
    manualCheckPending,
    manualCheckFailed,
  });
  const checking = manualCheckPending || updateResult?.status === "checking";
  const downloaded = updateResult?.status === "downloaded";
  const available = updateResult?.status === "available";
  const installing = updateResult?.status === "installing";
  const downloading = updateResult?.status === "downloading";
  const canCheck = (
    updatesAvailable
    && !checking
    && !available
    && !downloaded
    && !installing
    && !downloading
    && updateResult?.status !== "unsupported"
  );
  const actionLabel = downloaded
    ? "重启更新"
    : available
      ? "下载更新"
      : installing
        ? "正在重启…"
        : downloading
          ? "正在下载…"
          : checking
            ? "正在检查…"
            : canCheck
              ? "立即检查"
              : "仅正式版可用";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      requestAnimationFrame(() => closeButtonRef.current?.focus());
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const handleBackdropPointer = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      className="about-dialog"
      aria-labelledby="about-pageroot-title"
      aria-describedby="about-pageroot-description"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      onMouseDown={handleBackdropPointer}
    >
      <article className="about-dialog-card">
        <button
          ref={closeButtonRef}
          className="about-close-button"
          type="button"
          aria-label="关闭关于源页"
          title="关闭"
          onClick={onClose}
        >
          <XIcon aria-hidden="true" size={17} weight="bold" />
        </button>

        <header className="about-identity">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="./brand-logo.png" alt="" />
          <div>
            <span>PageRoot for macOS</span>
            <h2 id="about-pageroot-title">源页</h2>
            <p id="about-pageroot-description">
              源码级本地 HTML 编辑器。真实 HTML，是唯一事实源。
            </p>
          </div>
        </header>

        <div className="about-product-meta" aria-label="应用信息">
          <span>版本 {appVersion || updateResult?.currentVersion || "—"}</span>
          <span>{architectureLabel(updateResult?.architecture)}</span>
          <span>Apache-2.0</span>
        </div>

        <section
          className="about-update-card"
          data-tone={presentation.tone}
          aria-labelledby="about-update-title"
        >
          <div className="about-update-icon" aria-hidden="true">
            {presentation.tone === "ready" ? (
              <CheckCircleIcon size={23} weight="fill" />
            ) : (
              <CloudArrowDownIcon size={23} weight="duotone" />
            )}
          </div>
          <div className="about-update-copy" aria-live="polite" aria-atomic="true">
            <span>{presentation.eyebrow}</span>
            <strong id="about-update-title">{presentation.title}</strong>
            <p>{presentation.detail}</p>
          </div>
          <button
            className="about-update-action"
            type="button"
            disabled={!canCheck && !available && !downloaded}
            onClick={
              downloaded
                ? onRequestRestart
                : available
                  ? onDownloadUpdate
                  : onCheckForUpdates
            }
          >
            {actionLabel}
          </button>
        </section>

        <button
          className="about-github-link"
          type="button"
          onClick={onOpenRepository}
        >
          <span className="about-github-icon" aria-hidden="true">
            <GithubLogoIcon size={24} weight="fill" />
          </span>
          <span>
            <strong>PageRoot on GitHub</strong>
            <small>查看源代码、问题与正式发布记录</small>
          </span>
          <ArrowSquareOutIcon aria-hidden="true" size={17} weight="bold" />
        </button>
        {repositoryOpenFailed ? (
          <p className="about-link-error" role="alert">
            GitHub 页面没有打开，请检查网络后重试。
          </p>
        ) : null}

        <footer className="about-footer">
          <span>Stable 频道</span>
          <i aria-hidden="true" />
          <span>每 4 小时自动检查</span>
        </footer>
      </article>
    </dialog>
  );
}
