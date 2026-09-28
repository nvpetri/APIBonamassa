import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encrypt, decrypt } from "../scripts/backup-crypto.mjs";
test("encrypted backup roundtrip rejects corruption/wrong keys and preserves existing files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "backup-test-"));
  const path = (name) => join(dir, name);
  const key = "test-only-encryption-key-32-characters-long";
  try {
    await writeFile(path("source"), "private backup contents");
    await encrypt(path("source"), path("encrypted"), key);
    await decrypt(path("encrypted"), path("restored"), key);
    assert.equal(
      await readFile(path("restored"), "utf8"),
      "private backup contents",
    );
    await assert.rejects(
      decrypt(path("encrypted"), path("wrong-key"), key + "wrong"),
    );
    await assert.rejects(decrypt(path("encrypted"), path("restored"), key));
    const damaged = await readFile(path("encrypted"));
    damaged[40] ^= 1;
    await writeFile(path("damaged"), damaged);
    await assert.rejects(decrypt(path("damaged"), path("bad"), key));
    assert.deepEqual((await readdir(dir)).sort(), [
      "damaged",
      "encrypted",
      "restored",
      "source",
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
