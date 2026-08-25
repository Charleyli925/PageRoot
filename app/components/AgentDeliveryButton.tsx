"use client";

import { ChatCircleTextIcon } from "@phosphor-icons/react/dist/csr/ChatCircleText";

export type AgentDeliveryMode = "qoder-acp" | "clipboard";

/*
 * The top bar opens the conversation. It does not narrate the round: six inputs once
 * decided one sentence up here, restating what the thread already says, and every
 * added state was another chance for the two to contradict each other. Both
 * contradictions fixed today lived in that sentence.
 */
const TRIGGER_LABEL = "AI 助手";


/**
 * Opens the AI conversation. Everything about a round — the destination, the stages,
 * the Agent's own words, the decision — happens inside that conversation, so this
 * control has exactly one meaning and never competes with the thread for authority.
 * A quiet dot marks that something in there is waiting; the words do not change.
 */
export function AgentDeliveryButton({
  status,
  disabled,
  attention = false,
  onOpen,
}: {
  status: string;
  disabled: boolean;
  /** The conversation holds something the user has not dealt with yet. */
  attention?: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      className="header-send-button"
      type="button"
      data-handoff-status={status}
      data-attention={attention ? "true" : undefined}
      disabled={disabled}
      onClick={onOpen}
    >
      <ChatCircleTextIcon aria-hidden="true" size={15} weight="fill" />
      <span>{TRIGGER_LABEL}</span>
    </button>
  );
}
