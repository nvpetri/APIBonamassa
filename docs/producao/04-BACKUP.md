# 4. Backup e recuperação

## O que precisa ser protegido

Banco completo (pedidos, clientes, usuários, preços, promoções, reservas, imagens e histórico), configurações de infraestrutura, segredos em cofre, código/release identificados e chaves de assinatura Android.

Guardar o código no GitHub **não** guarda os pedidos. O filesystem do container não é backup. Exportar só cardápio também não é backup completo.

## Recuperação do provedor

No Neon, verificar no projeto/branch correto a janela de histórico e os recursos de backup/restore incluídos no plano. A disponibilidade e retenção variam; registrar o que está contratado e o que foi testado, sem assumir que “Free guarda tudo”. [Backup e restauração do Neon](https://neon.com/docs/guides/backup-restore).

Definir uma janela suficiente para perceber falhas e reagir. Alertar quando backup falhar ou estiver velho. Além da recuperação do provedor, discutir cópia lógica criptografada fora da mesma conta/provedor, com acesso e retenção controlados.

Snapshot/branch no mesmo provedor não protege contra todo incidente de conta. Backup fora do provedor sem acesso seguro também vira risco de vazamento.

## Exemplo de cópia lógica com PostgreSQL 17

Procedimento manual de referência, **não executado por este trabalho**. Requer ferramentas PostgreSQL instaladas, espaço local protegido, rede e permissões adequadas. Use pg_dump compatível com a versão do servidor (17 para o banco 17).

Antes, confirmar host e banco; usar conta de backup apropriada. Não pôr senha na linha de comando. O exemplo pede a senha de modo interativo.

```powershell
$env:PGSSLMODE = "verify-full"
$env:PGSSLROOTCERT = "C:\seguro\ca-oficial-do-provedor.pem"
pg_dump --host "HOST_CONFIRMADO_DO_BANCO" --username "USUARIO_BACKUP" --dbname "BANCO_CONFIRMADO" --password --format=custom --no-owner --no-acl --file "C:\backups\bonamassa-AAAA-MM-DD.dump"
if ($LASTEXITCODE -ne 0) { throw "Backup falhou; não prossiga para deploy." }
Get-FileHash "C:\backups\bonamassa-AAAA-MM-DD.dump" -Algorithm SHA256
```

A CA é obtida/validada pela orientação oficial do provedor; não existe um arquivo pronto no projeto. Se seu cliente usa uma trust store de sistema corretamente configurada, seguir a configuração correspondente em vez do caminho de exemplo. **Não reduzir a validação TLS para contornar o erro.**

Os parâmetros TLS de pg_dump/libpq (verify-full) não são idênticos aos do Prisma. O formato custom facilita restauração controlada; o dump é uma cópia lógica consistente, mas não inclui papéis globais, DNS ou segredos externos. Registrar também essas dependências. [Manual do pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html).

Criptografar e transferir o arquivo para armazenamento restrito aprovado, com retenção. O hash detecta alteração acidental; não é criptografia nem demonstra que o restore funciona. Nunca anexar dump ao GitHub, chat, CI ou relatório público.

## Ensaio de restauração — antes do primeiro cliente real

1. Criar **outro banco vazio**, por exemplo bonamassa_restore_test, sem ligação com o serviço de produção.
2. Registrar origem do backup, data, hash e alvo da recuperação.
3. Confirmar visualmente que o host/usuário/banco são do ambiente de recuperação. Não usar o host de produção como destino.
4. Restaurar sem --clean, sem reset e com interrupção no primeiro erro:

```powershell
pg_restore --host "HOST_ISOLADO_DE_RECUPERACAO" --username "USUARIO_RESTORE" --dbname "bonamassa_restore_test" --password --no-owner --no-privileges --single-transaction --exit-on-error "C:\backups\bonamassa-AAAA-MM-DD.dump"
if ($LASTEXITCODE -ne 0) { throw "Restore falhou; registrar e investigar." }
```

5. Usar o commit compatível com o backup/esquema. Conferir migrações aplicadas, contagem de pedidos e valores totais em amostra, produtos/imagens, reservas, usuários e histórico.
6. Subir a API de recuperação em ambiente restrito, sem tráfego de clientes, integrações externas ou notificações. Validar login e leitura; usar somente dados fictícios para ensaiar comandos.
7. Medir tempo total desde a declaração da falha até a validação. Registrar o ponto recuperado e a perda de dados observada.
8. Aprovar ou corrigir o procedimento. Só depois considerar a meta RTO/RPO cumprida.

Uma restauração de produção contém dados pessoais, hashes de senha e sessões. **Não expor essa cópia como demo**. Antes de reutilizar em homologação, revogar sessões da cópia e anonimizar dados por procedimento específico revisado. Não executar limpezas genéricas no banco original.

## Se a recuperação for real

Suspender novos pedidos **e reservas**, preservar evidências, avisar o gerente, identificar o ponto de recuperação e aprovar o impacto. Fechar a loja no painel não basta: com reservas habilitadas a API continua aceitando pedidos agendados.

O produto ainda não possui um modo completo de manutenção/bloqueio de todos os novos pedidos. Usar um bloqueio controlado de tráfego/serviço no procedimento de incidente, sabendo que isso pode interromper equipe e acompanhamento; reconciliar os pedidos em atendimento por canal alternativo. Esta capacidade de manutenção granular continua no backlog.

Depois de restaurar, conferir pedidos recebidos/entregues/pagos após o ponto restaurado com os registros operacionais da pizzaria. Não marcar pagamento ou entrega automaticamente para “acertar o banco”. Reabrir somente com responsável presente.

## Registro mínimo do ensaio

| Campo | Preencher |
| --- | --- |
| Data/responsável | |
| Backup e ponto no tempo | |
| Banco de destino isolado | |
| Commit/schema usados | |
| Tempo até recuperação validada | |
| Pedidos/imagens/reservas conferidos | |
| Perda observada e reconciliação | |
| Problemas e correções | |
| Próximo ensaio | |

Ensaiar antes do lançamento, após mudanças relevantes e periodicamente conforme o risco. Não marcar este capítulo como aprovado só porque a documentação existe.
