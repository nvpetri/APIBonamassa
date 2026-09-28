import { encrypt } from "./backup-crypto.mjs";
import { spawn } from "node:child_process";
import { mkdtemp, chmod, rename, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Credentials stay in child environment variables, never process arguments/logs.
const url = new URL(process.env.BACKUP_DATABASE_URL || "missing:");
const secret = process.env.BACKUP_ENCRYPTION_KEY || "";
if (
  !["postgres:", "postgresql:"].includes(url.protocol) ||
  !url.hostname ||
  secret.length < 32
)
  throw new Error(
    "Configure BACKUP_DATABASE_URL e BACKUP_ENCRYPTION_KEY (mínimo 32 caracteres).",
  );
const allowed = new Set([
  "sslmode",
  "sslrootcert",
  "channel_binding",
  "connect_timeout",
]);
for (const key of url.searchParams.keys())
  if (!allowed.has(key))
    throw new Error(
      "Use uma URL direta PostgreSQL, sem parâmetros exclusivos do Prisma/pooler.",
    );
const env = {
  ...process.env,
  PGHOST: url.hostname,
  PGPORT: url.port || "5432",
  PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
  PGUSER: decodeURIComponent(url.username),
  PGPASSWORD: decodeURIComponent(url.password),
  PGSSLMODE: url.searchParams.get("sslmode") || "require",
  PGCONNECT_TIMEOUT: url.searchParams.get("connect_timeout") || "20",
  ...(url.searchParams.has("sslrootcert")
    ? { PGSSLROOTCERT: url.searchParams.get("sslrootcert") }
    : {}),
  ...(url.searchParams.has("channel_binding")
    ? { PGCHANNELBINDING: url.searchParams.get("channel_binding") }
    : {}),
};
delete env.BACKUP_DATABASE_URL;
delete env.BACKUP_ENCRYPTION_KEY;
function run(command, args) {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { env, stdio: "ignore" });
    const timer = setTimeout(() => child.kill("SIGTERM"), 10 * 60_000);
    child.on("error", () => {
      clearTimeout(timer);
      fail(new Error(`${command}: não foi possível executar.`));
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      code === 0
        ? done()
        : fail(
            new Error(
              `${command}: falha; confira conexão, versão e permissões.`,
            ),
          );
    });
  });
}
const directory = await mkdtemp(join(tmpdir(), "bonamassa-backup-"));
await chmod(directory, 0o700);
try {
  const dump = join(directory, "database.dump");
  const encrypted = join(directory, "database.dump.enc");
  await run("pg_dump", [
    "--format=custom",
    "--no-owner",
    "--no-acl",
    "--file",
    dump,
  ]);
  await chmod(dump, 0o600);
  await run("pg_restore", ["--list", dump]);
  await encrypt(dump, encrypted, secret);
  await chmod(encrypted, 0o600);
  const target = resolve(process.env.BACKUP_OUTPUT_DIR || "backup-output");
  await mkdir(target, { recursive: true, mode: 0o700 });
  const name = `bonamassa-${new Date().toISOString().replace(/[:.]/g, "-")}.dump.enc`;
  await rename(encrypted, join(target, name));
  console.log(`Backup criptografado concluído: ${name}`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
