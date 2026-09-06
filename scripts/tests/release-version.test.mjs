import assert from "node:assert/strict";
import { test } from "node:test";
import { releaseChannel } from "../release-version.mjs";

test("routes stable and prerelease versions to separate npm tags", () => {
  for (const version of ["1.0.0", "0.9.2", "12.40.103"]) {
    assert.equal(releaseChannel(version, `v${version}`), "latest");
  }
  for (const version of ["1.0.0-rc.1", "2.0.0-beta.0", "1.0.0-0", "1.0.0-alpha-1"]) {
    assert.equal(releaseChannel(version, `v${version}`), "next");
  }
});

test("rejects mismatched tags before publishing", () => {
  for (const tag of [undefined, "main", "1.0.0", "v1.0.1", "v1.0.0-rc.1"]) {
    assert.throws(() => releaseChannel("1.0.0", tag), /Release tag must match/);
  }
});

test("rejects loose versions, build metadata and unsafe output", () => {
  for (const version of [
    "1",
    "1.0",
    "v1.0.0",
    "01.0.0",
    "1.01.0",
    "1.0.01",
    "1.0.0-01",
    "1.0.0-rc.01",
    "1.0.0-",
    "1.0.0-rc..1",
    "1.0.0+build.1",
    "1.0.0\nlatest",
    "1.0.0\n",
    " 1.0.0",
    "1.0.0 ",
  ]) {
    assert.throws(() => releaseChannel(version, `v${version}`), /exact SemVer/);
  }
});
