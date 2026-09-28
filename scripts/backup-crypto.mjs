import {
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
  randomBytes,
} from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, appendFile, rm, link, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
const magic = Buffer.from("BONABKP1");
const derive = (secret, salt) => {
  if (!secret || secret.length < 32)
    throw new Error("Chave de backup ausente ou muito curta.");
  return pbkdf2Sync(secret, salt, 200_000, 32, "sha256");
};
export async function encrypt(input, output, secret) {
  const salt = randomBytes(16),
    iv = randomBytes(12);
  const header = Buffer.concat([magic, salt, iv]);
  const cipher = createCipheriv("aes-256-gcm", derive(secret, salt), iv);
  cipher.setAAD(header);
  const handle = await open(output, "wx", 0o600);
  await handle.write(header);
  await handle.close();
  try {
    await pipeline(
      createReadStream(input),
      cipher,
      createWriteStream(output, { flags: "a" }),
    );
    await appendFile(output, cipher.getAuthTag());
  } catch (error) {
    await rm(output, { force: true });
    throw error;
  }
}
export async function decrypt(input, output, secret) {
  const size = (await stat(input)).size;
  if (size < 53) throw new Error("Backup inválido.");
  const handle = await open(input, "r");
  const header = Buffer.alloc(36),
    tag = Buffer.alloc(16);
  try {
    await handle.read(header, 0, 36, 0);
    await handle.read(tag, 0, 16, size - 16);
  } finally {
    await handle.close();
  }
  if (!header.subarray(0, 8).equals(magic))
    throw new Error("Formato de backup desconhecido.");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    derive(secret, header.subarray(8, 24)),
    header.subarray(24),
  );
  cipher.setAAD(header);
  cipher.setAuthTag(tag);
  const temporary = `${output}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await pipeline(
      createReadStream(input, { start: 36, end: size - 17 }),
      cipher,
      createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
    );
    // Only expose a verified dump; refuse to replace an existing output file.
    await link(temporary, output);
  } finally {
    await rm(temporary, { force: true });
  }
}
