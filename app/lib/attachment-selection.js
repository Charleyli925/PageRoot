export const MAX_COMMENT_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/**
 * Invalid files do not consume the remaining attachment slots. This lets a
 * valid file in the same picker batch continue instead of being rejected
 * merely because an earlier empty/oversized file occupied its position.
 *
 * @template {{ size: number }} T
 * @param {T[]} files
 * @param {number} existingCount
 */
export function planAttachmentSelection(files, existingCount) {
  const occupied = Number.isFinite(existingCount)
    ? Math.max(0, Math.min(MAX_COMMENT_ATTACHMENTS, Math.trunc(existingCount)))
    : 0;
  const available = Math.max(0, MAX_COMMENT_ATTACHMENTS - occupied);
  const invalid = [];
  const valid = [];

  for (const file of files) {
    if (
      !file
      || !Number.isFinite(file.size)
      || file.size <= 0
      || file.size > MAX_ATTACHMENT_BYTES
    ) {
      invalid.push(file);
    } else {
      valid.push(file);
    }
  }

  return {
    accepted: valid.slice(0, available),
    invalid,
    overLimit: valid.slice(available),
    available,
  };
}
