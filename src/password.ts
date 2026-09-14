import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// v2 uses OWASP's 32 MiB scrypt option: N=2^15, r=8, p=3.
// Never take work factors directly from untrusted serialized parameters.
function derive(password: string, salt: string, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(
      password,
      salt,
      64,
      { N: 32768, r: 8, p, maxmem: 128 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
}
export const dummyPasswordHash = `scrypt$v2$${"0".repeat(32)}$${"0".repeat(128)}`;

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$v2$${salt}$${(await derive(password, salt, 3)).toString("hex")}`;
}

export function needsPasswordUpgrade(hash: string) {
  return hash.split("$").length === 3;
}

export async function verifyPassword(password: string, hash: string) {
  const parts = hash.split("$");
  const legacy = parts.length === 3 && parts[0] === "scrypt";
  const current =
    parts.length === 4 && parts[0] === "scrypt" && parts[1] === "v2";
  if (!legacy && !current) return false;
  const salt = parts[legacy ? 1 : 2];
  const expected = parts[legacy ? 2 : 3];
  if (!/^[0-9a-f]{32}$/.test(salt) || !/^[0-9a-f]{128}$/.test(expected))
    return false;
  const actual = await derive(password, salt, legacy ? 1 : 3);
  // Legacy verification retains the old result; extra work avoids making
  // legacy accounts a cheap path compared with missing/current accounts.
  if (legacy) await derive(password, "0".repeat(32), 2);
  return timingSafeEqual(actual, Buffer.from(expected, "hex"));
}
