import assert from "node:assert/strict";
import { test } from "node:test";
import { scrypt } from "node:crypto";
import { dummyPasswordHash, hashPassword, needsPasswordUpgrade, verifyPassword } from "../src/password";

test("hash v2 tem salt individual, valida senha e não armazena texto puro", async () => {
  const a = await hashPassword("fixture-password-only");
  const b = await hashPassword("fixture-password-only");
  assert.notEqual(a, b);
  assert.match(a, /^scrypt\$v2\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.equal(a.includes("fixture-password-only"), false);
  assert.equal(await verifyPassword("fixture-password-only", a), true);
  assert.equal(await verifyPassword("wrong-password", a), false);
  assert.equal(needsPasswordUpgrade(a), false);
  assert.equal(await verifyPassword("wrong-password", dummyPasswordHash), false);
});

test("hash legado continua válido e é identificado para atualização", async () => {
  const salt = "1".repeat(32);
  const key = await new Promise<Buffer>((resolve, reject) =>
    scrypt("fixture-password-only", salt, 64, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 },
      (error, key) => error ? reject(error) : resolve(key)),
  );
  const legacy = `scrypt$${salt}$${key.toString("hex")}`;
  assert.equal(needsPasswordUpgrade(legacy), true);
  assert.equal(await verifyPassword("fixture-password-only", legacy), true);
  assert.equal(await verifyPassword("wrong-password", legacy), false);
});

test("formato desconhecido ou malformado não escolhe parâmetros de custo", async () => {
  for (const hash of ["plain-password", "scrypt$v3$a$b", dummyPasswordHash + "$extra", "scrypt$v2$bad$bad"])
    assert.equal(await verifyPassword("password", hash), false);
});
