import { z } from "zod";

export function config() {
  const e = z
    .object({
      NODE_ENV: z
        .enum(["development", "test", "production"])
        .default("development"),
      PORT: z.coerce.number().int().min(1).max(65535).default(3001),
      DATABASE_URL: z.string().url(),
      CORS_ORIGINS: z.string().default("http://localhost:3000"),
      DOCS_ENABLED: z.enum(["true", "false"]).default("false"),
      SESSION_HOURS: z.coerce.number().int().min(1).max(24).default(12),
    })
    .parse(process.env);
  const origins = e.CORS_ORIGINS.split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  for (const origin of origins) {
    const url = new URL(origin);
    if (
      url.origin !== origin ||
      !["http:", "https:"].includes(url.protocol) ||
      (e.NODE_ENV === "production" && url.protocol !== "https:")
    )
      throw new Error(
        "CORS_ORIGINS deve conter origens explícitas, HTTPS em produção.",
      );
  }
  return { ...e, origins };
}
