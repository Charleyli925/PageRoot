/**
 * Compatibility bootstrap for script-enabled opaque-origin display sandboxes.
 * Values live only inside one frame and disappear with it; this is deliberately
 * not browser persistence or application state.
 */
export const OPAQUE_SANDBOX_STORAGE_BOOTSTRAP = String.raw`
  const createMemoryStorage = () => {
    const values = new Map();
    return {
      get length() {
        return values.size;
      },
      clear() {
        values.clear();
      },
      getItem(key) {
        const normalizedKey = String(key);
        return values.has(normalizedKey) ? values.get(normalizedKey) : null;
      },
      key(index) {
        return Array.from(values.keys())[Number(index)] ?? null;
      },
      removeItem(key) {
        values.delete(String(key));
      },
      setItem(key, value) {
        values.set(String(key), String(value));
      },
    };
  };

  for (const name of ["localStorage", "sessionStorage"]) {
    try {
      void window[name].length;
    } catch {
      Object.defineProperty(window, name, {
        configurable: true,
        value: createMemoryStorage(),
      });
    }
  }
`;
