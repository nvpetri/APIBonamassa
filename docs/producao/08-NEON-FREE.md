# Operação econômica no Neon Free

Estas mudanças não contratam plano, criam réplica ou alteram configurações do Neon/Render automaticamente.

## API e painel

- Métricas: cache em memória de 15 segundos, limitado a 100 combinações de loja/período por processo. Requisições simultâneas compartilham o cálculo. Falhas não ficam no cache. Permissões/sessões são verificadas mesmo quando há cache. Eventos de alteração da loja invalidam seus resultados; alterações externas ou de outra instância aparecem após o TTL. `generatedAt` informa a idade do resultado.
- Pedidos continuam sendo atualizados a cada 5 segundos; na página `/dashboard`, os dados gerais passam a 30 segundos. As métricas só são consultadas enquanto a tela gerencial está montada. Atualizações automáticas param com a aba oculta ou sem rede; retorno à aba retoma a consulta. Requisições automáticas não se sobrepõem.
- A consulta de motoboys ignora pedidos encerrados antes do início do período e cancelados, mantendo todos os pedidos ativos. Os índices existentes por loja/status/data e loja/motoboy já atendem aos filtros principais. Não foi criado índice adicional sem medição de carga real.

## Permitir suspensão quando não houver uso

No serviço da API no Render, configurar `SCHEDULER_INTERVAL_SECONDS=0` e reiniciar o deploy. O padrão continua 15 segundos para preservar instalações existentes.

Com zero, o scanner periódico é desativado. As consultas de catálogo/pedidos e operações que já reconciliam horários continuam conferindo abertura, fechamento e reservas. **Sem nenhuma requisição, uma reserva não é liberada por um relógio em segundo plano: será liberada no próximo acesso pertinente.** Com o painel operacional aberto, a consulta periódica faz essa conferência. Para processamento independente de usuários, manter o scanner e aceitar consumo contínuo.

Não usar pings artificiais ao banco para impedir suspensão. WebSockets conectados ainda validam sessões periodicamente; clientes abertos, tarefas externas ou monitoramento com consulta SQL podem manter o banco ativo. Não enfraquecer revogação de sessão para economizar processamento. A opção zero, isoladamente, não garante suspensão.

Manter inicialmente o mínimo de 0,25 CU e máximo de 2 CU, sujeito aos limites exibidos no projeto. Acompanhar consumo no Neon; não aumentar o mínimo nem criar réplica sem evidência de necessidade.

## Backup diário criptografado, retenção de 7 dias

Workflow `.github/workflows/backup.yml`: execução prevista às 04:30 de São Paulo (07:30 UTC), com possíveis atrasos do GitHub Actions. Fica desativado até a configuração explícita abaixo.

1. Em GitHub → repositório APIBonamassa → Settings → Secrets and variables → Actions, cadastrar:
   - Secret `BACKUP_DATABASE_URL`: conexão **direta** do banco correto, com TLS, sem parâmetros exclusivos do Prisma (`schema`, `sslaccept`, `connection_limit` etc.). Usuário com acesso de leitura a todas as tabelas necessárias; confirmar a versão principal do Postgres. O workflow usa cliente PostgreSQL 17; se o servidor for mais novo, atualizar o cliente antes de ativar.
   - Secret `BACKUP_ENCRYPTION_KEY`: senha aleatória forte com ao menos 32 caracteres. Gerar em gerenciador de senhas e guardar uma cópia fora do GitHub. Sem essa chave não há recuperação. Manter chaves antigas enquanto existirem backups correspondentes.
   - Variable `BACKUP_ENABLED`: `true`.
2. Executar manualmente **Backup criptografado**, baixar o artefato e ensaiar a restauração em banco isolado antes de confiar na rotina.
3. Ativar notificações de falhas do GitHub Actions e conferir o último sucesso. Em repositórios públicos, agendamentos podem ser desativados por inatividade; verificar a execução regularmente.

Somente o `.dump.enc` é enviado como artefato, com retenção de 7 dias. O dump temporário é removido ao concluir/falhar normalmente. A criptografia AES-256-GCM autentica o conteúdo; a chave é derivada com PBKDF2-SHA256, salt aleatório e 200 mil iterações. Credenciais não são colocadas nos argumentos dos processos ou logs. Não publicar arquivos descriptografados, senhas ou dumps no Git.

Para execução local, configurar as duas variáveis de ambiente por um mecanismo seguro e rodar `npm run backup`. Requer Node 24 e `pg_dump`/`pg_restore` compatíveis no PATH. Não precisa instalar as dependências da API.

Para recuperar, disponibilizar `BACKUP_ENCRYPTION_KEY` no ambiente e executar:

```sh
node scripts/decrypt-backup.mjs CAMINHO_DO_BACKUP.dump.enc recuperado.dump
```

O comando recusa chave incorreta, conteúdo adulterado e sobrescrita de arquivo existente. Depois seguir o procedimento de `04-BACKUP.md` para `pg_restore` em **outro banco vazio** e validar pedidos/valores/usuários/imagens. Nunca restaurar diretamente sobre produção como teste.

Esta cópia diária permite voltar ao horário da cópia, com perda potencial de aproximadamente 24 horas se a rotina estiver saudável; não equivale ao histórico contínuo de 7 dias do Neon. Não garante custo zero no GitHub: acompanhar limites de Actions/artefatos da conta.

## Acompanhar espaço e consultas

No SQL Editor do banco correto, estas consultas somente leem metadados:

```sql
SELECT pg_size_pretty(pg_database_size(current_database())) AS database_size;
SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS total_size
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC LIMIT 15;
```

O tamanho físico acima é um diagnóstico; usar o painel Usage do Neon como referência de quota/faturamento. Imagens de produtos ficam no PostgreSQL e contam no espaço utilizado. Acompanhar crescimento e rotinas de manutenção documentadas; não apagar pedidos ou histórico automaticamente para caber no plano. Medir consultas com `EXPLAIN (ANALYZE, BUFFERS)` em homologação representativa antes de adicionar índices; ANALYZE executa a consulta.

Referências: https://neon.com/docs/introduction/plans e https://neon.com/docs/introduction/scale-to-zero. Limites podem mudar; conferir o projeto antes de ativar recursos.
