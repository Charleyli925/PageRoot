// Copy decisions for the external HTML open confirmation live here so the branch
// that decides whether a sentence appears at all stays testable without a DOM.

// Reopening an already imported original only has to stop a duplicate import, so
// version numbers stay hidden. The one exception is a Working Copy parked on an
// older Version: continuing does not land on the project's newest Version, and the
// user has to learn that before the switch instead of after it.
export function staleVersionSentence(
  currentBasedOnOrdinal,
  latestOfficialOrdinal,
) {
  const basedOn = Number(currentBasedOnOrdinal);
  const latest = Number(latestOfficialOrdinal);
  if (!Number.isFinite(basedOn) || !Number.isFinite(latest)) return "";
  if (basedOn <= 0 || basedOn >= latest) return "";
  return `你上次是从第 ${basedOn} 版继续编辑的，打开后仍在第 ${basedOn} 版`
    + `（项目最新为第 ${latest} 版，可在项目里切换至最新版）。`;
}
