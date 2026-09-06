import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baselineDirectory = join(repositoryRoot, "etc", "api");
const formatting = await resolveConfig(join(repositoryRoot, "prettier.config.mjs"));

async function declarations(directory, prefix = "") {
  const result = new Map();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      for (const [name, content] of await declarations(path, `${prefix}${entry.name}/`)) {
        result.set(name, content);
      }
    } else if (entry.name.endsWith(".d.ts")) {
      const content = await readFile(path, "utf8");
      result.set(
        `${prefix}${entry.name}`,
        await format(content.replace(/^\/\/# sourceMappingURL=.*\n?/gm, ""), {
          ...formatting,
          parser: "typescript",
        }),
      );
    }
  }
  return result;
}

export async function checkApi(directory = join(repositoryRoot, "dist")) {
  const [actual, expected] = await Promise.all([
    declarations(directory),
    declarations(baselineDirectory),
  ]);
  const changed = [...new Set([...actual.keys(), ...expected.keys()])]
    .filter((name) => actual.get(name) !== expected.get(name))
    .sort();
  if (changed.length) {
    throw new Error(
      `Declaration changes need review in ${relative(repositoryRoot, baselineDirectory)}:\n${changed.join("\n")}`,
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length === 3 && process.argv[2] === "--update") {
    await mkdir(baselineDirectory, { recursive: true });
    const actual = await declarations(join(repositoryRoot, "dist"));
    const existing = await declarations(baselineDirectory);
    for (const [name, content] of actual) {
      const path = join(baselineDirectory, name);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content);
    }
    for (const name of existing.keys()) {
      if (!actual.has(name)) await rm(join(baselineDirectory, name));
    }
    process.stdout.write("Updated API baseline; review the declaration diff before committing\n");
  } else {
    if (process.argv.length > 2) throw new Error("Usage: check-api.mjs [--update]");
    await checkApi();
    process.stdout.write("Declarations match the reviewed API baseline\n");
  }
}
