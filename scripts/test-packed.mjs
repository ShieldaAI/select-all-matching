import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { cp, mkdtemp, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { checkApi } from "./check-api.mjs";

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
const minimumTypescriptCli = join(repositoryRoot, "node_modules", "typescript-5-4", "bin", "tsc");
const consumerFixture = join(repositoryRoot, "scripts", "fixtures", "packed-consumer");
const options = parseArguments(process.argv.slice(2));
const temporaryRoot = await mkdtemp(join(tmpdir(), "select-all-matching-pack-"));
const consumerDirectory = join(temporaryRoot, "consumer");
const artifactDirectory = options.packDestination ?? join(temporaryRoot, "artifact");

function parseArguments(arguments_) {
  const result = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--consumer-only") {
      result.consumerOnly = true;
    } else if (argument === "--tarball" || argument === "--pack-destination") {
      const value = arguments_[++index];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a path`);
      const key = argument === "--tarball" ? "tarball" : "packDestination";
      if (result[key]) throw new Error(`${argument} was supplied twice`);
      result[key] = resolve(value);
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  if (result.tarball && result.packDestination) {
    throw new Error("Use either --tarball or --pack-destination");
  }
  if (result.consumerOnly && !result.tarball) {
    throw new Error("--consumer-only requires an existing --tarball");
  }
  return result;
}

async function listFiles(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = prefix + entry.name;
    if (entry.isDirectory()) {
      files.push(...(await listFiles(join(directory, entry.name), `${path}/`)));
    } else {
      files.push(path);
    }
  }
  return files;
}

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

function parsePackResult(output) {
  const lines = output.split(/\r?\n/);
  const jsonStart = lines.findIndex((line) => line.trimStart().startsWith("["));
  if (jsonStart === -1) {
    throw new Error("npm pack did not return a JSON result");
  }
  return JSON.parse(lines.slice(jsonStart).join("\n"));
}

try {
  await cp(consumerFixture, consumerDirectory, { recursive: true });
  let tarballPath = options.tarball;
  if (!tarballPath) {
    await mkdir(artifactDirectory, { recursive: true });
    await runNpm(["run", "build"], { cwd: repositoryRoot });
    const { stdout: packOutput } = await runNpm(
      ["pack", "--json", "--ignore-scripts", "--silent", "--pack-destination", artifactDirectory],
      { cwd: repositoryRoot },
    );
    const packResult = parsePackResult(packOutput);
    assert.equal(packResult.length, 1, "npm pack must produce exactly one artifact");
    assert.equal(typeof packResult[0]?.filename, "string", "npm pack did not report a filename");
    tarballPath = join(artifactDirectory, packResult[0].filename);
  }
  assert.equal((await stat(tarballPath)).isFile(), true, "--tarball must point to a packed file");

  await runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund", tarballPath], {
    cwd: consumerDirectory,
  });
  const installedPackage = join(consumerDirectory, "node_modules", "select-all-matching");
  const manifest = JSON.parse(await readFile(join(installedPackage, "package.json"), "utf8"));
  const sourceManifest = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
  assert.equal(manifest.name, sourceManifest.name, "wrong package in artifact");
  assert.equal(manifest.version, sourceManifest.version, "artifact version differs from source");
  assert.deepEqual(manifest.dependencies ?? {}, {}, "core must have no runtime dependencies");
  const packedFiles = new Set(await listFiles(installedPackage));
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
    "docs/api.md",
    "docs/client-guide.md",
    "docs/server-guide.md",
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
    for (const prefix of ["tests/", "scripts/", "etc/", ".github/"]) {
      assert.equal(packedPath.startsWith(prefix), false, `packed artifact contains ${packedPath}`);
    }
  }

  await checkApi(join(installedPackage, "dist"));
  if (!options.consumerOnly) {
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
  }

  await cp(installedPackage, join(consumerDirectory, "node_modules", "selection-copy"), {
    recursive: true,
  });
  await run(process.execPath, ["verify.mjs"], { cwd: consumerDirectory });
  for (const compiler of [typescriptCli, minimumTypescriptCli]) {
    for (const project of ["tsconfig.json", "tsconfig.bundler.json"]) {
      await run(process.execPath, [compiler, "-p", project], { cwd: consumerDirectory });
    }
  }
  process.stdout.write(`Packed artifact and consumers passed for ${basename(tarballPath)}\n`);
  if (options.packDestination) process.stdout.write(`Artifact: ${tarballPath}\n`);
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}
