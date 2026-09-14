import { config } from "../src/config";

// Local validation only: no network, database writes or secret values in output.
try {
  const result = config();
  if (!result.strict || result.NODE_ENV !== "production")
    throw new Error("Use APP_ENV=production ou staging e NODE_ENV=production.");
  console.log("Configuração de produção: TLS do banco, CORS e flags validados.");
  if (!result.trustedProxies.length)
    console.warn(
      "PENDENTE: proxies não configurados. Limites anônimos podem ser compartilhados; valide a topologia em homologação.",
    );
  if (result.CUSTOMER_REGISTRATION_ENABLED === "true")
    console.warn(
      "PENDENTE: cadastro público sem verificação de contato. Validar proteção contra abuso antes do lançamento aberto.",
    );
  console.log(
    "Este check não comprova conectividade, backup, capacidade ou segurança completa.",
  );
} catch {
  console.error(
    "Configuração reprovada. Confira docs/producao/02-CONFIGURACAO.md. Nenhum segredo foi impresso.",
  );
  process.exitCode = 1;
}
