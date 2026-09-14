import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { config } from "../src/config";
import { deployment } from "../src/deployment";
import { RateLimitError, retryAfterSeconds } from "../src/rate-limit";

const production = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://user:password@database.example.com/app?sslmode=require&sslaccept=strict",
  CORS_ORIGINS: "",
  DOCS_ENABLED: "false",
  SEED_DEMO: "false",
};

test("produção exige TLS validado, sem demo ou documentação pública", () => {
  assert.equal(config(production).strict, true);
  assert.equal(config({ ...production, APP_ENV: "staging" }).strict, true);
  for (const patch of [
    { DATABASE_URL: "postgresql://user:password@localhost/app" },
    { DATABASE_URL: "postgresql://user:password@host/app?sslmode=require&sslaccept=accept_invalid_certs" },
    { DATABASE_URL: "https://host/app?sslmode=require&sslaccept=strict" },
    { DOCS_ENABLED: "true" },
    { SEED_DEMO: "true" },
    { CORS_ORIGINS: "*" },
    { CORS_ORIGINS: "http://painel.example.com" },
    { APP_ENV: "staging", NODE_ENV: "development" },
    { APP_ENV: "unknown" },
  ]) assert.throws(() => config({ ...production, ...patch }));
});

test("ambiente isolado pode usar banco local sem enfraquecer produção", () => {
  assert.equal(config({ NODE_ENV: "test", DATABASE_URL: "postgresql://user:pass@localhost/app_test" }).strict, false);
});

test("confiança de proxy exige endereços explícitos e recusa curingas", () => {
  assert.deepEqual(deployment({ TRUSTED_PROXY_CIDRS: "127.0.0.1/32,::1/128" }).trustedProxies, ["127.0.0.1/32", "::1/128"]);
  for (const cidrs of ["true", "1", "loopback", "0.0.0.0/0", "::/0", "127.0.0.1/33", "::1/129", "127.0.0.1/-1", "127.0.0.1/1/2"])
    assert.throws(() => deployment({ TRUSTED_PROXY_CIDRS: cidrs }));
});

test("XFF forjado é ignorado sem proxy confiável; cadeia anda da direita para a esquerda", async () => {
  const app = express();
  app.get("/", (req, res) => res.json({ ip: req.ip }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/`;
  try {
    const headers = { "X-Forwarded-For": "198.51.100.99, 203.0.113.22" };
    assert.equal((await (await fetch(url, { headers })).json()).ip, "127.0.0.1");
    app.set("trust proxy", deployment({ TRUSTED_PROXY_CIDRS: "127.0.0.1/32" }).trustedProxies);
    assert.equal((await (await fetch(url, { headers })).json()).ip, "203.0.113.22");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve()));
  }
});

test("Retry-After usa a janela real e nunca é zero", () => {
  assert.equal(retryAfterSeconds(new Date(61_001), 1000), 61);
  assert.equal(retryAfterSeconds(new Date(900_000), 1000), 899);
  assert.equal(retryAfterSeconds(new Date(0), 1000), 1);
  assert.equal(new RateLimitError(60).status, 429);
});
