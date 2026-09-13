import { createApp } from "./app";
import { config } from "./config";

async function main() {
  const app = await createApp();
  await app.listen(config().PORT, "0.0.0.0");
}
main().catch((error: unknown) => {
  console.error(
    "Falha ao iniciar a API:",
    error instanceof Error ? error.message : "Erro desconhecido",
  );
  process.exitCode = 1;
});
