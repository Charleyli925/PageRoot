"use client";

import type { Ref } from "react";

import {
  qoderAvailabilityPresentation,
  type QoderAvailabilitySnapshot,
  type QoderGuidanceKind,
} from "../domain/qoder-availability.js";
import AgentProviderCard from "./AgentProviderCard";

type QoderActionOutcome = Readonly<{ status: string; reason?: string }> | null | undefined;
type QoderAvailabilityCardProps = {
  availability: QoderAvailabilitySnapshot;
  surface: "delivery" | "about";
  disabled?: boolean;
  actionButtonRef?: Ref<HTMLButtonElement>;
  onCopyGuidance: (kind: QoderGuidanceKind) => Promise<QoderActionOutcome>;
  onInstall?: () => Promise<QoderActionOutcome>;
};

const QODER_CARD_PRESENTATION = Object.freeze({
  displayName: "Qoder CLI",
  logoSrc: "./qoder-logo.png",
  cardClassName: "qoder-availability-card",
  primaryActionDataAttribute: "data-qoder-primary",
  availability: qoderAvailabilityPresentation,
  actions: Object.freeze({
    install: Object.freeze({
      label: "安装 Qoder CLI",
      copiedLabel: "重新安装",
    }),
    login: Object.freeze({
      label: "复制指令粘贴至 Agent",
      copiedLabel: "重新复制",
    }),
  }),
});

export default function QoderAvailabilityCard(props: QoderAvailabilityCardProps) {
  return <AgentProviderCard {...props} presentation={QODER_CARD_PRESENTATION} />;
}
