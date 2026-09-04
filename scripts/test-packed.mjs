import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { cp, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
const npmExecPath = process.env["npm_execpath"];
const publintCli = join(repositoryRoot, "node_modules", "publint", "src", "cli.js");
const attwCli = join(
  repositoryRoot,
  "node_modules",
  "@arethetypeswrong",
  "cli",
  "dist",
  "index.js",
);
const typescriptCli = join(repositoryRoot, "node_modules", "typescript", "bin", "tsc");
const consumerFixture = join(repositoryRoot, "scripts", "fixtures", "packed-consumer");
const temporaryRoot = await mkdtemp(join(tmpdir(), "select-all-matching-pack-"));
const artifactDirectory = join(temporaryRoot, "artifact");
const consumerDirectory = join(temporaryRoot, "consumer");

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
  await mkdir(artifactDirectory);
  await cp(consumerFixture, consumerDirectory, { recursive: true });

  await runNpm(["run", "build"], { cwd: repositoryRoot });
  const { stdout: packOutput } = await runNpm(
    ["pack", "--json", "--pack-destination", artifactDirectory],
    { cwd: repositoryRoot },
  );
  const packResult = JSON.parse(packOutput);

  assert.equal(packResult.length, 1, "npm pack must produce exactly one artifact");
  assert.equal(typeof packResult[0]?.filename, "string", "npm pack did not report a filename");

  const tarballPath = join(artifactDirectory, packResult[0].filename);
  const packedFiles = new Set(packResult[0].files?.map((file) => file.path));
  for (const requiredPath of [
    "CHANGELOG.md",
    "LICENSE",
    "README.md",
    "SECURITY.md",
    "dist/core/state.d.ts.map",
    "dist/core/state.js.map",
    "dist/index.d.ts",
    "dist/index.js",
    "dist/server/index.d.ts",
    "dist/server/index.js",
    "docs/TECHNICAL_SPEC.md",
    "docs/versioning.md",
    "src/core/state.ts",
  ]) {
    assert.equal(packedFiles.has(requiredPath), true, `packed artifact is missing ${requiredPath}`);
  }
  for (const forbiddenPath of ["AGENTS.md", "package-lock.json", "tsconfig.json"]) {
    assert.equal(
      packedFiles.has(forbiddenPath),
      false,
      `packed artifact contains ${forbiddenPath}`,
    );
  }
  assert.equal(
    packedFiles.has("docs/PROJECT_PLAN.md"),
    false,
    "packed artifact contains the internal roadmap",
  );
  for (const packedPath of packedFiles) {
    assert.equal(packedPath.startsWith("tests/"), false, `packed artifact contains ${packedPath}`);
    assert.equal(
      packedPath.startsWith(".github/"),
      false,
      `packed artifact contains ${packedPath}`,
    );
  }

  await run(process.execPath, [publintCli, "run", tarballPath, "--strict"], {
    cwd: repositoryRoot,
  });
  await run(
    process.execPath,
    [
      attwCli,
      tarballPath,
      "--profile",
      "esm-only",
      "--entrypoints",
      ".",
      "select-all-matching/server",
    ],
    { cwd: repositoryRoot },
  );

  await runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund", tarballPath], {
    cwd: consumerDirectory,
  });
  await run(process.execPath, ["verify.mjs"], { cwd: consumerDirectory });
  await run(process.execPath, [typescriptCli, "-p", "tsconfig.json"], {
    cwd: consumerDirectory,
  });
  process.stdout.write(`Packed artifact and consumers passed for ${packResult[0].filename}\n`);
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}
