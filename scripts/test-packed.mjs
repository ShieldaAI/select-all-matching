import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
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
  await mkdir(consumerDirectory);

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
    "docs/PROJECT_PLAN.md",
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

  const consumerPackage = {
    name: "select-all-matching-packed-consumer",
    private: true,
    type: "module",
    version: "0.0.0",
  };

  await writeFile(
    join(consumerDirectory, "package.json"),
    `${JSON.stringify(consumerPackage, null, 2)}\n`,
  );
  await writeFile(
    join(consumerDirectory, "verify.mjs"),
    [
      'import assert from "node:assert/strict";',
      'import { emptySelection, setIdsSelected, toBulkSelection } from "select-all-matching";',
      'import { decodeBulkSelection } from "select-all-matching/server";',
      "",
      'const empty = emptySelection("customers:active");',
      "const explicit = setIdsSelected(empty, {",
      '  context: { scopeKey: "customers:active", scopeRevision: 0 },',
      '  ids: [1, "1"],',
      "  selected: true,",
      "});",
      'assert.equal(explicit.applied, true, "selection transition must apply");',
      "if (explicit.applied) {",
      "  const request = toBulkSelection(explicit.state);",
      "  assert.deepEqual(request, {",
      "    ok: true,",
      '    value: { protocolVersion: 0, mode: "explicit", ids: [1, "1"] },',
      "  });",
      "  if (request.ok && request.value) {",
      "    assert.deepEqual(decodeBulkSelection(request.value), request);",
      "  }",
      "}",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(consumerDirectory, "verify.ts"),
    [
      'import { emptySelection, setIdSelected, type SelectionView } from "select-all-matching";',
      'import { decodeBulkSelection } from "select-all-matching/server";',
      "",
      "declare const customerIdBrand: unique symbol;",
      "type CustomerId = string & { readonly [customerIdBrand]: true };",
      'const customerId = "cus_1" as CustomerId;',
      'const state = emptySelection<CustomerId>("customers");',
      'if (state.mode === "empty") {',
      "  setIdSelected(state, {",
      '    context: { scopeKey: "customers", scopeRevision: 0 },',
      "    // @ts-expect-error -- empty narrowing must preserve the branded ID type",
      '    id: "plain-string",',
      "    selected: true,",
      "  });",
      "}",
      "setIdSelected(state, {",
      '  context: { scopeKey: "customers", scopeRevision: 0 },',
      "  id: customerId,",
      "  selected: true,",
      "});",
      "declare const brandedView: SelectionView<CustomerId>;",
      "declare function acceptsStringView(view: SelectionView<string>): void;",
      "// @ts-expect-error -- branded views must not widen to arbitrary strings",
      "acceptsStringView(brandedView);",
      "declare const payload: unknown;",
      "// @ts-expect-error -- typed decoding requires an ID decoder",
      "decodeBulkSelection<CustomerId>(payload);",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(consumerDirectory, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          exactOptionalPropertyTypes: true,
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
          skipLibCheck: false,
          strict: true,
          target: "ES2022",
          types: [],
        },
        include: ["verify.ts"],
      },
      null,
      2,
    )}\n`,
  );

  await runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund", tarballPath], {
    cwd: consumerDirectory,
  });
  await run(process.execPath, ["verify.mjs"], { cwd: consumerDirectory });
  await run(process.execPath, [typescriptCli, "-p", "tsconfig.json"], {
    cwd: consumerDirectory,
  });
  await run(
    process.execPath,
    [join(repositoryRoot, "scripts", "test-packed-runtime.mjs"), tarballPath],
    { cwd: repositoryRoot },
  );

  process.stdout.write(`Packed artifact and consumers passed for ${packResult[0].filename}\n`);
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
