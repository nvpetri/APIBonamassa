import { z } from "zod";
import { deployment } from "./deployment";

export function config(env: NodeJS.ProcessEnv = process.env) {
  const deploy = deployment(env);
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
      CUSTOMER_REGISTRATION_ENABLED: z.enum(["true", "false"]).default("true"),
      EMAIL_API_KEY: z.string().min(1).optional(),
      EMAIL_FROM: z.string().min(3).default("Bonamassa <onboarding@resend.dev>"),
      EMAIL_API_URL: z.string().url().default("https://api.resend.com/emails"),
      VERIFICATION_CODE_MINUTES: z.coerce.number().int().min(5).max(30).default(10),
    })
    .parse(env);
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
  return { ...e, origins, ...deploy };
}
