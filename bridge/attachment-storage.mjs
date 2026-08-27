import { constants as fsConstants } from "node:fs";
import {
  copyFile,
  open,
  rm,
} from "node:fs/promises";

const CLONE_UNSUPPORTED_CODES = new Set([
  "EINVAL",
  "ENOSYS",
  "ENOTSUP",
  "EOPNOTSUPP",
  "EXDEV",
]);

async function syncLocalFile(filePath) {
  const handle = await open(filePath, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function freezeLocalAttachment({
  sourcePath,
  destinationPath,
  copyFileImpl = copyFile,
  removeImpl = rm,
  syncFileImpl = syncLocalFile,
}) {
  const cloneFlags =
    fsConstants.COPYFILE_EXCL | fsConstants.COPYFILE_FICLONE_FORCE;
  let materialization;
  try {
    await copyFileImpl(sourcePath, destinationPath, cloneFlags);
    materialization = "copy-on-write";
  } catch (error) {
    await removeImpl(destinationPath, { force: true }).catch(() => {});
    if (!CLONE_UNSUPPORTED_CODES.has(error?.code)) throw error;

    await copyFileImpl(
      sourcePath,
      destinationPath,
      fsConstants.COPYFILE_EXCL,
    );
    materialization = "full-copy";
  }

  await syncFileImpl(destinationPath);
  return { materialization };
}
