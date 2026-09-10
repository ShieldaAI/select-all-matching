import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { appendFile, mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const workflow = readFileSync(
  new URL("../../.github/workflows/publish.yml", import.meta.url),
  "utf8",
);
const verificationBlock = workflow.match(
  /^([ ]+)node --input-type=module <<'NODE'\r?\n([\s\S]*?)^\1NODE\s*$/m,
);
assert.ok(verificationBlock, "The publishing workflow must contain its inline artifact verifier");
const verificationScript = verificationBlock[2]
  .split("\n")
  .map((line) =>
    line.startsWith(verificationBlock[1]) ? line.slice(verificationBlock[1].length) : line,
  )
  .join("\n");

async function fixture(t, { version = "1.0.0", manifest = {} } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "selection-publish-check-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const release = join(directory, "release");
  const source = join(directory, "source");
  await mkdir(release);
  await mkdir(join(source, "package"), { recursive: true });
  await writeFile(
    join(source, "package", "package.json"),
    JSON.stringify({
      name: "select-all-matching",
      version,
      repository: { url: "git+https://github.com/ShieldaAI/select-all-matching.git" },
      ...manifest,
    }),
  );
  const tarball = join(release, `select-all-matching-${version}.tgz`);
  execFileSync("tar", ["-czf", tarball, "-C", source, "package/package.json"]);
  const output = join(directory, "github-output");
  const env = {
    ...process.env,
    GITHUB_REF_NAME: `v${version}`,
    RUNNER_TEMP: directory,
    GITHUB_OUTPUT: output,
    EXPECTED_SHA256: createHash("sha256").update(readFileSync(tarball)).digest("hex"),
  };
  return {
    directory,
    release,
    tarball,
    output,
    env,
    verify() {
      return spawnSync(process.execPath, ["--input-type=module"], {
        input: verificationScript,
        cwd: directory,
        env,
        encoding: "utf8",
        timeout: 5_000,
        maxBuffer: 256 * 1024,
      });
    },
  };
}

function assertRejected(subject) {
  const result = subject.verify();
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  assert.notEqual(result.status, 0, "Invalid release input passed the publishing gate");
  assert.equal(existsSync(subject.output), false, "Rejected input emitted publishing outputs");
}

test("the inline publisher verifier emits only the verified tarball and its release channel", async (t) => {
  for (const [version, channel] of [
    ["1.0.0", "latest"],
    ["12.40.103", "latest"],
    ["1.0.0-rc.1", "next"],
    ["2.0.0-0", "next"],
    ["2.0.0-alpha-1", "next"],
  ]) {
    await t.test(version, async (t) => {
      const subject = await fixture(t, { version });
      const result = subject.verify();
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(
        readFileSync(subject.output, "utf8"),
        `tarball=${subject.tarball}\nchannel=${channel}\n`,
      );
    });
  }
});

test("the inline publisher verifier rejects malformed and mismatched release tags", async (t) => {
  for (const tag of [
    undefined,
    "main",
    "1.0.0",
    "v1.0",
    "v01.0.0",
    "v1.0.0-01",
    "v1.0.0-rc..1",
    "v1.0.0+build.1",
    "v1.0.0\n",
    "v1.0.0\nchannel=latest",
    "v1.0.0 ",
    "v1.0.1",
  ]) {
    await t.test(String(JSON.stringify(tag)), async (t) => {
      const subject = await fixture(t);
      if (tag === undefined) delete subject.env.GITHUB_REF_NAME;
      else subject.env.GITHUB_REF_NAME = tag;
      assertRejected(subject);
    });
  }
});

test("the inline publisher verifier checks the package identity inside the matching tarball", async (t) => {
  for (const [label, manifest] of [
    ["different package", { name: "another-package" }],
    ["different version", { version: "1.0.1" }],
    ["different repository", { repository: { url: "git+https://github.com/other/package.git" } }],
    ["missing repository", { repository: undefined }],
  ]) {
    await t.test(label, async (t) => {
      assertRejected(await fixture(t, { manifest }));
    });
  }
});

test("the inline publisher verifier fails closed for missing, malformed, or mismatched digests", async (t) => {
  for (const digest of [
    undefined,
    "",
    "a".repeat(63),
    "G".repeat(64),
    "0".repeat(64),
    `${"a".repeat(64)}\n`,
  ]) {
    await t.test(String(JSON.stringify(digest)), async (t) => {
      const subject = await fixture(t);
      if (digest === undefined) delete subject.env.EXPECTED_SHA256;
      else subject.env.EXPECTED_SHA256 = digest;
      assertRejected(subject);
    });
  }
  await t.test("tarball changed after hashing", async (t) => {
    const subject = await fixture(t);
    await appendFile(subject.tarball, "changed after verification");
    assertRejected(subject);
  });
});

test("the inline publisher verifier rejects extra files and non-regular tarballs", async (t) => {
  await t.test("extra artifact file", async (t) => {
    const subject = await fixture(t);
    await writeFile(join(subject.release, "unexpected.txt"), "unexpected");
    assertRejected(subject);
  });
  await t.test("missing tarball", async (t) => {
    const subject = await fixture(t);
    await rm(subject.tarball);
    assertRejected(subject);
  });
  await t.test("symlink with valid target and digest", async (t) => {
    const subject = await fixture(t);
    const target = join(subject.directory, "outside-release.tgz");
    await rename(subject.tarball, target);
    await symlink(target, subject.tarball);
    assertRejected(subject);
  });
  await t.test("directory at the expected tarball path", async (t) => {
    const subject = await fixture(t);
    await rm(subject.tarball);
    await mkdir(subject.tarball);
    assertRejected(subject);
  });
});

test("publishing identity is restricted to the gated job without repository or dependency execution", () => {
  const validation = workflow.match(/^ {2}validate:\n([\s\S]*?)(?=^ {2}publish:)/m)?.[1];
  const publisher = workflow.match(/^ {2}publish:\n([\s\S]*)/m)?.[1];
  assert.ok(validation);
  assert.ok(publisher);
  assert.doesNotMatch(workflow.split(/^jobs:\s*$/m)[0], /id-token:\s*write/);
  assert.doesNotMatch(validation, /id-token:\s*write|environment:\s*npm-publish/);
  assert.match(publisher, /^ {4}needs: validate$/m);
  assert.match(publisher, /^ {4}environment: npm-publish$/m);
  const permissions = publisher.match(/^ {4}permissions:\n((?:^ {6}.+\n)+)/m)?.[1];
  assert.equal(permissions?.trim(), "id-token: write");
  assert.doesNotMatch(publisher, /uses:\s*(?:actions\/checkout@|\.\/)|\bnpm (?:ci|run)\b|\bnpx\b/);
  assert.match(publisher, /^ {10}package-manager-cache: false$/m);
  for (const line of publisher.split("\n").filter((line) => /run: npm install\b/.test(line))) {
    assert.match(line, /npm install --global npm@[0-9]+\.[0-9]+\.[0-9]+ --ignore-scripts\b/);
  }
  const publishCommand = publisher.match(/^\s+run: (npm publish [^\n]+)$/m)?.[1];
  assert.ok(publishCommand);
  for (const required of [
    '"$TARBALL"',
    "--ignore-scripts",
    "--registry=https://registry.npmjs.org",
    "--access public",
    '--tag "$CHANNEL"',
    "--provenance",
  ]) {
    assert.ok(publishCommand.includes(required), `Publishing must retain ${required}`);
  }
});

test("artifact transfer pins its actions and binds the publisher to this run's verified artifact", () => {
  for (const [, action] of workflow.matchAll(/^\s+uses:\s+(\S+)/gm)) {
    assert.match(action, /@[a-f0-9]{40}$/);
  }
  assert.match(workflow, /artifact-ids: \$\{\{ needs\.validate\.outputs\.artifact-id \}\}/);
  assert.match(workflow, /EXPECTED_SHA256: \$\{\{ needs\.validate\.outputs\.sha256 \}\}/);
  assert.match(workflow, /digest-mismatch: error/);
  assert.match(workflow, /if-no-files-found: error/);
  assert.match(workflow, /overwrite: false/);
  assert.doesNotMatch(workflow, /^\s+(?:github-token|run-id|repository):/m);
});
