import { OPAQUE_SANDBOX_STORAGE_BOOTSTRAP } from "../../lib/opaque-sandbox-storage.js";
import {
  REVIEW_PROJECTION_FACTS_SERIALIZED_LENGTH_LIMIT,
} from "../../lib/review-projection-facts.js";
import {
  alignReviewTextEvidenceDotRows,
  reviewTextEvidenceGraphemeEnd,
  reviewTextEvidenceIsPunctuationCode,
  reviewTextEvidenceMarkGeometry,
} from "../../lib/review-text-evidence-marks.js";
import {
  REVIEW_BOOTSTRAP_IDENTITY_ATTRIBUTE_LIMIT,
  REVIEW_COMMENT_BINDING_SOURCE_BOX_ATTRIBUTES,
} from "./constants";
import type {
  ReviewBootstrapElementBinding,
  ReviewCommentBootstrapBinding,
  ReviewSide,
} from "./types";

export function reviewBootstrapElementBinding(
  document: Document,
  element: Element,
  includeIdentityText = false,
): ReviewBootstrapElementBinding | null {
  const root = document.documentElement;
  if (!root) return null;
  const path: number[] = [];
  let current: Element | null = element;
  while (current && current !== root) {
    const parent: Element | null = current.parentElement;
    if (!parent) return null;
    const index = [...parent.children].indexOf(current);
    if (index < 0) return null;
    path.unshift(index);
    if (path.length > 256) return null;
    current = parent;
  }
  if (current !== root) return null;
  const nonReviewAttributes = [...element.attributes].filter((attribute) => (
    (
      attribute.name === "data-pageroot-id"
      || !attribute.name.startsWith("data-pageroot-")
    )
    && !REVIEW_COMMENT_BINDING_SOURCE_BOX_ATTRIBUTES.includes(attribute.name)
  ));
  const identityAttributePriority = (name: string) => {
    if (name === "data-pageroot-id") return 0;
    if (name === "id") return 1;
    if (name === "name" || name === "aria-label") return 2;
    if (name.startsWith("data-")) return 3;
    return 4;
  };
  const identityAttributes = (nonReviewAttributes.some(
    (attribute) => attribute.name !== "class",
  )
    ? nonReviewAttributes.filter((attribute) => attribute.name !== "class")
    : nonReviewAttributes
  ).map((attribute) => [attribute.name, attribute.value] as [string, string])
    .sort(([leftName, leftValue], [rightName, rightValue]) => (
      identityAttributePriority(leftName) - identityAttributePriority(rightName)
      || leftName.localeCompare(rightName)
      || leftValue.localeCompare(rightValue)
    ))
    .slice(0, REVIEW_BOOTSTRAP_IDENTITY_ATTRIBUTE_LIMIT);
  // A truncated fingerprint is never evidence of identity. Even an id/name
  // anchor can be shared by an authored parser decoy while an omitted
  // attribute distinguishes the real source target, so drop every binding
  // that cannot be represented completely.
  if (nonReviewAttributes.length > REVIEW_BOOTSTRAP_IDENTITY_ATTRIBUTE_LIMIT) return null;
  const identityText = includeIdentityText
    ? (element.textContent || "").replace(/\s+/gu, " ").trim().slice(0, 1024)
    : "";
  return {
    path,
    tagName: element.tagName,
    sourceBoxSignature: JSON.stringify(
      REVIEW_COMMENT_BINDING_SOURCE_BOX_ATTRIBUTES.map((attribute) => [
        attribute,
        element.getAttribute(attribute),
      ]),
    ),
    identityAttributes,
    ...(identityText ? { identityText } : {}),
  };
}

function reviewBootstrap(
  sessionId: string,
  side: ReviewSide,
  reviewCommentBindings: readonly ReviewCommentBootstrapBinding[] = [],
  reviewVisualStableIds: readonly string[] = [],
): string {
  const serializedBootstrapPayload = (value: unknown) => (
    JSON.stringify(value).replace(/</gu, "\\u003c")
  );
  return String.raw`
(() => {
  const sessionId = ${JSON.stringify(sessionId)};
  const side = ${JSON.stringify(side)};
  // This first managed script binds private projection targets before authored
  // scripts execute. The binding payload is available only through the first
  // one-shot bootstrap response; authored markup and ordinary window messages
  // never receive source identities, candidate keys, or screenshots.
  const reviewCommentInitialBindings = Object.freeze(
    ${serializedBootstrapPayload(reviewCommentBindings)},
  );
  const reviewVisualInitialStableIds = Object.freeze(
    ${serializedBootstrapPayload(reviewVisualStableIds)},
  );
  // A script-enabled opaque sandbox intentionally has no durable origin. The
  // shared bootstrap supplies one frame-local compatibility surface so an
  // authored chart cannot abort merely by reading storage.
  ${OPAQUE_SANDBOX_STORAGE_BOOTSTRAP}
  const reviewTextEvidenceGraphemeEnd = ${reviewTextEvidenceGraphemeEnd.toString()};
  const reviewTextEvidenceIsPunctuationCode = ${reviewTextEvidenceIsPunctuationCode.toString()};
  const reviewTextEvidenceMarkGeometry = ${reviewTextEvidenceMarkGeometry.toString()};
  const alignReviewTextEvidenceDotRows = ${alignReviewTextEvidenceDotRows.toString()};
  const reviewProjectionFactsSerializedLengthLimit = ${REVIEW_PROJECTION_FACTS_SERIALIZED_LENGTH_LIMIT};
  const runtimeVisualBindCall = (method) => Function.prototype.call.bind(method);
  const runtimeVisualFunctionHasInstance = runtimeVisualBindCall(
    Function.prototype[Symbol.hasInstance],
  );
  const RuntimeVisualElement = Element;
  const RuntimeVisualMap = Map;
  const RuntimeVisualSet = Set;
  const RuntimeVisualString = String;
  const runtimeVisualBoolean = Boolean;
  const runtimeVisualMathFloor = Math.floor.bind(Math);
  const runtimeVisualMathImul = Math.imul.bind(Math);
  const runtimeVisualNumberIsFinite = Number.isFinite.bind(Number);
  const runtimeVisualSetTimeout = window.setTimeout.bind(window);
  const runtimeVisualRequestAnimationFrame = window.requestAnimationFrame.bind(window);
  const runtimeVisualPerformanceNow = performance.now.bind(performance);
  const runtimeVisualArrayPush = runtimeVisualBindCall(Array.prototype.push);
  const runtimeVisualArrayForEach = runtimeVisualBindCall(Array.prototype.forEach);
  const runtimeVisualArrayJoin = runtimeVisualBindCall(Array.prototype.join);
  const runtimeVisualArrayMap = runtimeVisualBindCall(Array.prototype.map);
  const runtimeVisualArraySome = runtimeVisualBindCall(Array.prototype.some);
  const runtimeVisualArrayIsArray = Array.isArray.bind(Array);
  const runtimeVisualStringCharCodeAt = runtimeVisualBindCall(
    String.prototype.charCodeAt,
  );
  const runtimeVisualStringToLowerCase = runtimeVisualBindCall(String.prototype.toLowerCase);
  const runtimeVisualStringToUpperCase = runtimeVisualBindCall(String.prototype.toUpperCase);
  const runtimeVisualStringFromCharCode = String.fromCharCode.bind(String);
  const runtimeVisualRegExpExec = runtimeVisualBindCall(RegExp.prototype.exec);
  const runtimeVisualDocumentQuerySelectorAll = runtimeVisualBindCall(
    Document.prototype.querySelectorAll,
  );
  const runtimeVisualDocumentCreateElement = runtimeVisualBindCall(
    Document.prototype.createElement,
  );
  const runtimeVisualElementGetAttribute = runtimeVisualBindCall(
    Element.prototype.getAttribute,
  );
  const runtimeVisualElementSetAttribute = runtimeVisualBindCall(
    Element.prototype.setAttribute,
  );
  const runtimeVisualElementRemoveAttribute = runtimeVisualBindCall(
    Element.prototype.removeAttribute,
  );
  const runtimeVisualElementQuerySelectorAll = runtimeVisualBindCall(
    Element.prototype.querySelectorAll,
  );
  const runtimeVisualElementMatches = runtimeVisualBindCall(Element.prototype.matches);
  const runtimeVisualElementGetClientRects = runtimeVisualBindCall(
    Element.prototype.getClientRects,
  );
  const runtimeVisualElementGetBoundingClientRect = runtimeVisualBindCall(
    Element.prototype.getBoundingClientRect,
  );
  const runtimeVisualGetComputedStyle = window.getComputedStyle.bind(window);
  const runtimeVisualCanvasGetContext = runtimeVisualBindCall(
    HTMLCanvasElement.prototype.getContext,
  );
  const runtimeVisualCanvasWidth = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "width").get,
  );
  const runtimeVisualCanvasHeight = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "height").get,
  );
  const runtimeVisualCanvasGetImageData = runtimeVisualBindCall(
    CanvasRenderingContext2D.prototype.getImageData,
  );
  const runtimeVisualCanvasDrawImage = runtimeVisualBindCall(
    CanvasRenderingContext2D.prototype.drawImage,
  );
  const runtimeVisualDocumentGetAnimations = runtimeVisualBindCall(
    Document.prototype.getAnimations,
  );
  const runtimeVisualDocumentReadyState = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(Document.prototype, "readyState").get,
  );
  const runtimeVisualNodeIsConnected = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(Node.prototype, "isConnected").get,
  );
  const runtimeVisualNodeTextContent = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(Node.prototype, "textContent").get,
  );
  const runtimeVisualElementTagName = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(Element.prototype, "tagName").get,
  );
  const runtimeVisualElementChildren = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(Element.prototype, "children").get,
  );
  const runtimeVisualHtmlCollectionLength = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(HTMLCollection.prototype, "length").get,
  );
  const runtimeVisualHtmlCollectionItem = runtimeVisualBindCall(
    HTMLCollection.prototype.item,
  );
  const runtimeVisualNodeListLength = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(NodeList.prototype, "length").get,
  );
  const runtimeVisualNodeListItem = runtimeVisualBindCall(NodeList.prototype.item);
  const RuntimeVisualMutationObserver = MutationObserver;
  const runtimeVisualMutationObserverObserve = runtimeVisualBindCall(
    MutationObserver.prototype.observe,
  );
  const runtimeVisualMutationObserverTakeRecords = runtimeVisualBindCall(
    MutationObserver.prototype.takeRecords,
  );
  const runtimeVisualMutationObserverDisconnect = runtimeVisualBindCall(
    MutationObserver.prototype.disconnect,
  );
  const runtimeVisualMutationRecordType = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(MutationRecord.prototype, "type").get,
  );
  const runtimeVisualMutationRecordAddedNodes = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(MutationRecord.prototype, "addedNodes").get,
  );
  const runtimeVisualMutationRecordRemovedNodes = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(MutationRecord.prototype, "removedNodes").get,
  );
  const runtimeVisualMutationRecordTarget = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(MutationRecord.prototype, "target").get,
  );
  const runtimeVisualMutationRecordOldValue = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(MutationRecord.prototype, "oldValue").get,
  );
  const runtimeVisualDomRectListLength = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(DOMRectList.prototype, "length").get,
  );
  const runtimeVisualDomRectListItem = runtimeVisualBindCall(DOMRectList.prototype.item);
  const runtimeVisualMapGet = runtimeVisualBindCall(Map.prototype.get);
  const runtimeVisualMapHas = runtimeVisualBindCall(Map.prototype.has);
  const runtimeVisualMapSet = runtimeVisualBindCall(Map.prototype.set);
  const runtimeVisualMapForEach = runtimeVisualBindCall(Map.prototype.forEach);
  const runtimeVisualSetHas = runtimeVisualBindCall(Set.prototype.has);
  const runtimeVisualSetAdd = runtimeVisualBindCall(Set.prototype.add);
  const runtimeVisualStringify = JSON.stringify.bind(JSON);
  const runtimeVisualIsInstance = (constructor, value) => (
    runtimeVisualFunctionHasInstance(constructor, value)
  );
  const runtimeVisualWhitespaceCode = (code) => (
    code === 0x0009
    || (code >= 0x000a && code <= 0x000d)
    || code === 0x0020
    || code === 0x00a0
    || code === 0x1680
    || (code >= 0x2000 && code <= 0x200a)
    || code === 0x2028
    || code === 0x2029
    || code === 0x202f
    || code === 0x205f
    || code === 0x3000
    || code === 0xfeff
  );
  const runtimeVisualNormalizeText = (value) => {
    const source = RuntimeVisualString(value || "");
    const values = [];
    let pendingWhitespace = false;
    for (let index = 0; index < source.length; index += 1) {
      const code = runtimeVisualStringCharCodeAt(source, index);
      if (runtimeVisualWhitespaceCode(code)) {
        if (values.length) pendingWhitespace = true;
        continue;
      }
      if (pendingWhitespace) runtimeVisualArrayPush(values, " ");
      runtimeVisualArrayPush(values, runtimeVisualStringFromCharCode(code));
      pendingWhitespace = false;
    }
    return runtimeVisualArrayJoin(values, "");
  };
  // The first managed script runs before authored script. Freeze the
  // session-derived fragment now so later authored prototype changes cannot
  // influence a reserved SVG mask identifier.
  const reviewMaskSessionKey = RuntimeVisualString(sessionId)
    .replace(/[^a-z0-9_-]/giu, "_") || "session";
  const runtimeVisualQueryElements = (selector) => {
    const list = runtimeVisualDocumentQuerySelectorAll(document, selector);
    const values = [];
    const length = runtimeVisualNodeListLength(list);
    for (let index = 0; index < length; index += 1) {
      const value = runtimeVisualNodeListItem(list, index);
      if (value) runtimeVisualArrayPush(values, value);
    }
    return values;
  };
  let overlayFrame = 0;
  let layoutReportFrame = 0;
  let layoutReportTimer = 0;
  let presentationReadyTimer = 0;
  let geometryRevision = 0;
  let activeScrollCommand = null;
  let followerGestureId = 0;
  let acceptsFollowerScroll = false;
  let projectionEpoch = 0;
  let overlayMaskSequence = 0;
  let projectionTransitioning = false;
  let initialProjectionCommitted = false;
  let confirmedVisualChangeIds = new RuntimeVisualSet();
  let mirroringPanel = false;
  let mirroringAction = false;
  let currentState = {
    filter: "all",
    focus: "all",
    activeFocusGroupId: null,
    transparency: 18,
    scale: 1,
  };
  const reviewParent = parent;
  const postToParent = reviewParent.postMessage.bind(reviewParent);
  const runtimeVisualAddEventListener = addEventListener.bind(window);
  // Comment lookup uses a private capability port that never appears in
  // authored markup or ordinary window messages.
  const reviewCommentChannel = side === "before" && typeof MessageChannel === "function"
    ? new MessageChannel()
    : null;
  const stopImmediateMessagePropagation = Function.prototype.call.bind(
    Event.prototype.stopImmediatePropagation,
  );
  let reviewCommentChannelTransferred = false;
  let reviewCommentTargets = [];
  let pendingReviewCommentChannelChallenge = null;
  // This second capability is deliberately separate from comments. Its port
  // carries only bound visual observations; authored scripts cannot enumerate
  // candidates or forge a verdict through window messages.
  const reviewVisualChannel = typeof MessageChannel === "function" ? new MessageChannel() : null;
  let reviewVisualChannelTransferred = false;
  let pendingReviewVisualChannelChallenge = null;
  let privateChannelRequestsReady = false;
  const capturePrivateChannelRequest = (event) => {
    const message = event.data;
    const requestsCommentChannel = message?.type === "request-review-comment-channel";
    const requestsVisualChannel = message?.type === "request-review-visual-channel";
    if (
      !event.isTrusted
      || event.source !== reviewParent
      || !message
      || message.source !== "pageroot-ai-review-parent"
      || message.sessionId !== sessionId
      || (!requestsCommentChannel && !requestsVisualChannel)
    ) return;
    // This listener is installed by the first owned script with capture=true.
    // It consumes the capability challenge before authored capture listeners can
    // observe it or race a forged port back to the parent.
    stopImmediateMessagePropagation(event);
    if (requestsCommentChannel) pendingReviewCommentChannelChallenge = message.challenge;
    if (requestsVisualChannel) pendingReviewVisualChannelChallenge = message.challenge;
    if (privateChannelRequestsReady) drainPrivateChannelRequests();
  };
  runtimeVisualAddEventListener("message", capturePrivateChannelRequest, { capture: true });
  const post = (type, extra = {}) => postToParent({
    source: "pageroot-ai-review",
    sessionId,
    side,
    type,
    ...extra,
  }, "*");
  const transferReviewCommentChannel = (rawChallenge) => {
    const challenge = String(rawChallenge || "");
    if (runtimeVisualRegExpExec(/^[a-f0-9]{32}$/u, challenge) === null) return;
    if (!reviewCommentChannel || reviewCommentChannelTransferred) return;
    reviewCommentChannelTransferred = true;
    postToParent({
      source: "pageroot-ai-review",
      sessionId,
      side,
      type: "review-comment-channel",
      challenge,
    }, "*", [reviewCommentChannel.port2]);
  };
  const transferReviewVisualChannel = (rawChallenge) => {
    const challenge = String(rawChallenge || "");
    if (runtimeVisualRegExpExec(/^[a-f0-9]{32}$/u, challenge) === null) return;
    if (!reviewVisualChannel || reviewVisualChannelTransferred) return;
    reviewVisualChannelTransferred = true;
    postToParent({ source: "pageroot-ai-review", sessionId, side, type: "review-visual-channel", challenge }, "*", [reviewVisualChannel.port2]);
  };
  const drainPrivateChannelRequests = () => {
    const commentChallenge = pendingReviewCommentChannelChallenge;
    pendingReviewCommentChannelChallenge = null;
    if (commentChallenge !== null) transferReviewCommentChannel(commentChallenge);
    const visualChallenge = pendingReviewVisualChannelChallenge;
    pendingReviewVisualChannelChallenge = null;
    if (visualChallenge !== null) transferReviewVisualChannel(visualChallenge);
  };
  privateChannelRequestsReady = true;
  drainPrivateChannelRequests();
  const reviewVisualHash = (values) => {
    let left = 2166136261;
    let right = 2246822507;
    const source = runtimeVisualArrayJoin(values, "\u001f");
    for (let index = 0; index < source.length; index += 1) {
      const code = runtimeVisualStringCharCodeAt(source, index);
      left = runtimeVisualMathImul(left ^ code, 16777619);
      right = runtimeVisualMathImul(right ^ code, 3266489909);
    }
    return RuntimeVisualString(left >>> 0) + ":" + RuntimeVisualString(right >>> 0);
  };
  const reviewVisualPixelHash = (pixels) => {
    let left = 2166136261;
    let right = 2246822507;
    for (let index = 0; index < pixels.length; index += 1) {
      left = runtimeVisualMathImul(left ^ pixels[index], 16777619);
      right = runtimeVisualMathImul(right ^ pixels[index], 3266489909);
    }
    return RuntimeVisualString(left >>> 0) + ":" + RuntimeVisualString(right >>> 0);
  };
  const reviewVisualOwnedElements = (host, budget) => {
    const descendants = runtimeVisualElementQuerySelectorAll(host, "*");
    if (runtimeVisualNodeListLength(descendants) > 2048) return null;
    budget.nodes += runtimeVisualNodeListLength(descendants) + 1;
    if (budget.nodes > 20_000) {
      budget.failureReason = "global-node-budget";
      return null;
    }
    const result = [host];
    for (let index = 0; index < runtimeVisualNodeListLength(descendants); index += 1) {
      const node = runtimeVisualNodeListItem(descendants, index);
      if (!node) continue;
      let owner = node;
      while (owner && owner !== host) {
        if (runtimeVisualElementGetAttribute(owner, "data-pageroot-id")) break;
        owner = owner.parentElement;
      }
      if (owner === host) runtimeVisualArrayPush(result, node);
    }
    return result;
  };
  const reviewVisualFingerprint = (element, positionSensitive = false, budget) => {
    if (budget.failureReason) {
      return { visible: false, unverified: true, failureReason: budget.failureReason };
    }
    if (runtimeVisualPerformanceNow() - budget.startedAt > 1_500) {
      return { visible: false, unverified: true, failureReason: "global-time-budget" };
    }
    const owned = reviewVisualOwnedElements(element, budget);
    if (!owned) return {
      visible: false,
      unverified: true,
      failureReason: budget.failureReason || "node-budget",
    };
    const rootStyle = runtimeVisualGetComputedStyle(element);
    const rootRect = runtimeVisualElementGetBoundingClientRect(element);
    let stableParent = element.parentElement;
    while (stableParent && !runtimeVisualElementGetAttribute(stableParent, "data-pageroot-id")) {
      stableParent = stableParent.parentElement;
    }
    const stableParentRect = stableParent
      ? runtimeVisualElementGetBoundingClientRect(stableParent)
      : null;
    const ownedSet = new RuntimeVisualSet(owned);
    if (runtimeVisualArraySome(budget.animations, (animation) => (
      animation.playState === "running"
      && runtimeVisualSetHas(ownedSet, animation.effect?.target)
    ))) {
      return { visible: false, unverified: true, failureReason: "animation" };
    }
    if (runtimeVisualArraySome(owned, (node) => runtimeVisualElementMatches(node, "video,audio"))) {
      return { visible: false, unverified: true, failureReason: "live-media" };
    }
    let visible = false;
    const pieces = [];
    const presentation = (style) => [
      style.display, style.visibility, style.opacity, style.color,
      style.backgroundColor, style.borderTopColor, style.borderRightColor,
      style.borderBottomColor, style.borderLeftColor, style.borderTopWidth,
      style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth,
      style.borderTopStyle, style.borderRightStyle, style.borderBottomStyle,
      style.borderLeftStyle, style.fontFamily, style.fontSize, style.fontWeight,
      style.lineHeight, style.width, style.height, style.paddingTop,
      style.paddingRight, style.paddingBottom, style.paddingLeft, style.marginTop,
      style.marginRight, style.marginBottom, style.marginLeft, style.gap,
      style.rowGap, style.columnGap, style.borderRadius, style.boxShadow,
      style.transform, style.filter, style.mask, style.clipPath,
    ];
    for (let index = 0; index < owned.length; index += 1) {
      const node = owned[index];
      const style = runtimeVisualGetComputedStyle(node);
      const rect = runtimeVisualElementGetBoundingClientRect(node);
      const directText = [];
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 3) runtimeVisualArrayPush(directText, runtimeVisualNodeTextContent(child));
      }
      let visibleText = runtimeVisualNormalizeText(runtimeVisualArrayJoin(directText, " "));
      let effectiveOpacity = 1;
      for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) {
        effectiveOpacity *= Number(runtimeVisualGetComputedStyle(ancestor).opacity || 1);
        if (ancestor === element) break;
      }
      const nodeVisible = style.display !== "none" && style.visibility !== "hidden"
        && effectiveOpacity > 0 && (
          (rect.width > 0 && rect.height > 0)
          || (style.display === "contents" && Boolean(visibleText))
        );
      visible ||= nodeVisible;
      if (!nodeVisible) continue;
      if (style.textTransform === "uppercase") {
        visibleText = runtimeVisualStringToUpperCase(visibleText);
      } else if (style.textTransform === "lowercase") {
        visibleText = runtimeVisualStringToLowerCase(visibleText);
      }
      runtimeVisualArrayPush(
        pieces,
        visibleText,
        String(Math.round(rect.width * 2) / 2),
        String(Math.round(rect.height * 2) / 2),
      );
      runtimeVisualArrayForEach(presentation(style), (value) => runtimeVisualArrayPush(pieces, value));
      const pseudoNames = ["::before", "::after"];
      for (let pseudoIndex = 0; pseudoIndex < pseudoNames.length; pseudoIndex += 1) {
        const pseudoName = pseudoNames[pseudoIndex];
        const pseudo = runtimeVisualGetComputedStyle(node, pseudoName);
        runtimeVisualArrayPush(
          pieces,
          pseudo.content,
          pseudo.display,
          pseudo.visibility,
          pseudo.opacity,
          pseudo.color,
          pseudo.backgroundColor,
          pseudo.fontSize,
          pseudo.fontWeight,
          pseudo.width,
          pseudo.height,
        );
      }
      if (runtimeVisualElementMatches(node, "canvas")) {
        const width = runtimeVisualCanvasWidth(node);
        const height = runtimeVisualCanvasHeight(node);
        budget.pixels += width * height;
        if (budget.pixels > 4_000_000) {
          budget.failureReason = "global-pixel-budget";
          return { visible, unverified: true, failureReason: budget.failureReason };
        }
        try {
          const context = runtimeVisualCanvasGetContext(node, "2d", { willReadFrequently: true });
          if (!context) return { visible, unverified: true, failureReason: "webgl-or-unreadable-canvas" };
          const pixels = runtimeVisualCanvasGetImageData(context, 0, 0, width, height).data;
          runtimeVisualArrayPush(pieces, "canvas", String(width), String(height), reviewVisualPixelHash(pixels));
        } catch {
          return { visible, unverified: true, failureReason: "tainted-canvas" };
        }
      }
      if (runtimeVisualElementMatches(node, "img")) {
        if (!node.complete || !node.naturalWidth || !node.naturalHeight) {
          return { visible, unverified: true, failureReason: "image-not-ready" };
        }
        budget.pixels += node.naturalWidth * node.naturalHeight;
        if (budget.pixels > 4_000_000) {
          budget.failureReason = "global-pixel-budget";
          return { visible, unverified: true, failureReason: budget.failureReason };
        }
        try {
          const imageCanvas = runtimeVisualDocumentCreateElement(document, "canvas");
          imageCanvas.width = node.naturalWidth;
          imageCanvas.height = node.naturalHeight;
          const imageContext = runtimeVisualCanvasGetContext(
            imageCanvas,
            "2d",
            { willReadFrequently: true },
          );
          if (!imageContext) {
            return { visible, unverified: true, failureReason: "image-unreadable" };
          }
          runtimeVisualCanvasDrawImage(
            imageContext,
            node,
            0,
            0,
            node.naturalWidth,
            node.naturalHeight,
          );
          const imagePixels = runtimeVisualCanvasGetImageData(
            imageContext,
            0,
            0,
            node.naturalWidth,
            node.naturalHeight,
          ).data;
          runtimeVisualArrayPush(
            pieces,
            "image",
            String(node.naturalWidth),
            String(node.naturalHeight),
            reviewVisualPixelHash(imagePixels),
          );
        } catch {
          return { visible, unverified: true, failureReason: "tainted-image" };
        }
      }
      if (node.namespaceURI === "http://www.w3.org/2000/svg") {
        runtimeVisualArrayPush(
          pieces,
          "svg",
          runtimeVisualElementGetAttribute(node, "d") || "",
          runtimeVisualElementGetAttribute(node, "points") || "",
          runtimeVisualElementGetAttribute(node, "x") || "",
          runtimeVisualElementGetAttribute(node, "y") || "",
          runtimeVisualElementGetAttribute(node, "width") || "",
          runtimeVisualElementGetAttribute(node, "height") || "",
          style.fill,
          style.stroke,
          style.strokeWidth,
          style.opacity,
          style.filter,
          style.mask,
          style.clipPath,
        );
      }
      if (runtimeVisualPerformanceNow() - budget.startedAt > 1_500) {
        budget.failureReason = "global-time-budget";
        return { visible, unverified: true, failureReason: budget.failureReason };
      }
    }
    if (
      !visible
      && rootStyle.display !== "none"
      && rootStyle.visibility !== "hidden"
      && Number(rootStyle.opacity || 1) > 0
      && (rootRect.width <= 0 || rootRect.height <= 0)
    ) return { visible: false, unverified: true, failureReason: "hidden-context" };
    if (positionSensitive && stableParentRect) runtimeVisualArrayPush(
      pieces,
      "local-position",
      String(Math.round((rootRect.left - stableParentRect.left) * 2) / 2),
      String(Math.round((rootRect.top - stableParentRect.top) * 2) / 2),
    );
    return { visible, fingerprint: reviewVisualHash(pieces) };
  };
  let reviewVisualObservationSequence = 0;
  const renderReviewCommentHighlight = (stableIds) => {
    document.querySelector('[data-pageroot-review-comment-highlight-layer]')?.remove();
    if (!stableIds.length) return;
    const layer = document.createElement("div");
    layer.setAttribute("data-pageroot-review-comment-highlight-layer", "true");
    layer.style.cssText = "position:absolute;inset:0;z-index:2147483000;pointer-events:none";
    runtimeVisualArrayForEach(stableIds, (stableId) => {
      const element = reviewVisualStableElement(stableId);
      if (!element) return;
      const rect = runtimeVisualElementGetBoundingClientRect(element);
      if (rect.width <= 0 || rect.height <= 0) return;
      const box = document.createElement("div");
      box.setAttribute("data-pageroot-review-comment-highlight", "true");
      box.style.cssText = "position:absolute;border:2px solid #6258d6;border-radius:6px;background:rgb(98 88 214 / 10%);box-shadow:0 0 0 2px rgb(255 255 255 / 78%);pointer-events:none";
      box.style.left = Math.max(0, rect.left + scrollX - 3) + "px";
      box.style.top = Math.max(0, rect.top + scrollY - 3) + "px";
      box.style.width = Math.max(0, rect.width + 6) + "px";
      box.style.height = Math.max(0, rect.height + 6) + "px";
      layer.append(box);
    });
    if (layer.childElementCount) document.documentElement.append(layer);
  };
  if (reviewVisualChannel) reviewVisualChannel.port1.onmessage = (event) => {
    const request = event.data;
    if (request?.type === "comment-highlight" && request.sessionId === sessionId
      && request.side === side && Array.isArray(request.stableIds)) {
      renderReviewCommentHighlight(request.active === true
        ? request.stableIds.slice(0, 32)
        : []);
      return;
    }
    if (request?.type === "verdicts" && request.sessionId === sessionId && request.side === side
      && Array.isArray(request.changed)) {
      runtimeVisualQueryElements('[data-pageroot-review-confirmed="true"]').forEach((element) => {
        runtimeVisualElementRemoveAttribute(element, "data-pageroot-review-confirmed");
      });
      runtimeVisualQueryElements('[data-pageroot-review-runtime-visual-marker="true"]').forEach((element) => {
        runtimeVisualElementRemoveAttribute(element, "data-pageroot-review-marker");
        runtimeVisualElementRemoveAttribute(element, "data-pageroot-review-marker-types");
        runtimeVisualElementRemoveAttribute(element, "data-pageroot-review-summary");
        runtimeVisualElementRemoveAttribute(element, "data-pageroot-review-runtime-visual-marker");
      });
      const nextConfirmed = new RuntimeVisualSet();
      request.changed.forEach((candidate) => {
        const changeId = safeKey(candidate?.id);
        if (!changeId) return;
        runtimeVisualSetAdd(nextConfirmed, changeId);
        const stableId = RuntimeVisualString(candidate?.stableId || "");
        const element = reviewVisualStableElement(stableId);
        if (!element) return;
        if (runtimeVisualElementGetAttribute(element, "data-pageroot-review-marker")) return;
        runtimeVisualElementSetAttribute(element, "data-pageroot-review-marker", changeId);
        runtimeVisualElementSetAttribute(element, "data-pageroot-review-marker-types", candidate.types?.join(" ") || "structure");
        runtimeVisualElementSetAttribute(element, "data-pageroot-review-summary", "元素变化");
        runtimeVisualElementSetAttribute(element, "data-pageroot-review-active", "true");
        runtimeVisualElementSetAttribute(element, "data-pageroot-review-runtime-visual-marker", "true");
      });
      runtimeVisualQueryElements("[data-pageroot-review-marker]").forEach((element) => {
        const changeId = safeKey(runtimeVisualElementGetAttribute(
          element,
          "data-pageroot-review-marker",
        ));
        if (runtimeVisualSetHas(nextConfirmed, changeId)) {
          runtimeVisualElementSetAttribute(element, "data-pageroot-review-confirmed", "true");
        }
      });
      confirmedVisualChangeIds = nextConfirmed;
      scheduleOverlayRender();
      return;
    }
    if (!request || request.type !== "observe" || request.sessionId !== sessionId || request.side !== side
      || !Array.isArray(request.candidates) || typeof request.sourceHash !== "string") return;
    const observationSequence = ++reviewVisualObservationSequence;
    const candidates = request.candidates;
    const sample = (complete) => {
      const observations = [];
      const budget = {
        startedAt: runtimeVisualPerformanceNow(),
        nodes: 0,
        pixels: 0,
        failureReason: "",
        animations: runtimeVisualDocumentGetAnimations(document),
      };
      let candidateIndex = 0;
      const sampleBatch = () => {
        const batchEnd = candidateIndex + 24;
        while (candidateIndex < candidates.length && candidateIndex < batchEnd) {
          const candidate = candidates[candidateIndex];
          const stableId = RuntimeVisualString(candidate?.stableId || "");
          const element = reviewVisualStableElement(stableId);
          const expectedPresent = candidate?.present === true;
          const result = element
            ? reviewVisualFingerprint(element, candidate?.positionSensitive === true, budget)
            : expectedPresent
              ? { visible: false, unverified: true, failureReason: "missing-runtime-host" }
              : { visible: false, fingerprint: "absent" };
          runtimeVisualArrayPush(observations, {
            sessionId,
            side,
            sourceHash: request.sourceHash,
            generation: request.generation,
            stableId,
            ...result,
          });
          candidateIndex += 1;
        }
        if (candidateIndex < candidates.length) {
          runtimeVisualRequestAnimationFrame(sampleBatch);
          return;
        }
        complete(observations);
      };
      sampleBatch();
    };
    sample((first) => {
      runtimeVisualSetTimeout(() => runtimeVisualRequestAnimationFrame(() => (
        runtimeVisualRequestAnimationFrame(() => {
          if (observationSequence !== reviewVisualObservationSequence) return;
          sample((second) => {
            if (observationSequence !== reviewVisualObservationSequence) return;
            const observations = runtimeVisualArrayMap(second, (current, index) => {
              const previous = first[index];
              if (
                !previous
                || previous.unverified
                || current.unverified
                || previous.visible !== current.visible
                || previous.fingerprint !== current.fingerprint
              ) return {
                ...current,
                fingerprint: undefined,
                unverified: true,
                failureReason: current.failureReason || previous?.failureReason || "unstable",
              };
              return current;
            });
            reviewVisualChannel.port1.postMessage({ type: "observations", observations });
          });
        })
      )), 650);
    });
  };
  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
  const documentHeight = () => Math.max(
    document.documentElement.scrollHeight,
    document.body?.scrollHeight || 0,
  );
  // Scrollbars shrink the layout viewport below the window height: a vertical
  // bar narrows the page enough to grow a horizontal bar, and the visible
  // height then trails the window height by that bar. Measuring the scroll
  // range against the window height reports a maximum short of where native
  // scrolling actually lands, and every clamp built on it fights the browser:
  // at the page end the synchronized page gets yanked backwards.
  const visibleHeight = () => {
    const scroller = document.scrollingElement || document.documentElement;
    return scroller?.clientHeight || innerHeight;
  };
  const maximumScrollTop = () => Math.max(0, documentHeight() - visibleHeight());
  const safeKey = (value) => {
    const source = RuntimeVisualString(value || "");
    let result = "";
    for (let index = 0; index < source.length; index += 1) {
      const code = runtimeVisualStringCharCodeAt(source, index);
      if (
        (code >= 0x30 && code <= 0x39)
        || (code >= 0x41 && code <= 0x5a)
        || (code >= 0x61 && code <= 0x7a)
        || code === 0x2d
      ) result += source[index];
    }
    return result;
  };
  const safePanelPath = (value) => [...new Set(
    (Array.isArray(value) ? value : String(value || "").split(/\s+/))
      .map(safeKey)
      .filter(Boolean),
  )];
  const safeStableId = (value) => {
    const stableId = RuntimeVisualString(value || "");
    return runtimeVisualRegExpExec(/^pr1_[0-9a-f]{32}$/iu, stableId) !== null
      ? stableId
      : "";
  };
  const safeRevealSteps = (value) => {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    return value.flatMap((candidate) => {
      if (!candidate || typeof candidate !== "object") return [];
      if (candidate.kind === "panel") {
        const key = safeKey(candidate.key);
        const identity = "panel:" + key;
        if (!key || seen.has(identity)) return [];
        seen.add(identity);
        return [{ kind: "panel", key }];
      }
      if (candidate.kind === "details") {
        const stableId = safeStableId(candidate.stableId);
        const identity = "details:" + stableId;
        if (!stableId || seen.has(identity)) return [];
        seen.add(identity);
        return [{ kind: "details", stableId }];
      }
      return [];
    });
  };
  const runtimeVisualSourceBoxAttributes = ${JSON.stringify(REVIEW_COMMENT_BINDING_SOURCE_BOX_ATTRIBUTES)};
  const runtimeVisualIdentityAttributeLimit = ${REVIEW_BOOTSTRAP_IDENTITY_ATTRIBUTE_LIMIT};
  const reviewCommentSourceNodeIdPattern = /^element:\d+:\d+:[a-z][a-z0-9:-]{0,127}$/iu;
  const safeReviewCommentSourceNodeId = (value) => {
    const sourceNodeId = RuntimeVisualString(value || "");
    return sourceNodeId.length <= 256
      && runtimeVisualRegExpExec(reviewCommentSourceNodeIdPattern, sourceNodeId) !== null
      ? sourceNodeId
      : "";
  };
  const runtimeVisualSourceBoxSignature = (host) => runtimeVisualStringify(
    runtimeVisualArrayMap(
      runtimeVisualSourceBoxAttributes,
      (attribute) => [attribute, runtimeVisualElementGetAttribute(host, attribute)],
    ),
  );
  const runtimeVisualDocumentRoot = document.documentElement;
  const runtimeVisualInitialBindingPath = (value) => {
    if (!runtimeVisualArrayIsArray(value) || value.length > 256) return null;
    const path = [];
    for (let index = 0; index < value.length; index += 1) {
      const part = value[index];
      if (
        typeof part !== "number"
        || part < 0
        || part > 1000000
        || runtimeVisualMathFloor(part) !== part
      ) return null;
      runtimeVisualArrayPush(path, part);
    }
    return path;
  };
  const runtimeVisualInitialBindingPathElement = (rawPath) => {
    const path = runtimeVisualInitialBindingPath(rawPath);
    if (!path || !runtimeVisualIsInstance(RuntimeVisualElement, runtimeVisualDocumentRoot)) {
      return null;
    }
    let element = runtimeVisualDocumentRoot;
    for (let index = 0; index < path.length; index += 1) {
      const children = runtimeVisualElementChildren(element);
      const childIndex = path[index];
      if (childIndex >= runtimeVisualHtmlCollectionLength(children)) return null;
      const child = runtimeVisualHtmlCollectionItem(children, childIndex);
      if (!runtimeVisualIsInstance(RuntimeVisualElement, child)) return null;
      element = child;
    }
    return element;
  };
  const runtimeVisualInitialBindingPathMatches = (element, binding) => (
    runtimeVisualInitialBindingPathElement(binding?.path) === element
  );
  const runtimeVisualInitialBindingIdentityAttributes = (binding) => {
    const runtimeVisualBindingAttributeNamePattern = /^[a-z_:][a-z0-9:._-]{0,127}$/iu;
    const runtimeVisualOwnedAttributeNamePattern = /^data-pageroot-/iu;
    const rawAttributes = binding?.identityAttributes;
    if (
      !runtimeVisualArrayIsArray(rawAttributes)
      || rawAttributes.length > runtimeVisualIdentityAttributeLimit
    ) return null;
    const attributes = [];
    for (let index = 0; index < rawAttributes.length; index += 1) {
      const rawAttribute = rawAttributes[index];
      if (!runtimeVisualArrayIsArray(rawAttribute) || rawAttribute.length !== 2) return null;
      const name = RuntimeVisualString(rawAttribute[0] || "");
      const value = RuntimeVisualString(rawAttribute[1] || "");
      const ownedAttribute = runtimeVisualRegExpExec(
        runtimeVisualOwnedAttributeNamePattern,
        name,
      ) !== null;
      if (
        runtimeVisualRegExpExec(runtimeVisualBindingAttributeNamePattern, name) === null
        || (
          ownedAttribute
          && runtimeVisualStringToLowerCase(name) !== "data-pageroot-id"
        )
        || value.length > 1024
      ) return null;
      runtimeVisualArrayPush(attributes, [name, value]);
    }
    return attributes;
  };
  const runtimeVisualInitialBindingIgnoresIdentityText = (
    identityAttributes,
    identityText,
  ) => {
    if (!identityText) return true;
    if (!identityAttributes?.length) return false;
    // A class-only fingerprint is intentionally text-sensitive. Class names
    // are commonly shared by sibling comment targets, so dropping the frozen
    // text would make the final uniqueness pass bind an arbitrary sibling.
    return !identityAttributes.every(([name]) => (
      runtimeVisualStringToLowerCase(RuntimeVisualString(name)) === "class"
    ));
  };
  const runtimeVisualInitialBindingMatches = (
    element,
    binding,
    ignoreIdentityText = false,
  ) => {
    if (!runtimeVisualIsInstance(RuntimeVisualElement, element)) return false;
    const tagName = RuntimeVisualString(binding?.tagName || "");
    const sourceBoxSignature = RuntimeVisualString(binding?.sourceBoxSignature || "");
    const identityAttributes = runtimeVisualInitialBindingIdentityAttributes(binding);
    const identityText = typeof binding?.identityText === "string"
      ? RuntimeVisualString(binding.identityText)
      : "";
    if (
      !(
        tagName.length > 0
        && tagName.length <= 128
        && sourceBoxSignature.length > 0
        && sourceBoxSignature.length <= 4096
        && identityAttributes !== null
        && identityText.length <= 1024
        && runtimeVisualElementTagName(element) === tagName
      )
    ) return false;
    for (let index = 0; index < identityAttributes.length; index += 1) {
      const [name, value] = identityAttributes[index];
      if (runtimeVisualElementGetAttribute(element, name) !== value) return false;
    }
    return ignoreIdentityText
      || !identityText
      || runtimeVisualNormalizeText(runtimeVisualNodeTextContent(element) || "")
        .slice(0, 1024) === identityText;
  };
  const runtimeVisualInitialBindingHasFingerprint = (binding) => {
    const attributes = runtimeVisualInitialBindingIdentityAttributes(binding);
    return runtimeVisualBoolean(
      attributes?.length
      || (typeof binding?.identityText === "string" && binding.identityText.length),
    );
  };
  const runtimeVisualInitialBindingSourceBoxMatches = (element, binding) => (
    RuntimeVisualString(binding?.sourceBoxSignature || "")
      === runtimeVisualSourceBoxSignature(element)
  );
  const runtimeVisualInitialBindingElement = (binding, useFrozenPath = true) => {
    const pathElement = runtimeVisualInitialBindingPathElement(binding?.path);
    const identityAttributes = runtimeVisualInitialBindingIdentityAttributes(binding);
    const identityText = typeof binding?.identityText === "string"
      ? RuntimeVisualString(binding.identityText)
      : "";
    if (useFrozenPath && runtimeVisualInitialBindingMatches(
      pathElement,
      binding,
      runtimeVisualInitialBindingIgnoresIdentityText(identityAttributes, identityText),
    )) return pathElement;
    if (runtimeVisualDocumentReadyState(document) === "loading") return null;
    if (!runtimeVisualInitialBindingHasFingerprint(binding)) return null;
    const matching = [];
    runtimeVisualArrayForEach(runtimeVisualQueryElements("*"), (element) => {
      if (
        matching.length < 2
        && runtimeVisualInitialBindingMatches(
          element,
          binding,
          runtimeVisualInitialBindingIgnoresIdentityText(identityAttributes, identityText),
        )
      ) runtimeVisualArrayPush(matching, element);
    });
    return matching.length === 1 ? matching[0] : null;
  };
  const createPrivateInitialBindingRegistry = (
    initialBindings,
    bindingId,
  ) => {
    const identityElements = new RuntimeVisualMap();
    const deferredBindings = new RuntimeVisualMap();
    const invalidBindingIds = new RuntimeVisualSet();
    const bindingById = new RuntimeVisualMap();
    runtimeVisualArrayForEach(initialBindings, (binding) => {
      const id = bindingId(binding);
      if (!id) return;
      if (runtimeVisualMapHas(bindingById, id)) {
        runtimeVisualSetAdd(invalidBindingIds, id);
        return;
      }
      runtimeVisualMapSet(bindingById, id, binding);
    });
    const initialBindingForPath = (element, binding) => {
      let matchingBinding = null;
      runtimeVisualArrayForEach(initialBindings, (candidate) => {
        const candidateId = bindingId(candidate);
        if (
          matchingBinding
          || candidate === binding
          || !candidateId
          || runtimeVisualSetHas(invalidBindingIds, candidateId)
          || !runtimeVisualInitialBindingPathMatches(element, candidate)
          || !runtimeVisualInitialBindingMatches(element, candidate, true)
          || !runtimeVisualInitialBindingSourceBoxMatches(element, candidate)
        ) return;
        matchingBinding = candidate;
      });
      return matchingBinding;
    };
    const capture = (binding, observedElement = null) => {
      const id = bindingId(binding);
      if (!id || runtimeVisualSetHas(invalidBindingIds, id)) return;
      if (observedElement !== null) {
        const identityAttributes = runtimeVisualInitialBindingIdentityAttributes(binding);
        const identityText = typeof binding?.identityText === "string"
          ? RuntimeVisualString(binding.identityText)
          : "";
        const pathMatches = runtimeVisualInitialBindingPathMatches(observedElement, binding);
        const hasFingerprint = runtimeVisualInitialBindingHasFingerprint(binding);
        if (
          pathMatches
          && !hasFingerprint
          && runtimeVisualInitialBindingMatches(observedElement, binding, true)
        ) {
          const existing = runtimeVisualMapGet(identityElements, id);
          if (existing && existing !== observedElement) {
            runtimeVisualSetAdd(invalidBindingIds, id);
            return;
          }
          if (!existing) runtimeVisualMapSet(identityElements, id, observedElement);
          return;
        }
        // A path-only binding cannot distinguish a same-tag parser decoy after
        // its frozen path shifts. Keep that private identity unavailable.
        if (
          !pathMatches
          && !hasFingerprint
          && runtimeVisualInitialBindingMatches(observedElement, binding, true)
          && runtimeVisualInitialBindingSourceBoxMatches(observedElement, binding)
        ) {
          if (initialBindingForPath(observedElement, binding)) return;
          runtimeVisualSetAdd(invalidBindingIds, id);
          return;
        }
        if (!runtimeVisualInitialBindingMatches(
          observedElement,
          binding,
          runtimeVisualInitialBindingIgnoresIdentityText(identityAttributes, identityText),
        )) return;
        runtimeVisualMapSet(deferredBindings, binding, true);
        return;
      }
      const element = runtimeVisualInitialBindingElement(
        binding,
        !runtimeVisualMapHas(deferredBindings, binding),
      );
      if (!element) return;
      const existing = runtimeVisualMapGet(identityElements, id);
      if (existing && existing !== element) {
        runtimeVisualSetAdd(invalidBindingIds, id);
        return;
      }
      if (!existing) runtimeVisualMapSet(identityElements, id, element);
    };
    const captureAll = (observedElement = null) => runtimeVisualArrayForEach(
      initialBindings,
      (binding) => capture(binding, observedElement),
    );
    const captureDeferred = () => runtimeVisualArrayForEach(initialBindings, (binding) => {
      if (runtimeVisualMapHas(deferredBindings, binding)) capture(binding);
    });
    return {
      identityElements,
      deferredBindings,
      invalidBindingIds,
      captureAll,
      captureDeferred,
    };
  };
  const reviewCommentBindingRegistry = createPrivateInitialBindingRegistry(
    reviewCommentInitialBindings,
    (binding) => safeReviewCommentSourceNodeId(binding?.sourceNodeId),
  );
  const reviewCommentIdentityElements = reviewCommentBindingRegistry.identityElements;
  const reviewCommentDeferredBindings = reviewCommentBindingRegistry.deferredBindings;
  const reviewCommentInvalidSourceNodeIds = reviewCommentBindingRegistry.invalidBindingIds;
  const reviewVisualAllowedStableIds = new RuntimeVisualSet(reviewVisualInitialStableIds);
  const reviewVisualIdentityElements = new RuntimeVisualMap();
  const reviewVisualInvalidStableIds = new RuntimeVisualSet();
  const captureReviewVisualElement = (element, rawStableId = "") => {
    if (!runtimeVisualIsInstance(RuntimeVisualElement, element)) return;
    const stableId = RuntimeVisualString(
      rawStableId || runtimeVisualElementGetAttribute(element, "data-pageroot-id") || "",
    );
    if (!runtimeVisualSetHas(reviewVisualAllowedStableIds, stableId)) return;
    const existing = runtimeVisualMapGet(reviewVisualIdentityElements, stableId);
    if (existing && existing !== element) {
      runtimeVisualSetAdd(reviewVisualInvalidStableIds, stableId);
      return;
    }
    if (!existing) runtimeVisualMapSet(reviewVisualIdentityElements, stableId, element);
  };
  const captureReviewVisualTree = (node) => {
    if (!runtimeVisualIsInstance(RuntimeVisualElement, node)) return;
    captureReviewVisualElement(node);
    runtimeVisualArrayForEach(
      runtimeVisualElementQuerySelectorAll(node, "[data-pageroot-id]"),
      (element) => captureReviewVisualElement(element),
    );
  };
  runtimeVisualArrayForEach(
    runtimeVisualQueryElements("[data-pageroot-id]"),
    (element) => captureReviewVisualElement(element),
  );
  let privateInitialBindingsBootstrapped = false;
  let privateInitialBindingsClosed = false;
  const captureInitialBindings = (records = []) => {
    if (privateInitialBindingsClosed) return;
    if (!privateInitialBindingsBootstrapped) {
      privateInitialBindingsBootstrapped = true;
      reviewCommentBindingRegistry.captureAll();
    }
    runtimeVisualArrayForEach(records, (record) => {
      const recordType = runtimeVisualMutationRecordType(record);
      if (recordType === "attributes") {
        captureReviewVisualElement(
          runtimeVisualMutationRecordTarget(record),
          runtimeVisualMutationRecordOldValue(record),
        );
        captureReviewVisualElement(runtimeVisualMutationRecordTarget(record));
        return;
      }
      if (recordType !== "childList") return;
      const nodeLists = [
        runtimeVisualMutationRecordAddedNodes(record),
        runtimeVisualMutationRecordRemovedNodes(record),
      ];
      for (let listIndex = 0; listIndex < nodeLists.length; listIndex += 1) {
        const nodes = nodeLists[listIndex];
        const nodeCount = runtimeVisualNodeListLength(nodes);
        for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
          const node = runtimeVisualNodeListItem(nodes, nodeIndex);
          if (!runtimeVisualIsInstance(RuntimeVisualElement, node)) continue;
          captureReviewVisualTree(node);
          const addedElements = [node];
          runtimeVisualArrayForEach(
            runtimeVisualElementQuerySelectorAll(node, "*"),
            (element) => runtimeVisualArrayPush(addedElements, element),
          );
          runtimeVisualArrayForEach(addedElements, (element) => {
            reviewCommentBindingRegistry.captureAll(element);
          });
        }
      }
    });
  };
  const initialBindingObserver = reviewCommentInitialBindings.length || reviewVisualInitialStableIds.length
    ? new RuntimeVisualMutationObserver(captureInitialBindings)
    : null;
  if (initialBindingObserver && runtimeVisualDocumentRoot) {
    captureInitialBindings();
    runtimeVisualMutationObserverObserve(
      initialBindingObserver,
      runtimeVisualDocumentRoot,
      {
        subtree: true,
        childList: true,
        attributes: true,
        attributeOldValue: true,
        attributeFilter: ["data-pageroot-id"],
      },
    );
  }
  const drainInitialBindings = () => {
    if (!initialBindingObserver || privateInitialBindingsClosed) return;
    captureInitialBindings(runtimeVisualMutationObserverTakeRecords(initialBindingObserver));
  };
  const closeInitialBindings = () => {
    if (!initialBindingObserver || privateInitialBindingsClosed) return;
    drainInitialBindings();
    reviewCommentBindingRegistry.captureDeferred();
    runtimeVisualMutationObserverDisconnect(initialBindingObserver);
    privateInitialBindingsClosed = true;
  };
  const reviewVisualStableElement = (rawStableId) => {
    const stableId = RuntimeVisualString(rawStableId || "");
    if (
      !runtimeVisualSetHas(reviewVisualAllowedStableIds, stableId)
      || runtimeVisualSetHas(reviewVisualInvalidStableIds, stableId)
    ) return null;
    const element = runtimeVisualMapGet(reviewVisualIdentityElements, stableId);
    if (
      !element
      || !runtimeVisualNodeIsConnected(element)
      || runtimeVisualElementGetAttribute(element, "data-pageroot-id") !== stableId
    ) return null;
    const matches = runtimeVisualQueryElements(
      "[data-pageroot-id=\"" + stableId + "\"]",
    );
    return matches.length === 1 && matches[0] === element ? element : null;
  };
  const isSafePanelControl = (element) => element instanceof Element && element.matches(
    '[data-pageroot-review-panel-control="true"]',
  );
  const panelControlForKey = (panelKey) => [...document.querySelectorAll(
    '[data-pageroot-review-panel-control="true"][data-pageroot-review-panel-key]',
  )].find((candidate) => candidate.getAttribute("data-pageroot-review-panel-key") === panelKey) || null;
  const panelForKey = (panelKey) => [...document.querySelectorAll(
    '[data-pageroot-review-panel-container="true"][data-pageroot-review-panel-key]',
  )].find((candidate) => (
    candidate.getAttribute("data-pageroot-review-panel-key") === panelKey
  )) || null;
  const actionForKey = (actionKey) => [...document.querySelectorAll(
    '[data-pageroot-review-action-key]',
  )].find((candidate) => (
    candidate.getAttribute("data-pageroot-review-action-key") === actionKey
  )) || null;
  const scheduleOverlayRender = () => {
    if (projectionTransitioning || !initialProjectionCommitted) return;
    cancelAnimationFrame(overlayFrame);
    overlayFrame = requestAnimationFrame(renderReviewOverlays);
  };
  const reportReviewCommentLayouts = () => {
    if (projectionTransitioning) return;
    const commentLayouts = [];
    if (side === "before") {
      for (const commentTarget of reviewCommentTargets) {
        const key = safeKey(commentTarget?.key);
        if (!key) continue;
        if (commentTarget?.global === true) {
          runtimeVisualArrayPush(commentLayouts, {
            key,
            left: 22,
            top: 22,
            viewportLeft: 22,
            viewportTop: 22,
            global: true,
          });
          continue;
        }
        let target = commentTarget?.element || null;
        if (target && !runtimeVisualNodeIsConnected(target)) continue;
        if (!target) {
          let matches;
          try {
            matches = runtimeVisualDocumentQuerySelectorAll(
              document,
              RuntimeVisualString(commentTarget?.selector || ""),
            );
          } catch {
            continue;
          }
          if (runtimeVisualNodeListLength(matches) !== 1) continue;
          target = runtimeVisualNodeListItem(matches, 0);
        }
        if (!target) continue;
        const clientRects = runtimeVisualElementGetClientRects(target);
        const rects = [];
        for (let index = 0; index < runtimeVisualDomRectListLength(clientRects); index += 1) {
          const rect = runtimeVisualDomRectListItem(clientRects, index);
          if (rect && rect.width > 0 && rect.height > 0) runtimeVisualArrayPush(rects, rect);
        }
        if (!rects.length) continue;
        const firstRect = rects.reduce((current, rect) => (
          rect.top < current.top ? rect : current
        ));
        const right = Math.max(...rects.map((rect) => rect.right));
        runtimeVisualArrayPush(commentLayouts, {
          key,
          left: right + scrollX + 10,
          top: firstRect.top + scrollY + firstRect.height / 2,
          viewportLeft: right + 10,
          viewportTop: firstRect.top + firstRect.height / 2,
          global: false,
        });
      }
    }
    post("comment-layout", { commentLayouts });
  };
  const reportScrollGeometry = () => {
    if (projectionTransitioning) return;
    geometryRevision += 1;
    const anchors = [...document.querySelectorAll("[data-pageroot-outline-id]")]
      .flatMap((element) => {
        const rect = element.getBoundingClientRect();
        const id = safeKey(element.getAttribute("data-pageroot-outline-id"));
        if (!id || rect.width <= 0 || rect.height <= 0) return [];
        return [{ id, top: Math.max(0, scrollY + rect.top), height: rect.height }];
      });
    post("scroll-geometry", {
      scrollGeometry: {
        viewportHeight: innerHeight,
        maximumScroll: maximumScrollTop(),
        revision: geometryRevision,
        anchors,
      },
    });
  };
  const reportLayoutMetrics = () => {
    layoutReportFrame = 0;
    if (projectionTransitioning) return;
    reportScrollGeometry();
    reportReviewCommentLayouts();
  };
  const scheduleLayoutReport = (immediate = false) => {
    if (projectionTransitioning) return;
    clearTimeout(layoutReportTimer);
    const queueReport = () => {
      cancelAnimationFrame(layoutReportFrame);
      layoutReportFrame = requestAnimationFrame(reportLayoutMetrics);
    };
    if (immediate) queueReport();
    else layoutReportTimer = window.setTimeout(queueReport, 80);
  };
  const acceptReviewCommentTargets = (rawTargets) => {
    if (side !== "before" || !runtimeVisualArrayIsArray(rawTargets)) return;
    const targets = [];
    const seenKeys = new RuntimeVisualSet();
    runtimeVisualArrayForEach(rawTargets, (candidate) => {
      if (!candidate || typeof candidate !== "object") return;
      const key = safeKey(candidate.key);
      const global = candidate.global === true;
      const selector = global
        ? "body"
        : typeof candidate.selector === "string"
          ? candidate.selector
          : "";
      const rawSourceNodeId = typeof candidate.sourceNodeId === "string"
        ? candidate.sourceNodeId
        : "";
      const sourceNodeId = safeReviewCommentSourceNodeId(rawSourceNodeId);
      if (rawSourceNodeId && !sourceNodeId) return;
      const identityElement = sourceNodeId
        ? runtimeVisualMapGet(reviewCommentIdentityElements, sourceNodeId)
        : null;
      if (!key || runtimeVisualSetHas(seenKeys, key)) return;
      if (
        sourceNodeId
        && (
          !identityElement
          || runtimeVisualSetHas(reviewCommentInvalidSourceNodeIds, sourceNodeId)
          || !runtimeVisualIsInstance(RuntimeVisualElement, identityElement)
        )
      ) return;
      if (!global && !sourceNodeId && !selector) return;
      runtimeVisualSetAdd(seenKeys, key);
      runtimeVisualArrayPush(targets, {
        key,
        selector,
        global,
        ...(identityElement ? { element: identityElement } : {}),
      });
    });
    reviewCommentTargets = targets;
    scheduleLayoutReport(true);
  };
  if (reviewCommentChannel) {
    reviewCommentChannel.port1.onmessage = (event) => {
      const message = event.data;
      if (
        !message
        || message.source !== "pageroot-ai-review-comment-targets"
        || message.sessionId !== sessionId
        || message.side !== side
        || message.type !== "comment-targets"
      ) return;
      acceptReviewCommentTargets(message.reviewCommentTargets);
    };
    reviewCommentChannel.port1.start();
  }
  const renderTransitionMask = () => {
    document.querySelector('[data-pageroot-review-transition-mask]')?.remove();
    const mask = document.createElement("div");
    mask.setAttribute("data-pageroot-review-transition-mask", "true");
    mask.style.setProperty("width", Math.max(
      innerWidth,
      document.documentElement.scrollWidth,
      document.body?.scrollWidth || 0,
    ) + "px", "important");
    mask.style.setProperty("height", Math.max(innerHeight, documentHeight()) + "px", "important");
    const contextVisibility = clamp(Number(currentState.transparency ?? 18), 0, 100) / 100;
    mask.style.setProperty("opacity", String(Math.round((1 - contextVisibility) * 1000) / 1000), "important");
    document.body.append(mask);
  };
  const beginProjectionTransition = (rawEpoch) => {
    const requestedEpoch = Number(rawEpoch || 0);
    if (
      Number.isFinite(requestedEpoch)
      && requestedEpoch > 0
      && requestedEpoch < projectionEpoch
    ) return projectionEpoch;
    projectionEpoch = Number.isFinite(requestedEpoch) && requestedEpoch > 0
      ? requestedEpoch
      : projectionEpoch + 1;
    projectionTransitioning = true;
    clearTimeout(presentationReadyTimer);
    clearTimeout(layoutReportTimer);
    cancelAnimationFrame(overlayFrame);
    cancelAnimationFrame(layoutReportFrame);
    document.querySelector('[data-pageroot-review-projection-layer]')?.remove();
    document.documentElement.dataset.pagerootReviewTransitioning = "true";
    renderTransitionMask();
    post("comment-layout", { commentLayouts: [] });
    return projectionEpoch;
  };
  const schedulePresentationReady = (rawEpoch) => {
    const epoch = Number(rawEpoch || projectionEpoch);
    if (!projectionTransitioning || epoch !== projectionEpoch) return;
    clearTimeout(presentationReadyTimer);
    presentationReadyTimer = window.setTimeout(() => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!projectionTransitioning || epoch !== projectionEpoch) return;
        post("presentation-ready", { presentationEpoch: epoch });
      }));
    }, 80);
  };
  const commitProjectionTransition = (rawEpoch) => {
    const epoch = Number(rawEpoch || 0);
    if (epoch && epoch !== projectionEpoch) return;
    clearTimeout(presentationReadyTimer);
    projectionTransitioning = false;
    document.documentElement.removeAttribute("data-pageroot-review-transitioning");
    document.querySelector('[data-pageroot-review-transition-mask]')?.remove();
    renderReviewOverlays();
    scheduleLayoutReport(true);
  };
  const applyPanelGroupState = (panelKey) => {
    const panel = panelForKey(panelKey);
    const groupKey = panel?.getAttribute("data-pageroot-review-panel-group") || "";
    if (!groupKey) return;
    const members = [...document.querySelectorAll(
      '[data-pageroot-review-panel-group="' + groupKey + '"]',
    )];
    const stateClasses = [...new Set(members.flatMap((member) => String(
      member.getAttribute("data-pageroot-review-panel-active-classes") || "",
    ).split(/\s+/).filter(Boolean)))];
    members.forEach((candidate) => {
      const active = candidate.getAttribute("data-pageroot-review-panel-key") === panelKey;
      stateClasses.forEach((className) => candidate.classList.toggle(className, active));
      if (isSafePanelControl(candidate)) {
        candidate.setAttribute("aria-selected", active ? "true" : "false");
        candidate.setAttribute("aria-expanded", active ? "true" : "false");
        if (candidate.hasAttribute("tabindex") || candidate.getAttribute("role") === "tab") {
          candidate.tabIndex = active ? 0 : -1;
        }
      } else if (candidate.getAttribute("data-pageroot-review-panel-container") === "true") {
        candidate.toggleAttribute("hidden", !active);
        candidate.setAttribute("aria-hidden", active ? "false" : "true");
      }
    });
  };
  const activatePanelKey = (rawPanelKey) => {
    const panelKey = safeKey(rawPanelKey);
    if (!panelKey) return;
    const control = panelControlForKey(panelKey);
    const panel = panelForKey(panelKey);
    const alreadyPresented = panel instanceof HTMLElement
      && !panel.hidden
      && panel.getAttribute("aria-hidden") !== "true"
      && getComputedStyle(panel).display !== "none"
      && getComputedStyle(panel).visibility !== "hidden"
      && panel.getClientRects().length > 0;
    if (control instanceof HTMLElement && !alreadyPresented) {
      mirroringPanel = true;
      control.click();
      queueMicrotask(() => { mirroringPanel = false; });
    }
    applyPanelGroupState(panelKey);
  };
  const activatePanelPath = (rawPath) => {
    const panelPath = safePanelPath(rawPath);
    panelPath.forEach(activatePanelKey);
    return panelPath;
  };
  const activatePresentation = (rawSteps) => {
    const steps = safeRevealSteps(rawSteps);
    steps.forEach((step) => {
      if (step.kind === "panel") {
        activatePanelKey(step.key);
        return;
      }
      const details = document.querySelector(
        'details[data-pageroot-id="' + step.stableId + '"]',
      );
      if (details instanceof HTMLDetailsElement) details.open = true;
    });
    return steps;
  };
  const mirrorAction = (message) => {
    const actionKey = safeKey(message.actionKey);
    if (!actionKey) return;
    let action = actionForKey(actionKey);
    const actionActivatesRequestedPanel = action
      && isSafePanelControl(action)
      && action.getAttribute("data-pageroot-review-panel-key") === safeKey(message.panelKey);
    if (message.panelPath?.length) activatePanelPath(message.panelPath);
    else if (message.panelKey && !actionActivatesRequestedPanel) activatePanelKey(message.panelKey);
    action = actionForKey(actionKey);
    if (!(action instanceof HTMLElement) || action.matches(":disabled")) {
      post("action-applied", { actionKey, applied: false });
      return;
    }
    mirroringAction = true;
    try {
      if (message.actionType === "control-state") {
        if (action instanceof HTMLInputElement) {
          if (typeof message.checked === "boolean") action.checked = message.checked;
          if (typeof message.value === "string") action.value = message.value;
        } else if (action instanceof HTMLSelectElement || action instanceof HTMLTextAreaElement) {
          if (typeof message.value === "string") action.value = message.value;
        }
        action.dispatchEvent(new Event("input", { bubbles: true }));
        action.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        action.click();
      }
    } finally {
      queueMicrotask(() => {
        mirroringAction = false;
        scheduleOverlayRender();
        requestAnimationFrame(() => post("action-applied", { actionKey, applied: true }));
      });
    }
  };
  const matchingPanelControl = (panel) => {
    const panelKey = panel.getAttribute("data-pageroot-review-panel-key") || "";
    if (panelKey) return panelControlForKey(panelKey);
    const panelId = panel.id
      || panel.getAttribute("data-page")
      || panel.getAttribute("data-tab-panel")
      || "";
    if (!panelId) return null;
    return [...document.querySelectorAll('[data-pageroot-review-panel-control="true"]')]
      .find((candidate) => (
        candidate.getAttribute("aria-controls") === panelId
        || candidate.getAttribute("data-p") === panelId
        || candidate.getAttribute("data-tab") === panelId
        || (panelId.startsWith("p") && candidate.getAttribute("data-p") === panelId.slice(1))
      )) || null;
  };
  const revealTarget = (target, requestedPanelPath) => {
    if (requestedPanelPath?.length && typeof requestedPanelPath[0] === "object") {
      activatePresentation(requestedPanelPath);
    } else if (requestedPanelPath?.length) activatePanelPath(requestedPanelPath);
    else if (typeof requestedPanelPath === "string") activatePanelKey(requestedPanelPath);
    if (!target) return;
    const details = target.closest("details");
    if (details) details.open = true;
    const ancestors = [];
    let candidate = target;
    while (candidate && candidate !== document.body) {
      if (
        candidate.hasAttribute("data-pageroot-review-panel-key")
        || candidate.hasAttribute("hidden")
        || candidate.getAttribute("aria-hidden") === "true"
        || candidate.getAttribute("role") === "tabpanel"
        || candidate.hasAttribute("data-tab-panel")
      ) ancestors.unshift(candidate);
      candidate = candidate.parentElement;
    }
    ancestors.forEach((panel) => {
      const panelKey = panel.getAttribute("data-pageroot-review-panel-key") || "";
      if (panelKey) activatePanelKey(panelKey);
      const control = matchingPanelControl(panel);
      if (!panelKey && control instanceof HTMLElement) {
        mirroringPanel = true;
        control.click();
        queueMicrotask(() => { mirroringPanel = false; });
      }
      if (panel.hasAttribute("hidden")) panel.removeAttribute("hidden");
      if (panel.getAttribute("aria-hidden") === "true") panel.setAttribute("aria-hidden", "false");
      if (control) {
        control.setAttribute("aria-selected", "true");
        control.setAttribute("aria-expanded", "true");
      }
    });
  };
  const recordFocusScrollCommand = (commandId, top = scrollY, left = scrollX) => {
    const maximumScroll = maximumScrollTop();
    const resolvedTop = clamp(Number(top || 0), 0, maximumScroll);
    const resolvedLeft = Math.max(0, Number(left || 0));
    activeScrollCommand = { commandId, top: resolvedTop, left: resolvedLeft };
    return activeScrollCommand;
  };
  const scrollToReviewRect = (rect, behavior = "auto") => {
    if (!rect || rect.height <= 0 || !Number.isFinite(rect.top)) return false;
    const token = "focus-" + Date.now() + "-" + Math.random();
    const top = clamp(
      scrollY + rect.top - Math.max(18, innerHeight * .12),
      0,
      maximumScrollTop(),
    );
    const command = recordFocusScrollCommand(token, top, scrollX);
    scrollTo({ top: command.top, left: command.left, behavior });
    return true;
  };
  const scrollIntoReviewTarget = (target, behavior = "auto") => {
    const token = "focus-" + Date.now() + "-" + Math.random();
    target.scrollIntoView({ block: "start", behavior });
    recordFocusScrollCommand(token);
  };
  const anchorTextNodes = (anchor) => {
    const ownerId = anchor.getAttribute("data-pageroot-review-geometry-owner") || "";
    const nodes = [];
    const walker = document.createTreeWalker(anchor, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const parent = node.parentElement;
      let nestedOwner = parent;
      let crossesOwner = false;
      while (nestedOwner && nestedOwner !== anchor) {
        const candidateOwner = nestedOwner.getAttribute("data-pageroot-review-geometry-owner") || "";
        if (
          candidateOwner
          && candidateOwner !== ownerId
          && !nestedOwner.hasAttribute("data-pageroot-review-text")
        ) {
          crossesOwner = true;
          break;
        }
        nestedOwner = nestedOwner.parentElement;
      }
      if (
        parent
        && !crossesOwner
        && parent.namespaceURI === "http://www.w3.org/1999/xhtml"
        && !parent.closest("script, style, noscript, template, [data-pageroot-review-projection-layer]")
      ) nodes.push(node);
      node = walker.nextNode();
    }
    return nodes;
  };
  const collapsedAnchorRect = (anchor, changeId) => {
    if (anchor.getAttribute("data-pageroot-review-anchor-change") !== changeId) return null;
    const encoded = String(
      anchor.getAttribute("data-pageroot-review-text-anchors") || "",
    ).split(/\s+/).find(Boolean) || "";
    const offset = Math.max(0, Math.trunc(Number(encoded.slice(encoded.lastIndexOf("@") + 1)) || 0));
    const nodes = anchorTextNodes(anchor);
    if (!nodes.length) return null;
    let remaining = offset;
    let targetNode = nodes.at(-1);
    let targetOffset = targetNode?.textContent?.length || 0;
    for (const node of nodes) {
      const length = node.textContent?.length || 0;
      if (remaining <= length) {
        targetNode = node;
        targetOffset = remaining;
        break;
      }
      remaining -= length;
    }
    if (!targetNode) return null;
    const range = document.createRange();
    const targetLength = targetNode.textContent?.length || 0;
    targetOffset = Math.min(targetOffset, targetLength);
    range.setStart(targetNode, targetOffset);
    range.collapse(true);
    let rect = range.getBoundingClientRect();
    // A collapsed Range immediately after an authored <br> is often reported
    // on the preceding visual line. Its offset remains the navigation anchor,
    // while the next visible glyph supplies the measurable context rectangle.
    let probeNode = targetNode;
    let probeOffset = targetOffset;
    let probeIndex = nodes.indexOf(targetNode);
    while (probeNode && probeOffset >= (probeNode.textContent?.length || 0)) {
      probeIndex += 1;
      probeNode = nodes[probeIndex] || null;
      probeOffset = 0;
    }
    if (probeNode && (probeNode.textContent?.length || 0) > probeOffset) {
      const probe = document.createRange();
      probe.setStart(probeNode, probeOffset);
      probe.setEnd(probeNode, probeOffset + 1);
      const probeRect = probe.getBoundingClientRect();
      probe.detach();
      if (probeRect.height > 0) rect = probeRect;
    }
    if (rect.height <= 0) {
      const length = targetNode.textContent?.length || 0;
      const start = Math.max(0, Math.min(targetOffset > 0 ? targetOffset - 1 : 0, length));
      const end = Math.min(length, Math.max(start + 1, targetOffset));
      if (end > start) {
        range.setStart(targetNode, start);
        range.setEnd(targetNode, end);
        rect = range.getBoundingClientRect();
      }
    }
    range.detach();
    return rect.height > 0 ? rect : null;
  };
  const focusTarget = (target, panelPath) => {
    revealTarget(target, panelPath);
    if (!target) return;
    requestAnimationFrame(() => {
      if (!scrollToReviewRect(target.getBoundingClientRect())) {
        scrollIntoReviewTarget(target);
      }
    });
  };
  const focusChangeTarget = (changeId, target, panelPath, behavior = "auto") => {
    revealTarget(target, panelPath);
    requestAnimationFrame(() => {
      const reportHorizontalFootprint = (rect, documentSpace = false) => {
        if (!rect) return;
        const left = Number(rect.left) + (documentSpace ? 0 : scrollX);
        const right = Number(rect.right) + (documentSpace ? 0 : scrollX);
        const maximum = Math.max(
          innerWidth,
          document.documentElement.scrollWidth,
          document.body?.scrollWidth || 0,
        );
        if (
          !runtimeVisualNumberIsFinite(left)
          || !runtimeVisualNumberIsFinite(right)
          || left < 0
          || right < left
          || right > maximum
        ) return;
        post("focus-horizontal-footprint", { changeId, left, right });
      };
      const visibleBox = document.querySelector(
        '[data-pageroot-review-overlay-box="' + changeId + '"]',
      );
      if (visibleBox) {
        reportHorizontalFootprint({
          left: visibleBox.getAttribute("data-left"),
          right: Number(visibleBox.getAttribute("data-left"))
            + Number(visibleBox.getAttribute("data-width")),
        }, true);
        if (scrollToReviewRect(visibleBox.getBoundingClientRect(), behavior)) return;
      }
      const anchors = [...document.querySelectorAll(
        '[data-pageroot-review-anchor-change="' + changeId + '"]',
      )];
      for (const anchor of anchors) {
        const rect = collapsedAnchorRect(anchor, changeId);
        if (!rect) continue;
        reportHorizontalFootprint(rect);
        if (scrollToReviewRect(rect, behavior)) return;
      }
      if (target) {
        const rect = target.getBoundingClientRect();
        reportHorizontalFootprint(rect);
        if (!scrollToReviewRect(rect, behavior)) scrollIntoReviewTarget(target, behavior);
      }
    });
  };
  const applyScrollOwner = (message) => {
    const gestureId = Math.max(0, Math.trunc(Number(message.gestureId || 0)));
    const leader = message.leader === "before" || message.leader === "after"
      ? message.leader
      : "";
    acceptsFollowerScroll = message.linked === true && runtimeVisualBoolean(leader) && leader !== side;
    followerGestureId = acceptsFollowerScroll ? gestureId : 0;
    if (!acceptsFollowerScroll) activeScrollCommand = null;
  };
  const applyScrollPosition = (message) => {
    const gestureId = Math.max(0, Math.trunc(Number(message.gestureId || 0)));
    const force = message.force === true;
    if (!force && (!acceptsFollowerScroll || gestureId !== followerGestureId)) return;
    const maximumScroll = maximumScrollTop();
    const top = clamp(Number(message.top || 0), 0, maximumScroll);
    const left = Math.max(0, Number(message.left || 0));
    const commandId = safeKey(message.commandId) || ("review-scroll-" + gestureId);
    activeScrollCommand = { commandId, top, left };
    scrollTo({ top, left, behavior: "auto" });
  };
  const markerTypes = (element) => String(
    element.getAttribute("data-pageroot-review-marker-types") || "",
  ).split(/\s+/).filter(Boolean);
  const safeProjectionFactKey = (value) => {
    const key = String(value || "").trim();
    return runtimeVisualRegExpExec(/^[a-z0-9:_-]{1,160}$/iu, key) !== null ? key : "";
  };
  const safeProjectionSummary = (value) => {
    const summary = String(value || "").trim();
    return summary && summary.length <= 80 ? summary : "";
  };
  const structureSummary = (change) => ({
    added: "新增元素",
    removed: "删除元素",
    moved: "移动元素",
    reordered: "元素顺序调整",
    attribute: "属性调整",
    style: "样式调整",
  })[change] || "元素调整";
  const normalizeProjectionFact = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const id = safeProjectionFactKey(value.id);
    const type = value.type === "text" || value.type === "structure"
      ? value.type
      : "";
    const semanticOwnerId = safeProjectionFactKey(value.semanticOwnerId);
    if (!id || !type || !semanticOwnerId) return null;
    const fact = { id, type, semanticOwnerId };
    const geometryOwnerId = safeProjectionFactKey(value.geometryOwnerId);
    const textGroup = safeProjectionFactKey(value.textGroup);
    const displayGroupId = safeProjectionFactKey(value.displayGroupId);
    const displayOwnerId = safeProjectionFactKey(value.displayOwnerId);
    const structureChange = [
      "added",
      "removed",
      "moved",
      "reordered",
      "attribute",
      "style",
    ].includes(value.structureChange)
      ? value.structureChange
      : "";
    const scope = ["text", "text-phrase", "text-line", "text-block", "element"]
      .includes(value.scope)
      ? value.scope
      : "";
    const displayScope = ["paragraph", "list-item", "cell", "component", "container"]
      .includes(value.displayScope)
      ? value.displayScope
      : "";
    const operation = ["none", "insert", "delete", "replace"].includes(value.operation)
      ? value.operation
      : "";
    const tone = value.tone === "added" || value.tone === "removed" ? value.tone : "";
    const summary = safeProjectionSummary(value.summary);
    if (geometryOwnerId) fact.geometryOwnerId = geometryOwnerId;
    if (textGroup) fact.textGroup = textGroup;
    if (displayGroupId) fact.displayGroupId = displayGroupId;
    if (displayOwnerId) fact.displayOwnerId = displayOwnerId;
    if (displayScope) fact.displayScope = displayScope;
    if (structureChange) fact.structureChange = structureChange;
    if (scope) fact.scope = scope;
    if (operation) fact.operation = operation;
    if (tone) fact.tone = tone;
    if (summary) fact.summary = summary;
    return fact;
  };
  const projectionFactIdentity = (fact) => [
    fact.type,
    fact.id,
    fact.semanticOwnerId,
    fact.geometryOwnerId || "",
  ].join("\u001f");
  const projectionFactsForElement = (element, fallbackSequence) => {
    const serialized = element.getAttribute("data-pageroot-review-projection-facts");
    if (serialized) {
      if (serialized.length > reviewProjectionFactsSerializedLengthLimit) return [];
      try {
        const parsed = JSON.parse(serialized);
        if (!Array.isArray(parsed) || parsed.length > 24) return [];
        const facts = [];
        for (const value of parsed) {
          const fact = normalizeProjectionFact(value);
          if (!fact) return [];
          const key = projectionFactIdentity(fact);
          const existingIndex = facts.findIndex((candidate) => (
            projectionFactIdentity(candidate) === key
          ));
          if (existingIndex >= 0) facts[existingIndex] = { ...facts[existingIndex], ...fact };
          else facts.push(fact);
        }
        return facts;
      } catch {
        return [];
      }
    }
    const changeId = element.getAttribute("data-pageroot-review-marker") || "";
    const semanticOwnerId = element.getAttribute("data-pageroot-review-semantic-owner")
      || ("fallback-owner-" + changeId + "-" + fallbackSequence);
    const geometryOwnerId = element.getAttribute("data-pageroot-review-geometry-owner") || "";
    const facts = [];
    if (element.hasAttribute("data-pageroot-review-text")) {
      const textGroup = element.getAttribute("data-pageroot-review-text-group")
        || ("text-marker-" + fallbackSequence);
      facts.push({
        id: textGroup,
        type: "text",
        semanticOwnerId,
        ...(geometryOwnerId ? { geometryOwnerId } : {}),
        scope: "text",
        tone: element.getAttribute("data-pageroot-review-text") === "removed" ? "removed" : "added",
        textGroup,
        displayGroupId: "display-fact-" + textGroup,
        displayOwnerId: geometryOwnerId || semanticOwnerId,
        displayScope: "paragraph",
        operation: element.getAttribute("data-pageroot-review-text-operation") || "",
        summary: element.getAttribute("data-pageroot-review-summary") || "",
      });
    }
    if (markerTypes(element).includes("structure")) {
      const structureChange = element.getAttribute("data-pageroot-review-structure") || "changed";
      facts.push({
        id: "structure-" + semanticOwnerId + "-" + structureChange,
        type: "structure",
        semanticOwnerId,
        ...(geometryOwnerId ? { geometryOwnerId } : {}),
        scope: "element",
        displayGroupId: "display-fact-structure-" + semanticOwnerId,
        displayOwnerId: geometryOwnerId || semanticOwnerId,
        displayScope: "container",
        structureChange,
        summary: element.getAttribute("data-pageroot-review-summary")
          || structureSummary(structureChange),
      });
    }
    return facts.map(normalizeProjectionFact).filter(Boolean);
  };
  // Every rendered box and mask hole is inflated by this much on all sides, so
  // geometry decisions taken before rendering must use the same number or they
  // will judge two rectangles apart that end up overlapping on screen.
  const overlayInset = 3;
  const allModeSummary = (types, summary) => {
    if (summary === "新增元素" || summary === "删除元素") return summary;
    if (types.length === 1 && summary) return summary;
    if (types.includes("text") && types.includes("structure")) return "文字、元素调整";
    if (types.includes("text")) return "文字调整";
    if (types.includes("structure")) return "元素调整";
    return "内容调整";
  };
  const roundedCoordinate = (value) => Math.round(value * 4) / 4;
  const unionPath = (rawRects, offsetLeft = 0, offsetTop = 0) => {
    const rects = rawRects.map((rect) => ({
      left: roundedCoordinate(rect.left - offsetLeft),
      top: roundedCoordinate(rect.top - offsetTop),
      right: roundedCoordinate(rect.right - offsetLeft),
      bottom: roundedCoordinate(rect.bottom - offsetTop),
    }));
    const xs = [...new Set(rects.flatMap((rect) => [rect.left, rect.right]))]
      .sort((left, right) => left - right);
    const ys = [...new Set(rects.flatMap((rect) => [rect.top, rect.bottom]))]
      .sort((top, bottom) => top - bottom);
    const filled = ys.slice(0, -1).map((top, row) => xs.slice(0, -1).map((left, column) => {
      const centerX = (left + xs[column + 1]) / 2;
      const centerY = (top + ys[row + 1]) / 2;
      return rects.some((rect) => centerX >= rect.left && centerX <= rect.right
        && centerY >= rect.top && centerY <= rect.bottom);
    }));
    const edges = [];
    const hasCell = (row, column) => runtimeVisualBoolean(filled[row]?.[column]);
    filled.forEach((row, rowIndex) => row.forEach((inside, columnIndex) => {
      if (!inside) return;
      const left = xs[columnIndex];
      const right = xs[columnIndex + 1];
      const top = ys[rowIndex];
      const bottom = ys[rowIndex + 1];
      if (!hasCell(rowIndex - 1, columnIndex)) edges.push([[left, top], [right, top]]);
      if (!hasCell(rowIndex, columnIndex + 1)) edges.push([[right, top], [right, bottom]]);
      if (!hasCell(rowIndex + 1, columnIndex)) edges.push([[right, bottom], [left, bottom]]);
      if (!hasCell(rowIndex, columnIndex - 1)) edges.push([[left, bottom], [left, top]]);
    }));
    const pointKey = (point) => point[0] + "," + point[1];
    const paths = [];
    while (edges.length) {
      const edge = edges.shift();
      const points = [edge[0], edge[1]];
      const startKey = pointKey(edge[0]);
      let currentKey = pointKey(edge[1]);
      while (currentKey !== startKey) {
        const nextIndex = edges.findIndex((candidate) => pointKey(candidate[0]) === currentKey);
        if (nextIndex < 0) break;
        const next = edges.splice(nextIndex, 1)[0];
        points.push(next[1]);
        currentKey = pointKey(next[1]);
      }
      const simplified = points.filter((point, index) => {
        if (index === 0 || index === points.length - 1) return true;
        const previous = points[index - 1];
        const next = points[index + 1];
        return !((previous[0] === point[0] && point[0] === next[0])
          || (previous[1] === point[1] && point[1] === next[1]));
      });
      if (simplified.length > 2) {
        paths.push("M " + simplified.map((point) => point[0] + " " + point[1]).join(" L ") + " Z");
      }
    }
    return paths.join(" ");
  };
  const rangeClientRects = (element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const rects = [...range.getClientRects()]
      .filter((rect) => rect.width > 1 && rect.height > 1);
    range.detach();
    return rects;
  };
  const crossesGeometryOwner = (node, owner, ownerId) => {
    let candidate = node.parentElement;
    while (candidate && candidate !== owner) {
      const candidateId = candidate.getAttribute("data-pageroot-review-geometry-owner") || "";
      if (
        candidateId
        && candidateId !== ownerId
        && !candidate.hasAttribute("data-pageroot-review-text")
      ) return true;
      candidate = candidate.parentElement;
    }
    return false;
  };
  const contentTextRects = (element, respectGeometryOwners = false) => {
    const rects = [];
    const ownerId = element.getAttribute("data-pageroot-review-geometry-owner") || "";
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const parent = node.parentElement;
      if (
        (node.textContent || "").trim()
        && parent
        && (!respectGeometryOwners || !crossesGeometryOwner(node, element, ownerId))
        && !parent.closest("script, style, noscript, template")
      ) {
        const range = document.createRange();
        range.selectNodeContents(node);
        [...range.getClientRects()]
          .filter((rect) => rect.width > 1 && rect.height > 1)
          .forEach((rect) => rects.push(rect));
        range.detach();
      }
      node = walker.nextNode();
    }
    return rects.length ? rects : [element.getBoundingClientRect()];
  };
  const textFootprintOwner = (element, geometryOwnerId) => {
    let candidate = element.parentElement;
    while (candidate) {
      if (
        geometryOwnerId
        && candidate.getAttribute("data-pageroot-review-geometry-owner") === geometryOwnerId
        && !candidate.hasAttribute("data-pageroot-review-text")
      ) return candidate;
      candidate = candidate.parentElement;
    }
    return null;
  };
  const boundsForRects = (rects) => rects.length ? {
    left: Math.min(...rects.map((rect) => rect.left)),
    top: Math.min(...rects.map((rect) => rect.top)),
    right: Math.max(...rects.map((rect) => rect.right)),
    bottom: Math.max(...rects.map((rect) => rect.bottom)),
  } : null;
  const displayOwnerForAtom = (atom) => {
    const ownerId = atom.displayOwnerId || "";
    if (ownerId) {
      const owner = document.querySelector(
        '[data-pageroot-review-display-owner~="' + ownerId + '"]',
      );
      if (owner) return owner;
    }
    if (atom.geometryOwnerId) {
      const textOwner = atom.types.includes("text")
        ? textFootprintOwner(atom.element, atom.geometryOwnerId)
        : null;
      const geometryOwner = textOwner || atom.element.closest(
        '[data-pageroot-review-geometry-owner="' + atom.geometryOwnerId + '"]',
      ) || document.querySelector(
        '[data-pageroot-review-geometry-owner="' + atom.geometryOwnerId + '"]',
      );
      if (geometryOwner) return geometryOwner;
    }
    return atom.element;
  };
  const nearestCommonDisplayContainer = (elements) => {
    const unique = [...new Set(elements)];
    if (unique.length < 2) return null;
    let candidate = unique[0].parentElement;
    while (candidate && candidate !== document.body && candidate !== document.documentElement) {
      if (candidate.tagName !== "MAIN" && unique.every((element) => candidate.contains(element))) {
        return candidate;
      }
      candidate = candidate.parentElement;
    }
    return null;
  };
  const directDisplayBranch = (container, element) => {
    let branch = element;
    while (branch.parentElement && branch.parentElement !== container) branch = branch.parentElement;
    return branch.parentElement === container ? branch : null;
  };
  const repeatedCardContainer = (container, branches) => {
    if (branches.length < 2) return false;
    const tokens = branches.map((branch) => (
      (branch.getAttribute("class") || "").toLowerCase().split(/\s+/).filter((token) => (
        /(?:^|-)(?:card|tile|metric|kpi|stat)(?:-|$)/u.test(token)
      ))
    ));
    return tokens.every((entry) => entry.length)
      && tokens[0].some((token) => tokens.every((entry) => entry.includes(token)));
  };
  const promotableStyleContainer = (elements) => {
    const container = nearestCommonDisplayContainer(elements);
    if (!container) return null;
    const branches = [...new Set(elements.map((element) => (
      directDisplayBranch(container, element)
    )).filter(Boolean))];
    const eligible = [...container.children].filter((child) => {
      const style = getComputedStyle(child);
      const rect = child.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden"
        && rect.width > 1 && rect.height > 1;
    });
    if (branches.length < 2 || !eligible.length || branches.length / eligible.length < .75) return null;
    const display = getComputedStyle(container).display;
    const semantic = /^(?:inline-)?(?:grid|flex)$/u.test(display)
      || container.matches("ul, ol, [role='list']")
      || repeatedCardContainer(container, branches);
    return semantic ? container : null;
  };
  const reviewFocusGroupId = (changeId, displayGroupId, structureChange) => {
    const groupKey = structureChange === "style"
      ? displayGroupId
      : changeId + "-" + displayGroupId;
    return "focus-" + groupKey;
  };
  const buildReviewFocusGroups = (atoms) => {
    const groups = new Map();
    atoms.forEach((atom) => {
      const displayGroupId = atom.displayGroupId || ("display-fact-" + atom.factIdentity);
      const focusGroupId = reviewFocusGroupId(
        atom.changeId,
        displayGroupId,
        atom.structureChange,
      );
      const current = groups.get(focusGroupId) || {
        id: focusGroupId,
        changeId: atom.changeId,
        displayGroupId,
        displayScope: atom.displayScope || (atom.types.includes("text") ? "paragraph" : "container"),
        changeIds: new Set(),
        atoms: [],
      };
      current.changeIds.add(atom.changeId);
      current.atoms.push(atom);
      groups.set(focusGroupId, current);
    });
    return [...groups.values()].map((group) => ({
      ...group,
      changeId: [...group.changeIds].sort()[0] || group.changeId,
    }));
  };
  const numberedLineBounds = (owner, atoms) => {
    if (owner.matches("li")) return null;
    const marker = atoms.find((atom) => owner.contains(atom.element))?.element;
    if (!marker) return null;
    const breaks = [...owner.querySelectorAll("br")];
    const previous = breaks.filter((element) => (
      element.compareDocumentPosition(marker) & Node.DOCUMENT_POSITION_FOLLOWING
    )).at(-1) || null;
    const next = breaks.find((element) => (
      element.compareDocumentPosition(marker) & Node.DOCUMENT_POSITION_PRECEDING
    )) || null;
    const range = document.createRange();
    if (previous) range.setStartAfter(previous);
    else range.setStart(owner, 0);
    if (next) range.setEndBefore(next);
    else range.setEnd(owner, owner.childNodes.length);
    const bounds = boundsForRects(
      [...range.getClientRects()].filter((rect) => rect.width > 1 && rect.height > 1),
    );
    range.detach();
    return bounds;
  };
  const resolveReviewFocusGeometry = (groups) => groups.flatMap((group) => {
    const owners = [...new Set(group.atoms.map(displayOwnerForAtom))];
    const styleGroup = group.atoms.every((atom) => atom.structureChange === "style");
    const promoted = styleGroup ? promotableStyleContainer(owners) : null;
    const geometryOwners = promoted ? [promoted] : owners;
    return geometryOwners.flatMap((owner, ownerIndex) => {
      const ownerAtoms = promoted
        ? group.atoms
        : group.atoms.filter((atom) => displayOwnerForAtom(atom) === owner);
      const semanticLineBounds = group.displayScope === "list-item"
        ? numberedLineBounds(owner, ownerAtoms)
        : null;
      const paragraphBounds = group.displayScope === "paragraph"
        ? boundsForRects(contentTextRects(owner, true))
        : null;
      const rect = semanticLineBounds || paragraphBounds || owner.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1) return [];
      const representative = ownerAtoms[0] || group.atoms[0];
      const tones = [...new Set(ownerAtoms.flatMap((atom) => atom.tones))];
      const types = [...new Set(ownerAtoms.flatMap((atom) => atom.types))];
      const evidenceUiScale = 1 / Math.max(
        .32,
        Math.min(1, Number(currentState.scale || 1)),
      );
      const addedEvidenceClearance = tones.includes("text-added")
        ? Math.max(...ownerAtoms.filter((atom) => atom.tone === "text-added").map((atom) => {
          const em = Number.parseFloat(getComputedStyle(atom.element).fontSize || "0") || 16;
          const dotRadius = Math.max(1.3, em * .08) * evidenceUiScale;
          const dotGap = Math.max(.7, em * .04) * evidenceUiScale;
          return dotGap + dotRadius + dotRadius * 1.17;
        }), 0)
        : 0;
      return [{
        ...representative,
        element: owner,
        focusGroupId: group.id,
        displayGroupId: group.displayGroupId,
        displayScope: group.displayScope,
        ownerKey: group.id + ":" + String(ownerIndex + 1),
        changeId: [...new Set(ownerAtoms.map((atom) => atom.changeId))].sort()[0]
          || group.changeId,
        factKey: ownerAtoms.map((atom) => atom.factKey).join(" "),
        atomIds: [...new Set(ownerAtoms.map((atom) => atom.factIdentity))],
        scope: types.includes("text") ? "text-block" : group.displayScope,
        summary: allModeSummary(types, representative.summary),
        tones,
        tone: tones.length > 1 ? "mixed" : tones[0],
        types,
        addedEvidenceClearance,
        left: rect.left + scrollX,
        top: rect.top + scrollY,
        right: rect.right + scrollX,
        bottom: rect.bottom + scrollY,
      }];
    });
  });
  // Hover preview: moving the pointer over a change region previews its
  // precise outline without a click. The projection layer itself never takes
  // pointer events, so hit-testing rides the document's pointer stream, one
  // animation frame at a time; the smallest containing region wins so a small
  // change inside a large one stays reachable.
  let overlayHoverRegions = [];
  let overlayElementsByChange = new RuntimeVisualMap();
  let hoveredChangeId = "";
  const setHoverChange = (changeId) => {
    if (hoveredChangeId === changeId) return;
    const clear = runtimeVisualMapGet(overlayElementsByChange, hoveredChangeId);
    if (clear) runtimeVisualArrayForEach(clear, (element) => {
      element.dataset.hover = "false";
    });
    hoveredChangeId = changeId;
    const mark = runtimeVisualMapGet(overlayElementsByChange, changeId);
    if (mark) runtimeVisualArrayForEach(mark, (element) => {
      element.dataset.hover = "true";
    });
  };
  let hoverPointerFrame = 0;
  runtimeVisualAddEventListener("pointermove", (event) => {
    if (hoverPointerFrame) return;
    const pageX = event.clientX + scrollX;
    const pageY = event.clientY + scrollY;
    hoverPointerFrame = requestAnimationFrame(() => {
      hoverPointerFrame = 0;
      let match = "";
      let matchArea = Infinity;
      runtimeVisualArrayForEach(overlayHoverRegions, (region) => {
        if (
          pageX < region.left || pageX > region.right
          || pageY < region.top || pageY > region.bottom
        ) return;
        const area = (region.right - region.left) * (region.bottom - region.top);
        if (area < matchArea) {
          match = region.changeId;
          matchArea = area;
        }
      });
      setHoverChange(match);
    });
  }, { passive: true });
  runtimeVisualAddEventListener("pointerout", (event) => {
    if (event.relatedTarget === null) setHoverChange("");
  }, { passive: true });
  function renderReviewOverlays() {
    if (projectionTransitioning) return;
    document.querySelector('[data-pageroot-review-projection-layer]')?.remove();
    const filter = currentState.filter || "all";
    // Phase 1: collect immutable source-backed atoms. Their exact identities
    // continue to own evidence marks and never become display grouping keys.
    const collectReviewAtoms = () => {
    const records = [];
    const projectionEntriesByElement = new RuntimeVisualMap();
    let markerSequence = 0;
    const appendProjectionEntry = (element, rawChangeId, rawFact) => {
      const changeId = safeKey(rawChangeId);
      const fact = normalizeProjectionFact(rawFact);
      if (!changeId || rawChangeId !== changeId || !fact) return;
      const entries = runtimeVisualMapGet(projectionEntriesByElement, element) || [];
      const factIdentity = projectionFactIdentity(fact);
      let duplicate = false;
      runtimeVisualArrayForEach(entries, (entry) => {
        if (
          entry.changeId === changeId
          && projectionFactIdentity(entry.fact) === factIdentity
        ) duplicate = true;
      });
      if (!duplicate) runtimeVisualArrayPush(entries, { changeId, fact });
      runtimeVisualMapSet(projectionEntriesByElement, element, entries);
    };
    document.querySelectorAll('[data-pageroot-review-marker]').forEach((element) => {
      markerSequence += 1;
      const changeId = element.getAttribute("data-pageroot-review-marker") || "";
      if (!runtimeVisualSetHas(confirmedVisualChangeIds, changeId)) return;
      projectionFactsForElement(element, markerSequence).forEach((fact) => {
        appendProjectionEntry(element, changeId, fact);
      });
    });
    runtimeVisualMapForEach(projectionEntriesByElement, (entries, element) => {
      runtimeVisualArrayForEach(entries, ({ changeId, fact }) => {
        if (filter !== "all" && fact.type !== filter) return;
          const semanticOwnerId = fact.semanticOwnerId;
          const geometryOwnerId = fact.geometryOwnerId || "";
          const factKey = fact.type + ":" + fact.id;
          const factIdentity = projectionFactIdentity(fact);
          if (fact.type === "text") {
            const textTone = fact.tone === "removed" ? "text-removed" : "text-added";
            const textGroup = fact.textGroup || fact.id;
            rangeClientRects(element).forEach((rect) => records.push({
              element,
              changeId,
              semanticOwnerId,
              geometryOwnerId,
              factKey,
              factIdentity,
              displayGroupId: fact.displayGroupId || ("display-fact-" + fact.id),
              displayOwnerId: fact.displayOwnerId || geometryOwnerId || semanticOwnerId,
              displayScope: fact.displayScope || "paragraph",
              ownerKey: "",
              textGroup,
              textOperation: fact.operation || "",
              scope: "text",
              summary: fact.summary || element.getAttribute("data-pageroot-review-summary") || "文本调整",
              tone: textTone,
              tones: [textTone],
              types: ["text"],
              left: rect.left + scrollX,
              top: rect.top + scrollY,
              right: rect.right + scrollX,
              bottom: rect.bottom + scrollY,
            }));
            return;
          }
          const scope = "element";
          const structureChange = fact.structureChange || "";
          const summary = fact.summary || structureSummary(structureChange);
          [element.getBoundingClientRect()].forEach((rect) => records.push({
            element,
            changeId,
            semanticOwnerId,
            geometryOwnerId,
            factKey,
            factIdentity,
            displayGroupId: fact.displayGroupId || ("display-fact-" + fact.id),
            displayOwnerId: fact.displayOwnerId || geometryOwnerId || semanticOwnerId,
            displayScope: fact.displayScope || "container",
            ownerKey: "",
            structureChange,
            scope,
            summary,
            tone: "structure",
            tones: ["structure"],
            types: [fact.type],
            left: rect.left + scrollX,
            top: rect.top + scrollY,
            right: rect.right + scrollX,
            bottom: rect.bottom + scrollY,
          }));
      });
    });
    return records;
    };
    const records = collectReviewAtoms();
    const visibleRecords = records
      .filter((rect) => rect.right - rect.left > 1 && rect.bottom - rect.top > 1)
      .sort((left, right) => left.changeId.localeCompare(right.changeId) || left.top - right.top || left.left - right.left);
    // Phase 2 groups atoms by explicit semantic presentation identity. Phase 3
    // resolves current geometry from display owners; no distance threshold can
    // merge facts from different groups.
    const focusGroups = buildReviewFocusGroups(visibleRecords);
    const resolvedGroups = resolveReviewFocusGeometry(focusGroups)
      .sort((left, right) => left.changeId.localeCompare(right.changeId)
        || left.top - right.top || left.left - right.left);
    const activeFocusGroupId = safeProjectionFactKey(currentState.activeFocusGroupId);
    let merged = activeFocusGroupId
      ? resolvedGroups.filter((record) => record.focusGroupId === activeFocusGroupId)
      : [];
    const inset = overlayInset;
    // Measure the authored document after the previous projection layer has
    // been removed. The projection may consume this width but must never grow
    // it: an inset at the right edge must not create horizontal scrolling.
    const documentWidth = Math.max(
      innerWidth,
      document.documentElement.scrollWidth,
      document.body?.scrollWidth || 0,
    );
    const height = Math.max(innerHeight, documentHeight());
    merged = merged.flatMap((record) => {
      const renderFragments = (record.fragments || [{
        left: record.left,
        top: record.top,
        right: record.right,
        bottom: record.bottom,
      }]).map((fragment) => ({
        left: clamp(fragment.left - inset, 0, documentWidth),
        top: clamp(fragment.top - inset, 0, height),
        right: clamp(fragment.right + inset, 0, documentWidth),
        bottom: clamp(
          fragment.bottom + Math.max(inset, record.addedEvidenceClearance || 0),
          0,
          height,
        ),
      })).filter((fragment) => (
        fragment.right - fragment.left > 0
        && fragment.bottom - fragment.top > 0
      ));
      if (!renderFragments.length) return [];
      const left = Math.min(...renderFragments.map((fragment) => fragment.left));
      const top = Math.min(...renderFragments.map((fragment) => fragment.top));
      const right = Math.max(...renderFragments.map((fragment) => fragment.right));
      const bottom = Math.max(...renderFragments.map((fragment) => fragment.bottom));
      return [{
        ...record,
        left,
        top,
        right,
        bottom,
        renderFragments,
        pathData: unionPath(renderFragments),
      }];
    });
    // Navigation bars remain available for every resolved group in overview;
    // only the active group's first outline carries the single public label.
    const badgeUiScale = 1 / Math.max(.32, Math.min(1, Number(currentState.scale || 1)));
    const regions = resolvedGroups.map((record) => ({
      changeId: record.changeId,
      focusGroupId: record.focusGroupId,
      left: record.left,
      top: record.top,
      right: record.right,
      bottom: record.bottom,
      carrier: record,
    }));
    const labelByCarrier = new RuntimeVisualMap();
    if (merged[0]) runtimeVisualMapSet(labelByCarrier, merged[0], {
      text: merged[0].summary,
      clusterCount: 1,
    });
    overlayElementsByChange = new RuntimeVisualMap();
    const layer = document.createElement("div");
    layer.setAttribute("data-pageroot-review-projection-layer", "true");
    layer.style.setProperty("width", documentWidth + "px", "important");
    layer.style.setProperty("height", height + "px", "important");
    const namespace = "http://www.w3.org/2000/svg";
    if (merged.length) {
    const svg = document.createElementNS(namespace, "svg");
    svg.setAttribute("data-pageroot-review-mask-layer", "true");
    svg.setAttribute("width", String(documentWidth));
    svg.setAttribute("height", String(height));
    svg.setAttribute("viewBox", "0 0 " + documentWidth + " " + height);
    svg.style.setProperty("width", documentWidth + "px", "important");
    svg.style.setProperty("height", height + "px", "important");
    const resetMaskPrimitive = (element, fill = "") => {
      element.style.setProperty("display", "block", "important");
      element.style.setProperty("margin", "0", "important");
      element.style.setProperty("padding", "0", "important");
      element.style.setProperty("border", "0", "important");
      element.style.setProperty("outline", "none", "important");
      element.style.setProperty("opacity", "1", "important");
      element.style.setProperty("filter", "none", "important");
      element.style.setProperty("transform", "none", "important");
      element.style.setProperty("pointer-events", "none", "important");
      if (!fill) return;
      element.style.setProperty("fill", fill, "important");
      element.style.setProperty("fill-opacity", "1", "important");
      element.style.setProperty("stroke", "none", "important");
    };
    const mask = document.createElementNS(namespace, "mask");
    const maskId = "pageroot-review-mask-"
      + reviewMaskSessionKey + "-" + side + "-" + projectionEpoch + "-" + (++overlayMaskSequence);
    mask.setAttribute("data-pageroot-review-mask", "true");
    mask.setAttribute("id", maskId);
    mask.setAttribute("maskUnits", "userSpaceOnUse");
    mask.setAttribute("maskContentUnits", "userSpaceOnUse");
    mask.setAttribute("mask-type", "luminance");
    mask.setAttribute("x", "0");
    mask.setAttribute("y", "0");
    mask.setAttribute("width", String(documentWidth));
    mask.setAttribute("height", String(height));
    resetMaskPrimitive(mask);
    mask.style.setProperty("mask-type", "luminance", "important");
    const maskBackground = document.createElementNS(namespace, "rect");
    maskBackground.setAttribute("data-pageroot-review-mask-background", "true");
    maskBackground.setAttribute("x", "0");
    maskBackground.setAttribute("y", "0");
    maskBackground.setAttribute("width", String(documentWidth));
    maskBackground.setAttribute("height", String(height));
    maskBackground.setAttribute("fill", "#ffffff");
    resetMaskPrimitive(maskBackground, "#ffffff");
    mask.append(maskBackground);
    const emphasizedRecords = merged;
    emphasizedRecords.forEach((record) => {
      const hole = document.createElementNS(namespace, "path");
      hole.setAttribute("data-pageroot-review-mask-hole", record.changeId);
      hole.setAttribute("data-pageroot-review-semantic-owner", record.semanticOwnerId || "");
      hole.setAttribute("data-pageroot-review-geometry-owner", record.geometryOwnerId || "");
      hole.setAttribute("data-pageroot-review-fact", record.factKey || "");
      hole.setAttribute("data-pageroot-review-focus-group", record.focusGroupId || "");
      if (record.textGroup) hole.setAttribute("data-text-group", record.textGroup);
      if (record.textGroups?.length) {
        hole.setAttribute("data-text-groups", record.textGroups.join(" "));
      }
      if (record.ownerKey) {
        hole.setAttribute("data-pageroot-review-mask-owner", record.ownerKey);
      }
      const width = record.right - record.left;
      const holeHeight = record.bottom - record.top;
      hole.setAttribute("d", record.pathData);
      hole.setAttribute("data-left", String(record.left));
      hole.setAttribute("data-top", String(record.top));
      hole.setAttribute("data-width", String(width));
      hole.setAttribute("data-height", String(holeHeight));
      hole.setAttribute("fill", "#000000");
      resetMaskPrimitive(hole, "#000000");
      mask.append(hole);
    });
    const defs = document.createElementNS(namespace, "defs");
    defs.append(mask);
    svg.append(defs);
    const dim = document.createElementNS(namespace, "rect");
    dim.setAttribute("data-pageroot-review-mask-dim", "true");
    dim.setAttribute("x", "0");
    dim.setAttribute("y", "0");
    dim.setAttribute("width", String(documentWidth));
    dim.setAttribute("height", String(height));
    dim.setAttribute("fill", "#ffffff");
    dim.setAttribute("mask", "url(#" + maskId + ")");
    const contextVisibility = Math.max(0, Math.min(100, Number(currentState.transparency ?? 18))) / 100;
    const dimOpacity = String(Math.round((1 - contextVisibility) * 1_000) / 1_000);
    dim.setAttribute("fill-opacity", dimOpacity);
    resetMaskPrimitive(dim, "#ffffff");
    dim.style.setProperty("fill-opacity", dimOpacity, "important");
    dim.style.setProperty(
      "backdrop-filter",
      "grayscale(var(--pageroot-review-context-grayscale)) saturate(var(--pageroot-review-context-saturation)) blur(1px)",
      "important",
    );
    svg.append(dim);
    layer.append(svg);
    }
    if (filter === "all" || filter === "text") {
      const uiScale = 1 / Math.max(.32, Math.min(1, Number(currentState.scale || 1)));
      const marksSvg = document.createElementNS(namespace, "svg");
      marksSvg.setAttribute("data-pageroot-review-text-marks", "true");
      marksSvg.setAttribute("width", String(documentWidth));
      marksSvg.setAttribute("height", String(height));
      marksSvg.setAttribute("viewBox", "0 0 " + documentWidth + " " + height);
      marksSvg.style.setProperty("width", documentWidth + "px", "important");
      marksSvg.style.setProperty("height", height + "px", "important");
      const strikeRuns = [];
      const addedDots = [];
      document.querySelectorAll("[data-pageroot-review-text]").forEach((marker) => {
        const markerChangeId = marker.getAttribute("data-pageroot-review-marker") || "";
        if (!runtimeVisualSetHas(confirmedVisualChangeIds, markerChangeId)) return;
        if (activeFocusGroupId) {
          const belongsToActiveGroup = runtimeVisualArraySome(visibleRecords, (atom) => (
            atom.element === marker
            && atom.types.includes("text")
            && reviewFocusGroupId(
              atom.changeId,
              atom.displayGroupId,
              atom.structureChange,
            ) === activeFocusGroupId
          ));
          if (!belongsToActiveGroup) return;
        }
        const tone = marker.getAttribute("data-pageroot-review-text") || "";
        if (tone !== "added" && tone !== "removed") return;
        const fontSize = Number.parseFloat(getComputedStyle(marker).fontSize || "0");
        const walker = document.createTreeWalker(marker, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
          // A marker span normally holds one text node, but the walker would also
          // descend into a nested marker and draw its characters twice at two
          // slightly different baselines. Let the innermost marker own its text.
          if (node.parentElement?.closest("[data-pageroot-review-text]") !== marker) {
            node = walker.nextNode();
            continue;
          }
          const value = node.textContent || "";
          let index = 0;
          while (index < value.length) {
            const end = reviewTextEvidenceGraphemeEnd(value, index);
            const code = value.charCodeAt(index);
            // The strike is one continuous rule and crosses punctuation; a dot is
            // per written character and skips it.
            const marked = !runtimeVisualWhitespaceCode(code)
              && (tone === "removed" || !reviewTextEvidenceIsPunctuationCode(code));
            if (marked) {
              const range = document.createRange();
              range.setStart(node, index);
              range.setEnd(node, end);
              const rect = range.getBoundingClientRect();
              range.detach();
              if (rect.width > 0.5 && rect.height > 0.5) {
                const geometry = reviewTextEvidenceMarkGeometry({
                  left: rect.left + scrollX,
                  top: rect.top + scrollY,
                  right: rect.right + scrollX,
                  bottom: rect.bottom + scrollY,
                }, fontSize, uiScale);
                if (tone === "added") {
                  addedDots.push({
                    x: geometry.dotX,
                    y: geometry.dotY,
                    radius: geometry.dotRadius * 1.17,
                    em: geometry.em,
                  });
                } else {
                  strikeRuns.push(geometry);
                }
              }
            }
            index = end;
          }
          node = walker.nextNode();
        }
      });
      alignReviewTextEvidenceDotRows(addedDots).forEach((dot) => {
        const circle = document.createElementNS(namespace, "circle");
        circle.setAttribute("data-pageroot-review-text-mark", "added");
        circle.setAttribute("cx", String(dot.x));
        circle.setAttribute("cy", String(dot.y));
        circle.setAttribute("r", String(dot.radius));
        marksSvg.append(circle);
      });
      strikeRuns.sort((left, right) => left.strikeY - right.strikeY || left.strikeLeft - right.strikeLeft);
      const mergedStrikes = [];
      strikeRuns.forEach((run) => {
        const previous = mergedStrikes.at(-1);
        if (
          previous
          && Math.abs(previous.strikeY - run.strikeY) <= Math.max(1, run.strikeThickness)
          && run.strikeLeft - previous.strikeRight <= Math.max(2, run.gap)
        ) {
          previous.strikeLeft = Math.min(previous.strikeLeft, run.strikeLeft);
          previous.strikeRight = Math.max(previous.strikeRight, run.strikeRight);
          previous.strikeThickness = Math.max(previous.strikeThickness, run.strikeThickness);
          previous.dash = run.dash;
          previous.gap = run.gap;
          return;
        }
        mergedStrikes.push({ ...run });
      });
      mergedStrikes.forEach((run) => {
        const line = document.createElementNS(namespace, "line");
        line.setAttribute("data-pageroot-review-text-mark", "removed");
        line.setAttribute("x1", String(run.strikeLeft));
        line.setAttribute("y1", String(run.strikeY));
        line.setAttribute("x2", String(run.strikeRight));
        line.setAttribute("y2", String(run.strikeY));
        line.setAttribute("stroke-width", String(run.strikeThickness));
        line.setAttribute("stroke-dasharray", run.dash + " " + run.gap);
        marksSvg.append(line);
      });
      layer.append(marksSvg);
    }
    merged.forEach((record) => {
      const box = document.createElement("div");
      box.setAttribute("data-pageroot-review-overlay-box", record.changeId);
      box.setAttribute("data-pageroot-review-semantic-owner", record.semanticOwnerId || "");
      box.setAttribute("data-pageroot-review-geometry-owner", record.geometryOwnerId || "");
      box.setAttribute("data-pageroot-review-fact", record.factKey || "");
      box.setAttribute("data-pageroot-review-focus-group", record.focusGroupId || "");
      box.setAttribute("data-pageroot-review-display-group", record.displayGroupId || "");
      if (record.ownerKey) {
        box.setAttribute("data-pageroot-review-overlay-owner", record.ownerKey);
      }
      box.dataset.tone = record.tone;
      box.dataset.tones = record.tones.join(" ");
      box.dataset.types = record.types.join(" ");
      box.dataset.scope = record.scope || "element";
      box.dataset.summary = record.summary;
      if (record.textGroup) box.dataset.textGroup = record.textGroup;
      if (record.textGroups?.length) box.dataset.textGroups = record.textGroups.join(" ");
      if (record.textOperation) box.dataset.textOperation = record.textOperation;
      if (record.visualLine) box.dataset.visualLine = record.visualLine;
      box.setAttribute(
        "data-pageroot-review-fragment-count",
        String((record.renderFragments || []).length || 1),
      );
      box.dataset.active = "true";
      const left = record.left;
      const top = record.top;
      const width = record.right - record.left;
      const boxHeight = record.bottom - record.top;
      box.style.setProperty("left", left + "px", "important");
      box.style.setProperty("top", top + "px", "important");
      box.style.setProperty("width", width + "px", "important");
      box.style.setProperty("height", boxHeight + "px", "important");
      box.setAttribute("data-left", String(left));
      box.setAttribute("data-top", String(top));
      box.setAttribute("data-width", String(width));
      box.setAttribute("data-height", String(boxHeight));
      box.setAttribute("data-path", record.pathData || "");
      const textOnly = record.types.length === 1 && record.types[0] === "text";
      if (!textOnly && (record.renderFragments || []).length > 1) {
        box.dataset.shaped = "true";
        const shapeSvg = document.createElementNS(namespace, "svg");
        shapeSvg.setAttribute("data-pageroot-review-overlay-shape-svg", "true");
        shapeSvg.setAttribute("viewBox", "0 0 " + width + " " + boxHeight);
        shapeSvg.setAttribute("preserveAspectRatio", "none");
        const shape = document.createElementNS(namespace, "path");
        shape.setAttribute("data-pageroot-review-overlay-shape", "true");
        shape.setAttribute("d", unionPath(record.renderFragments, left, top));
        shapeSvg.append(shape);
        box.append(shapeSvg);
      }
      const regionLabel = runtimeVisualMapGet(labelByCarrier, record);
      if (regionLabel) {
        if (top < 28 * badgeUiScale) box.dataset.labelInside = "true";
        const label = document.createElement("span");
        label.setAttribute("data-pageroot-review-overlay-label", "true");
        if (regionLabel.clusterCount > 1) {
          label.setAttribute(
            "data-pageroot-review-label-count",
            String(regionLabel.clusterCount),
          );
        }
        label.textContent = regionLabel.text;
        label.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          post("select-change", {
            changeId: record.changeId,
            focusGroupId: record.focusGroupId,
          });
        });
        box.append(label);
      }
      const hoverElements = runtimeVisualMapGet(overlayElementsByChange, record.changeId) || [];
      runtimeVisualArrayPush(hoverElements, box);
      runtimeVisualMapSet(overlayElementsByChange, record.changeId, hoverElements);
      layer.append(box);
    });
    regions.forEach((region) => {
      const focusedRegion = activeFocusGroupId === region.focusGroupId;
      const regionElements = runtimeVisualMapGet(overlayElementsByChange, region.changeId) || [];
      const bar = document.createElement("div");
      bar.setAttribute("data-pageroot-review-region-bar", region.changeId);
      bar.setAttribute("data-pageroot-review-focus-group", region.focusGroupId || "");
      bar.dataset.active = focusedRegion ? "true" : "false";
      const barTop = Math.max(0, region.top - inset);
      const barHeight = Math.max(8 * badgeUiScale, region.bottom + inset - barTop);
      bar.style.setProperty("left", (2 * badgeUiScale) + "px", "important");
      bar.style.setProperty("top", barTop + "px", "important");
      bar.style.setProperty("height", barHeight + "px", "important");
      bar.setAttribute("data-top", String(barTop));
      bar.setAttribute("data-height", String(barHeight));
      bar.addEventListener("click", () => {
        post("select-change", {
          changeId: region.changeId,
          focusGroupId: region.focusGroupId,
        });
      });
      bar.addEventListener("pointerenter", () => setHoverChange(region.changeId));
      bar.addEventListener("pointerleave", () => setHoverChange(""));
      runtimeVisualArrayPush(regionElements, bar);
      layer.append(bar);
      runtimeVisualMapSet(overlayElementsByChange, region.changeId, regionElements);
    });
    overlayHoverRegions = regions.map((region) => ({
      changeId: region.changeId,
      left: region.left - inset,
      top: region.top - inset,
      right: region.right + inset,
      bottom: region.bottom + inset,
    }));
    const rehover = hoveredChangeId;
    hoveredChangeId = "";
    setHoverChange(rehover);
    document.body.append(layer);
    document.documentElement.dataset.pagerootReviewOverlays = resolvedGroups.length ? "true" : "false";
    scheduleLayoutReport();
  }
  const applyState = (state) => {
    currentState = { ...currentState, ...state };
    const root = document.documentElement;
    root.dataset.pagerootReviewFilter = currentState.filter || "all";
    root.dataset.pagerootReviewFocus = currentState.focus || "all";
    root.dataset.pagerootReviewFocusGroup = currentState.activeFocusGroupId || "";
    const transparency = Math.max(
      0,
      Math.min(100, Number(currentState.transparency ?? 18)),
    ) / 100;
    root.style.setProperty("--pageroot-review-context-opacity", String(transparency));
    root.style.setProperty("--pageroot-review-context-grayscale", String((1 - transparency) * .55));
    root.style.setProperty("--pageroot-review-context-saturation", String(.7 + transparency * .3));
    root.style.setProperty("--pageroot-review-ui-scale", String(1 / Math.max(
      .32,
      Math.min(1, Number(currentState.scale || 1)),
    )));
    document.querySelectorAll("[data-pageroot-outline-id]").forEach((element) => {
      element.dataset.pagerootReviewActive = currentState.focus === "all"
        || element.dataset.pagerootReviewId === currentState.focus
        || element.dataset.pagerootOutlineId === currentState.focus
        ? "true"
        : "false";
    });
    document.querySelectorAll("[data-pageroot-review-marker]").forEach((element) => {
      element.dataset.pagerootReviewActive = currentState.focus !== "all"
        && element.getAttribute("data-pageroot-review-marker") === currentState.focus
        ? "true"
        : "false";
    });
    if (projectionTransitioning) renderTransitionMask();
    else scheduleOverlayRender();
  };
  runtimeVisualAddEventListener("message", (event) => {
    const message = event.data;
    if (
      !event.isTrusted
      || event.source !== reviewParent
      || !message
      || message.source !== "pageroot-ai-review-parent"
      || message.sessionId !== sessionId
    ) return;
    if (message.type === "state") applyState(message.state || {});
    if (message.type === "scroll-owner") applyScrollOwner(message);
    if (message.type === "set-scroll-position") applyScrollPosition(message);
    if (message.type === "begin-presentation") beginProjectionTransition(message.presentationEpoch);
    if (message.type === "activate-panel") {
      if (!projectionTransitioning) beginProjectionTransition(message.presentationEpoch);
      activatePanelPath(message.panelPath?.length ? message.panelPath : [message.panelKey]);
      schedulePresentationReady(message.presentationEpoch);
    }
    if (message.type === "activate-presentation") {
      if (!projectionTransitioning) beginProjectionTransition(message.presentationEpoch);
      activatePresentation(message.revealSteps);
      schedulePresentationReady(message.presentationEpoch);
    }
    if (message.type === "commit-presentation") commitProjectionTransition(message.presentationEpoch);
    if (message.type === "mirror-action") mirrorAction(message);
    if (message.type === "focus-change") {
      const changeId = String(message.changeId || "").replace(/[^a-z0-9-]/gi, "");
      const target = document.querySelector('[data-pageroot-review-id="' + changeId + '"]');
      focusChangeTarget(
        changeId,
        target,
        message.revealSteps?.length
          ? message.revealSteps
          : message.panelPath?.length ? message.panelPath : message.panelKey,
        message.behavior === "smooth" ? "smooth" : "auto",
      );
    }
    if (message.type === "focus-outline") {
      const outlineId = String(message.outlineId || "").replace(/[^a-z0-9-]/gi, "");
      const target = document.querySelector('[data-pageroot-outline-id="' + outlineId + '"]');
      focusTarget(target, message.panelPath?.length ? message.panelPath : message.panelKey);
    }
  }, true);
  addEventListener("click", (event) => {
    post("interaction");
    const action = event.target instanceof Element
      ? event.target.closest("[data-pageroot-review-action-key]")
      : null;
    if (action && !mirroringAction && !mirroringPanel) {
      const actionKey = action.getAttribute("data-pageroot-review-action-key") || "";
      const panelKey = action.closest("[data-pageroot-review-panel-key]")
        ?.getAttribute("data-pageroot-review-panel-key") || "";
      const panelPath = safePanelPath(
        action.getAttribute("data-pageroot-review-panel-path")
        || action.closest("[data-pageroot-review-panel-path]")
          ?.getAttribute("data-pageroot-review-panel-path"),
      );
      scheduleOverlayRender();
      requestAnimationFrame(() => {
        post("action", {
          actionKey,
          panelKey,
          panelPath,
          panelControl: isSafePanelControl(action),
        });
        requestAnimationFrame(scheduleOverlayRender);
      });
    }
    const control = event.target instanceof Element
      ? event.target.closest('[data-pageroot-review-panel-control="true"][data-pageroot-review-panel-key]')
      : null;
    if (control && !mirroringPanel && !mirroringAction) {
      const panelKey = control.getAttribute("data-pageroot-review-panel-key") || "";
      const panelPath = safePanelPath(
        control.getAttribute("data-pageroot-review-panel-path") || panelKey,
      );
      const localEpoch = beginProjectionTransition(projectionEpoch + 1);
      requestAnimationFrame(() => {
        post("panel-change", { panelKey, panelPath, presentationEpoch: localEpoch });
      });
    }
    if (event.target instanceof Element && event.target.closest("a[href], area[href]")) {
      event.preventDefault();
    }
  }, true);
  const postControlState = (event) => {
    if (mirroringAction || mirroringPanel) return;
    const action = event.target instanceof Element
      ? event.target.closest("[data-pageroot-review-action-key]")
      : null;
    if (!(action instanceof HTMLInputElement || action instanceof HTMLSelectElement || action instanceof HTMLTextAreaElement)) return;
    post("control-state", {
      actionKey: action.getAttribute("data-pageroot-review-action-key") || "",
      panelKey: action.closest("[data-pageroot-review-panel-key]")
        ?.getAttribute("data-pageroot-review-panel-key") || "",
      panelPath: safePanelPath(
        action.getAttribute("data-pageroot-review-panel-path")
        || action.closest("[data-pageroot-review-panel-path]")
          ?.getAttribute("data-pageroot-review-panel-path"),
      ),
      value: action.value,
      checked: action instanceof HTMLInputElement ? action.checked : undefined,
    });
  };
  addEventListener("input", postControlState, true);
  addEventListener("change", postControlState, true);
  addEventListener("submit", (event) => event.preventDefault(), true);
  const announceScrollIntent = () => {
    activeScrollCommand = null;
    acceptsFollowerScroll = false;
    followerGestureId = 0;
    post("scroll-intent");
  };
  const wheelPixels = (delta, mode, pageSize) => {
    const value = Number(delta || 0);
    if (!Number.isFinite(value) || !value) return 0;
    if (mode === 1) return value * 16;
    if (mode === 2) return value * Math.max(1, pageSize);
    return value;
  };
  // Horizontal review scrolling belongs to the pane viewport, not to this
  // document. A wheel gesture latches onto the first scroller that can consume
  // its combined delta, so a mixed swipe here keeps the horizontal component
  // and discards it instead of chaining out to the pane. Hand over what this
  // document cannot consume; the pane reconciles it against native chaining.
  const relayHorizontalWheel = (event) => {
    const deltaX = wheelPixels(event.deltaX, event.deltaMode, innerWidth);
    if (!deltaX) return;
    const scroller = document.scrollingElement || document.documentElement;
    const maximumScroll = Math.max(0, (scroller?.scrollWidth || 0) - innerWidth);
    const consumable = deltaX > 0 ? scrollX < maximumScroll - 1 : scrollX > 1;
    if (maximumScroll > 1 && consumable) return;
    post("wheel-horizontal", { deltaX });
  };
  addEventListener("wheel", (event) => {
    announceScrollIntent();
    relayHorizontalWheel(event);
  }, { capture: true, passive: true });
  addEventListener("touchstart", announceScrollIntent, { capture: true, passive: true });
  addEventListener("pointerdown", announceScrollIntent, { capture: true, passive: true });
  addEventListener("keydown", (event) => {
    const scrollKeys = new Set([
      "ArrowUp",
      "ArrowDown",
      "PageUp",
      "PageDown",
      "Home",
      "End",
      " ",
      "Spacebar",
    ]);
    if (!scrollKeys.has(event.key)) return;
    if (
      event.target instanceof Element
      && event.target.closest('input, textarea, select, [contenteditable="true"]')
    ) return;
    announceScrollIntent();
  }, true);
  addEventListener("scroll", () => {
    const command = activeScrollCommand;
    const commandMatches = command
      && Math.abs(scrollY - command.top) <= 1
      && Math.abs(scrollX - command.left) <= 1;
    if (command && !commandMatches) activeScrollCommand = null;
    post("scroll-position", {
      top: scrollY,
      left: scrollX,
      commandId: commandMatches ? command.commandId : "",
    });
    if (commandMatches && activeScrollCommand === command) activeScrollCommand = null;
  }, { passive: true });
  const handleLayoutChange = () => {
    if (projectionTransitioning) {
      renderTransitionMask();
      schedulePresentationReady(projectionEpoch);
    } else {
      scheduleOverlayRender();
      scheduleLayoutReport();
    }
  };
  addEventListener("resize", handleLayoutChange, { passive: true });
  const mutationObserver = new MutationObserver((mutations) => {
    const onlyOverlayChanges = mutations.every((mutation) => {
      const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
      return changedNodes.length > 0 && changedNodes.every((node) => (
        node instanceof Element
        && (node.matches("[data-pageroot-review-projection-layer], [data-pageroot-review-transition-mask]")
          || runtimeVisualBoolean(node.closest("[data-pageroot-review-projection-layer], [data-pageroot-review-transition-mask]")))
      ));
    });
    if (!onlyOverlayChanges) handleLayoutChange();
  });
  if (document.body) mutationObserver.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["aria-expanded", "aria-hidden", "aria-selected", "class", "hidden", "open", "style"],
  });
  const resizeObserver = typeof ResizeObserver === "function"
    ? new ResizeObserver(handleLayoutChange)
    : null;
  if (resizeObserver && document.body) resizeObserver.observe(document.body);
  const announceReady = () => post("ready", {
    height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0),
  });
  const ready = async () => {
    closeInitialBindings();
    // Static facts are independently complete. Runtime projection may arrive
    // later, fail, or be unavailable without delaying or clearing them.
    const sourceChangeIds = new RuntimeVisualSet();
    runtimeVisualQueryElements("[data-pageroot-review-marker]").forEach((element) => {
      const changeId = safeKey(runtimeVisualElementGetAttribute(
        element,
        "data-pageroot-review-marker",
      ));
      if (changeId) runtimeVisualSetAdd(sourceChangeIds, changeId);
    });
    confirmedVisualChangeIds = sourceChangeIds;
    initialProjectionCommitted = true;
    scheduleOverlayRender();
    announceReady();
    // The initial ready can precede the parent iframe ref. Re-announce through
    // the captured native timer so the parent can replay its static state.
    runtimeVisualSetTimeout(announceReady, 64);
    scheduleLayoutReport(true);
    document.fonts?.ready?.then(() => {
      scheduleOverlayRender();
      scheduleLayoutReport();
    }).catch(() => {});
  };
  if (document.readyState === "loading") {
    addEventListener("DOMContentLoaded", () => { void ready(); }, { once: true });
  } else {
    void ready();
  }
})();
`;
}

export { reviewBootstrap };
