function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function uniqueKeys(keys) {
  return [...new Set(
    (Array.isArray(keys) ? keys : [keys])
      .map((key) => String(key || ""))
      .filter(Boolean),
  )];
}

export function createRecoveryStore(storageProvider) {
  const storage = () => {
    try {
      return typeof storageProvider === "function"
        ? storageProvider()
        : storageProvider;
    } catch {
      return null;
    }
  };

  return Object.freeze({
    readRecords(keys) {
      const activeStorage = storage();
      if (!activeStorage) return [];
      const records = [];
      for (const key of uniqueKeys(keys)) {
        try {
          const serialized = activeStorage.getItem(key);
          if (!serialized) continue;
          const value = JSON.parse(serialized);
          if (isRecord(value)) records.push({ key, value });
        } catch {
          // A malformed crash record is isolated to its own key.
        }
      }
      return records;
    },
    write(keys, value) {
      const activeStorage = storage();
      if (!activeStorage) return false;
      let serialized;
      try {
        serialized = JSON.stringify(value);
      } catch {
        return false;
      }
      try {
        for (const key of uniqueKeys(keys)) {
          activeStorage.setItem(key, serialized);
        }
        return true;
      } catch {
        return false;
      }
    },
    remove(keys) {
      const activeStorage = storage();
      if (!activeStorage) return false;
      try {
        for (const key of uniqueKeys(keys)) activeStorage.removeItem(key);
        return true;
      } catch {
        return false;
      }
    },
  });
}

export function createBrowserRecoveryStore() {
  return createRecoveryStore(() => (
    typeof window === "undefined" ? null : window.localStorage
  ));
}
