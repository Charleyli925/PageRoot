import { readFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";

// A save first preserves the displaced entry in its recovery transaction. Poll
// through that bounded missing-name interval; all content assertions still run
// against actual disk bytes and persistent absence still fails the test.
export async function readPublishedWorkingCopy(filePath, encoding = "utf8") {
  for (let attempt = 0; ; attempt += 1) {
    try { return await readFile(filePath, encoding); }
    catch (cause) {
      if (cause?.code !== "ENOENT" || attempt >= 100) throw cause;
      await setTimeout(10);
    }
  }
}
