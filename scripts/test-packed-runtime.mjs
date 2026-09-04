import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
const npmExecPath = process.env["npm_execpath"];
const suppliedArtifact = process.argv[2];

assert.equal(
  typeof suppliedArtifact,
  "string",
  "pass a tarball or directory containing one tarball",
);

const resolvedArtifact = resolve(repositoryRoot, suppliedArtifact);
const artifactStats = await stat(resolvedArtifact);
let tarballPath = resolvedArtifact;
if (artifactStats.isDirectory()) {
  const candidates = (await readdir(resolvedArtifact))
    .filter((entry) => entry.endsWith(".tgz"))
    .sort();
  assert.equal(candidates.length, 1, "artifact directory must contain exactly one .tgz file");
  tarballPath = join(resolvedArtifact, candidates[0]);
}

assert.equal(tarballPath.endsWith(".tgz"), true, "packed artifact must be a .tgz file");

const temporaryRoot = await mkdtemp(join(tmpdir(), "select-all-matching-runtime-"));

async function run(command, arguments_, options) {
  try {
    return await execFile(command, arguments_, {
      maxBuffer: 10 * 1024 * 1024,
      ...options,
    });
  } catch (error) {
    if (error && typeof error === "object") {
      if ("stdout" in error && error.stdout) process.stderr.write(String(error.stdout));
      if ("stderr" in error && error.stderr) process.stderr.write(String(error.stderr));
    }
    throw error;
  }
}

async function runNpm(arguments_, options) {
  if (npmExecPath) {
    return run(process.execPath, [npmExecPath, ...arguments_], options);
  }

  return run(npmExecutable, arguments_, {
    ...options,
    shell: process.platform === "win32",
  });
}

try {
  await writeFile(
    join(temporaryRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "select-all-matching-runtime-consumer",
        private: true,
        type: "module",
        version: "0.0.0",
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(temporaryRoot, "verify.mjs"),
    [
      'import assert from "node:assert/strict";',
      'import { emptySelection, setIdsSelected, toBulkSelection } from "select-all-matching";',
      'import { decodeBulkSelection } from "select-all-matching/server";',
      "",
      'const empty = emptySelection("runtime-scope");',
      "const selected = setIdsSelected(empty, {",
      '  context: { scopeKey: "runtime-scope", scopeRevision: 0 },',
      '  ids: [1, "1"],',
      "  selected: true,",
      "});",
      "assert.equal(selected.applied, true);",
      "if (selected.applied) {",
      "  const bulk = toBulkSelection(selected.state);",
      "  assert.equal(bulk.ok, true);",
      "  if (bulk.ok && bulk.value) assert.deepEqual(decodeBulkSelection(bulk.value), bulk);",
      "}",
      "",
    ].join("\n"),
  );

  await runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund", tarballPath], {
    cwd: temporaryRoot,
  });
  await run(process.execPath, ["verify.mjs"], { cwd: temporaryRoot });

  const digest = createHash("sha256")
    .update(await readFile(tarballPath))
    .digest("hex");
  process.stdout.write(`Node ${process.version} passed ${digest}\n`);
} finally {
  const resolvedTemporaryRoot = resolve(temporaryRoot);
  const resolvedSystemTemporary = resolve(tmpdir());
  const temporaryPathFromSystemRoot = relative(resolvedSystemTemporary, resolvedTemporaryRoot);

  if (
    temporaryPathFromSystemRoot !== "" &&
    temporaryPathFromSystemRoot !== ".." &&
    !temporaryPathFromSystemRoot.startsWith(`..${sep}`) &&
    !isAbsolute(temporaryPathFromSystemRoot)
  ) {
    await rm(resolvedTemporaryRoot, { force: true, recursive: true });
  }
}
