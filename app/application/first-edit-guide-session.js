export const FIRST_REAL_HTML_EDIT_GUIDE_GENERATION = 2;
export const FIRST_EDIT_GUIDE_PRESENT_DWELL_MS = 800;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function frozenSnapshot({
  loaded = false,
  available = false,
  status = "pending",
  generation = FIRST_REAL_HTML_EDIT_GUIDE_GENERATION,
  builtInWelcomeProjectId = null,
  visible = false,
} = {}) {
  return Object.freeze({
    loaded,
    available,
    status,
    generation,
    builtInWelcomeProjectId,
    visible,
  });
}

export function isFirstEditGuideEligible(input, snapshot) {
  if (!isRecord(input) || !isRecord(snapshot)) return false;
  if (!snapshot.available) return false;
  if (snapshot.status === "dismissed") return false;
  if (snapshot.status === "presented" && snapshot.visible !== true) return false;
  if (snapshot.status !== "pending" && snapshot.status !== "presented") return false;
  if (input.desktop !== true) return false;
  if (input.browserPreviewOnly === true) return false;
  if (input.canvasMode !== "edit") return false;
  if (input.canvasVerified !== true) return false;
  if (input.viewMode !== "current") return false;
  if (input.blockingOverlay === true) return false;
  if (input.interactionLocked === true) return false;
  if (input.runInProgress === true) return false;
  if (typeof input.projectId !== "string" || !input.projectId) return false;
  if (
    snapshot.builtInWelcomeProjectId
    && input.projectId === snapshot.builtInWelcomeProjectId
  ) return false;
  return true;
}

function defaultScheduler() {
  return {
    setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    clearTimeout: (handle) => globalThis.clearTimeout(handle),
  };
}

/**
 * Install-level first-real-HTML guide. Durable status lives in Main
 * ui-preferences; this session owns visibility and the present-dwell timer.
 */
export class FirstEditGuideSession {
  #port;
  #scheduler;
  #listeners = new Set();
  #snapshot = frozenSnapshot();
  #presentTimer = null;
  #loadPromise = null;
  #disposed = false;
  #latestInput = null;
  #welcomeIdentityResolved = false;

  constructor({ port = null, scheduler = defaultScheduler() } = {}) {
    if (
      port !== null
      && (
        !isRecord(port)
        || typeof port.get !== "function"
        || typeof port.record !== "function"
      )
    ) {
      throw new TypeError("FirstEditGuideSession requires a narrow get/record port.");
    }
    this.#port = port;
    this.#scheduler = scheduler;
  }

  get snapshot() {
    return this.#snapshot;
  }

  subscribe(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("FirstEditGuideSession listener must be a function.");
    }
    this.#listeners.add(listener);
    listener(this.#snapshot);
    return () => this.#listeners.delete(listener);
  }

  #emit(next) {
    this.#snapshot = frozenSnapshot(next);
    for (const listener of this.#listeners) {
      try {
        listener(this.#snapshot);
      } catch {
        // View listeners observe state but cannot influence its lifecycle.
      }
    }
  }

  #clearPresentTimer() {
    if (this.#presentTimer == null) return;
    this.#scheduler.clearTimeout(this.#presentTimer);
    this.#presentTimer = null;
  }

  #applyPreferences(preferences, { visible = this.#snapshot.visible } = {}) {
    const available = Boolean(this.#port);
    const storedGeneration = Number.isSafeInteger(
      preferences?.firstRealHtmlEditGuide?.generation,
    )
      ? preferences.firstRealHtmlEditGuide.generation
      : FIRST_REAL_HTML_EDIT_GUIDE_GENERATION;
    const storedStatus = preferences?.firstRealHtmlEditGuide?.status;
    const status = storedGeneration !== FIRST_REAL_HTML_EDIT_GUIDE_GENERATION
      ? "pending"
      : storedStatus === "dismissed" || storedStatus === "presented"
        ? storedStatus
        : "pending";
    this.#emit({
      loaded: true,
      available,
      status,
      generation: FIRST_REAL_HTML_EDIT_GUIDE_GENERATION,
      builtInWelcomeProjectId: preferences?.builtInWelcomeProjectId || null,
      visible: available && status !== "dismissed" ? Boolean(visible) : false,
    });
  }

  async load() {
    if (this.#disposed) return this.#snapshot;
    if (!this.#port) {
      this.#emit(frozenSnapshot({ loaded: true, available: false }));
      return this.#snapshot;
    }
    if (this.#loadPromise) return this.#loadPromise;
    this.#loadPromise = Promise.resolve()
      .then(() => this.#port.get())
      .then((preferences) => {
        if (this.#disposed) return this.#snapshot;
        this.#applyPreferences(preferences, { visible: false });
        return this.#snapshot;
      })
      .catch(() => {
        if (this.#disposed) return this.#snapshot;
        this.#applyPreferences(null, { visible: false });
        return this.#snapshot;
      })
      .finally(() => {
        this.#loadPromise = null;
      });
    return this.#loadPromise;
  }

  evaluate(input) {
    if (this.#disposed) return this.#snapshot;
    this.#latestInput = isRecord(input) ? Object.freeze({ ...input }) : null;
    if (this.#loadPromise) {
      void this.#loadPromise.then(() => {
        if (this.#latestInput) this.evaluate(this.#latestInput);
      });
      return this.#snapshot;
    }
    if (!this.#snapshot.loaded) {
      void this.load().then(() => {
        if (this.#latestInput) this.evaluate(this.#latestInput);
      });
      return this.#snapshot;
    }
    if (
      this.#port
      && !this.#welcomeIdentityResolved
      && !this.#snapshot.builtInWelcomeProjectId
      && typeof this.#latestInput?.projectId === "string"
      && this.#latestInput.projectId
    ) {
      // Welcome registration writes the install identity after the first
      // preferences read. Refresh once before showing so the welcome page
      // never flashes the card.
      this.#welcomeIdentityResolved = true;
      void this.load().then(() => {
        if (this.#latestInput) this.evaluate(this.#latestInput);
      });
      return this.#snapshot;
    }
    const eligible = isFirstEditGuideEligible(this.#latestInput, this.#snapshot);
    if (!eligible) {
      this.#clearPresentTimer();
      if (this.#snapshot.visible) {
        this.#emit({ ...this.#snapshot, visible: false });
      }
      return this.#snapshot;
    }
    if (!this.#snapshot.visible) {
      this.#emit({ ...this.#snapshot, visible: true });
    }
    if (this.#presentTimer == null && this.#snapshot.status === "pending") {
      this.#presentTimer = this.#scheduler.setTimeout(() => {
        this.#presentTimer = null;
        void this.markPresented();
      }, FIRST_EDIT_GUIDE_PRESENT_DWELL_MS);
    }
    return this.#snapshot;
  }

  async markPresented() {
    if (this.#disposed || this.#snapshot.status !== "pending" || !this.#port) {
      return this.#snapshot;
    }
    this.#clearPresentTimer();
    try {
      const preferences = await this.#port.record({ action: "presented" });
      if (this.#disposed) return this.#snapshot;
      this.#applyPreferences(preferences, { visible: this.#snapshot.visible });
    } catch {
      // A failed present write leaves the guide pending so it can appear again.
    }
    return this.#snapshot;
  }

  async dismiss() {
    if (this.#disposed) return this.#snapshot;
    this.#clearPresentTimer();
    this.#emit({ ...this.#snapshot, visible: false });
    if (!this.#port) return this.#snapshot;
    try {
      const preferences = await this.#port.record({ action: "dismissed" });
      if (this.#disposed) return this.#snapshot;
      this.#applyPreferences(preferences, { visible: false });
    } catch {
      this.#emit({
        ...this.#snapshot,
        status: "dismissed",
        visible: false,
      });
    }
    return this.#snapshot;
  }

  dispose() {
    this.#disposed = true;
    this.#clearPresentTimer();
    this.#listeners.clear();
  }
}
