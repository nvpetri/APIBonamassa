import { isIP } from "node:net";

export function deployment(env: NodeJS.ProcessEnv = process.env) {
  const name =
    env.APP_ENV ??
    (env.NODE_ENV === "production" ? "production" : "development");
  if (!["development", "test", "staging", "production"].includes(name))
    throw new Error("APP_ENV inválido.");
  const strict = name === "production" || name === "staging";
  const trustedProxies = (env.TRUSTED_PROXY_CIDRS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const entry of trustedProxies) {
    const [ip, prefix, extra] = entry.split("/");
    const family = isIP(ip);
    if (
      !family ||
      extra !== undefined ||
      (prefix !== undefined &&
        (!/^\d+$/.test(prefix) ||
          Number(prefix) < 1 ||
          Number(prefix) > (family === 4 ? 32 : 128)))
    )
      throw new Error(
        "TRUSTED_PROXY_CIDRS aceita somente IPs/CIDRs explícitos; não use true, número de saltos ou rede /0.",
      );
  }
  if (strict) {
    if (env.NODE_ENV !== "production")
      throw new Error("Staging/produção requer NODE_ENV=production.");
    let database: URL;
    try {
      database = new URL(env.DATABASE_URL ?? "");
    } catch {
      throw new Error("DATABASE_URL inválida.");
    }
    if (
      !["postgres:", "postgresql:"].includes(database.protocol) ||
      !database.hostname ||
      database.searchParams.getAll("sslmode").length !== 1 ||
      database.searchParams.getAll("sslaccept").length !== 1 ||
      database.searchParams.get("sslmode") !== "require" ||
      database.searchParams.get("sslaccept") !== "strict"
    )
      throw new Error(
        "Banco de staging/produção requer PostgreSQL com sslmode=require e sslaccept=strict.",
      );
    if (env.DOCS_ENABLED === "true")
      throw new Error("Desative DOCS_ENABLED em staging/produção.");
    if (env.SEED_DEMO === "true")
      throw new Error("SEED_DEMO não é permitido em staging/produção.");
  }
  return { name, strict, trustedProxies };
}
