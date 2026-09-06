import assert from "node:assert/strict";
import { appendFile, cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkApi } from "../check-api.mjs";

test("requires review for added or missing declarations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "selection-api-check-"));
  try {
    await cp(new URL("../../etc/api/", import.meta.url), directory, { recursive: true });
    await checkApi(directory);
    await appendFile(join(directory, "index.d.ts"), "\nexport type Unreviewed = string;\n");
    await assert.rejects(checkApi(directory), /Declaration changes need review.*\nindex.d.ts/s);
    await rm(join(directory, "index.d.ts"));
    await assert.rejects(checkApi(directory), /Declaration changes need review.*\nindex.d.ts/s);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
