import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const number = "(?:0|[1-9][0-9]*)";
const identifier = `(?:${number}|[0-9]*[A-Za-z-][0-9A-Za-z-]*)`;
const versionPattern = new RegExp(
  `^${number}\\.${number}\\.${number}(?:-(${identifier}(?:\\.${identifier})*))?$`,
);

export function releaseChannel(version, tag) {
  if (typeof version !== "string" || versionPattern.exec(version)?.[0] !== version) {
    throw new Error("Package version must be exact SemVer without build metadata");
  }
  if (tag !== `v${version}`) {
    throw new Error(`Release tag must match package version: v${version}`);
  }
  return version.includes("-") ? "next" : "latest";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const channel = releaseChannel(manifest.version, process.env["GITHUB_REF_NAME"]);
  const tarball = `${manifest.name}-${manifest.version}.tgz`;
  const output = process.env["GITHUB_OUTPUT"];
  if (output) await appendFile(output, `channel=${channel}\ntarball=${tarball}\n`);
  process.stdout.write(`${manifest.version} will publish to ${channel}\n`);
}
