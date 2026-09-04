import { rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(repositoryRoot, "dist");

if (dirname(outputDirectory) !== repositoryRoot) {
  throw new Error(`Refusing to clean unexpected path: ${outputDirectory}`);
}

await rm(outputDirectory, { force: true, recursive: true });
