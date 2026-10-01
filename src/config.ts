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
      SCHEDULER_INTERVAL_SECONDS: z.coerce
        .number()
        .int()
        .min(0)
        .max(3600)
        .default(15),
      DATABASE_URL: z.string().url(),
      CORS_ORIGINS: z.string().default("http://localhost:3000"),
      DOCS_ENABLED: z.enum(["true", "false"]).default("false"),
      SESSION_IDLE_DAYS: z.coerce.number().int().min(1).max(30).default(5),
      CUSTOMER_REGISTRATION_ENABLED: z.enum(["true", "false"]).default("true"),
      STAFF_INVITE_URL: z.string().url().optional(),
      MAPS_API_KEY: z.string().min(1).optional(),
      MAPS_API_URL: z
        .string()
        .url()
        .default("https://api.openrouteservice.org/"),
      EMAIL_API_KEY: z.string().min(1).optional(),
      EMAIL_FROM: z
        .string()
        .min(3)
        .default("Bonamassa <onboarding@resend.dev>"),
      EMAIL_API_URL: z.string().url().default("https://api.resend.com/emails"),
      VERIFICATION_CODE_MINUTES: z.coerce
        .number()
        .int()
        .min(5)
        .max(30)
        .default(10),
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
  if (e.STAFF_INVITE_URL) {
    const url = new URL(e.STAFF_INVITE_URL);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      ((deploy.strict || e.NODE_ENV === "production") &&
        url.protocol !== "https:")
    )
      throw new Error(
        "STAFF_INVITE_URL deve ser a URL pública da página /convite, HTTPS em produção, sem credenciais, query ou fragmento.",
      );
  }
  const mapsUrl = new URL(e.MAPS_API_URL);
  if (
    mapsUrl.username ||
    mapsUrl.password ||
    mapsUrl.search ||
    mapsUrl.hash ||
    !["http:", "https:"].includes(mapsUrl.protocol) ||
    (e.NODE_ENV !== "test" && mapsUrl.protocol !== "https:")
  )
    throw new Error(
      "MAPS_API_URL deve usar HTTPS, sem credenciais, query ou fragmento.",
    );
  return { ...e, origins, ...deploy };
}
