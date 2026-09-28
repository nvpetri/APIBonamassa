import { decrypt } from "./backup-crypto.mjs";
const [, , input, output] = process.argv;
if (!input || !output)
  throw new Error(
    "Uso: node scripts/decrypt-backup.mjs arquivo.dump.enc recuperado.dump",
  );
try {
  await decrypt(input, output, process.env.BACKUP_ENCRYPTION_KEY);
  console.log(
    "Cópia descriptografada e autenticada; restaure apenas em banco isolado.",
  );
} catch {
  console.error(
    "Falha: verifique chave, integridade do arquivo e caminho de saída (deve ser novo).",
  );
  process.exitCode = 1;
}
