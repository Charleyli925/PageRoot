function normalizedIdentity(identity) {
  return [
    String(identity.projectId || ""),
    String(identity.documentId || ""),
    String(identity.sourcePath || ""),
    String(identity.epoch ?? ""),
  ].join("\u0000");
}
export class ProjectQueryFence {
  #sequences = new Map();

  begin(identity, queryName) {
    const key = `${normalizedIdentity(identity)}\u0000${queryName}`;
    const sequence = (this.#sequences.get(key) ?? 0) + 1;
    this.#sequences.set(key, sequence);
    return Object.freeze({ key, sequence });
  }

  isCurrent(ticket) {
    return this.#sequences.get(ticket.key) === ticket.sequence;
  }

  retire(identity) {
    const prefix = `${normalizedIdentity(identity)}\u0000`;
    for (const key of this.#sequences.keys()) {
      if (key.startsWith(prefix)) this.#sequences.delete(key);
    }
  }

  clear() {
    this.#sequences.clear();
  }
}
