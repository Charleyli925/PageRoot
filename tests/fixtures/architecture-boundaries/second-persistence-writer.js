import { writeFile } from "node:fs/promises";

export async function writeSource(destination, bytes) {
  return writeFile(destination, bytes);
}
