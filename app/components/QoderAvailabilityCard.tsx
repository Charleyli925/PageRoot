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
  surface: "delivery" | "about" | "settings";
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
      label: "登录 Qoder",
      copiedLabel: "重新登录",
    }),
    recheck: Object.freeze({
      label: "重试",
      copiedLabel: "重试",
    }),
  }),
});

export default function QoderAvailabilityCard(props: QoderAvailabilityCardProps) {
  return <AgentProviderCard {...props} presentation={QODER_CARD_PRESENTATION} />;
}
