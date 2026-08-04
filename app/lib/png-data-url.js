export function isSafePngDataUrl(value) {
  const source = String(value ?? "");
  return (
    source.length > 32
    && source.length <= 2_000_000
    && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/u.test(source)
  );
}
