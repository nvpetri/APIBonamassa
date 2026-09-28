# Auditoria das gravações

`AuditTrail` é a trilha central, criada pela migração `202609280002_audit_trail`. `Audit` e `OrderEvent` continuam existindo, preservando seus históricos e contratos. Não há reconstrução artificial de valores anteriores à instalação da migração.

## Cobertura

Triggers transacionais capturam INSERT, UPDATE e DELETE em Store, User, Product, ProductImage, Promotion, Order, OrderEvent, Session, VerificationCode, StaffInvitation e Audit. Alterações SQL também são registradas. Uma transação revertida reverte sua trilha; repetições idempotentes não executam novamente a gravação. Atualizações que não mudam valores são ignoradas.

Quote (cotação temporária), Idempotency (respostas técnicas) e RateBucket (limitação de requisições) não são duplicadas na trilha. Renovações rotineiras de expiresAt/lastActivityAt de Session são ignoradas; criação, exclusão e outras alterações de sessão são registradas. Não é um log de visualizações, tentativas HTTP rejeitadas ou comandos SQL malsucedidos. O middleware de erros mantém seu mecanismo separado.

Cada linha registra loja, tabela, ID do registro, operação, caminhos dos campos alterados, antes/depois saneados, identidade da conta no momento, perfil, conta de setor, origem, cliente declarado, requestId gerado pelo servidor, ID da sessão (nunca o token), hash da chave de idempotência, ação, método/caminho HTTP sem query string, IP observado pela API, agente HTTP, usuário técnico do banco, ID da transação e horário UTC. O ID sequencial permite paginação; lacunas por rollback são normais e não provam exclusão de registros.

`ATTENDANT` e `KITCHEN` são marcados como contas de setor, conforme o modelo operacional. O histórico não identifica qual pessoa física usava uma conta compartilhada. Nome/perfil ficam gravados no momento da ação, mesmo após renomear ou excluir a conta.

## Atribuição

O contexto de requisição é isolado por AsyncLocalStorage e aplicado com `set_config(..., true)` dentro da transação. A identidade vem da autenticação da API ou de um código/convite validado, nunca do corpo enviado pelo cliente. O contexto local não persiste ao devolver a conexão ao pool. Agendamento automático usa SYSTEM, mantendo requestId quando a rotina foi acionada por uma consulta HTTP.

Sem contexto da aplicação, a origem é SQL, o usuário humano não é inventado e o usuário técnico da conexão fica registrado. Scripts que usam Prisma diretamente, sem contexto, também aparecem assim. Credenciais técnicas individuais ajudam a distinguir operadores. Não se deve interpretar o nome da conta PostgreSQL compartilhada como identificação de uma pessoa.

`X-Client-Source` declara PANEL, CUSTOMER_APP ou DRIVER_APP; versões antigas aparecem como UNSPECIFIED. Este cabeçalho e User-Agent podem ser falsificados: são pistas de diagnóstico, não autenticação. No painel, o IP observado pela API pode ser do servidor intermediário; não se fabrica um IP do navegador a partir de cabeçalhos não confiáveis.

## Dados protegidos

Senhas e hashes, tokens, códigos secretos, cookies, credenciais e bytes de imagens não entram nos snapshots. A limpeza é recursiva para JSON. Contatos, endereço, cliente, destinatário, observações, motivos e referências livres são substituídos por `[REDACTED]`. O caminho do campo alterado continua registrado; seu valor protegido não é recuperável pela auditoria. Metadados de imagem, como digest e ID, permitem rastrear a troca sem duplicar a foto.

Nomes das contas, IDs, IP e User-Agent permanecem dados de acesso restrito. Não inserir segredos em nomes de produtos, campos comerciais ou outros lugares destinados a texto público. Auditoria não deve ser um segundo cofre de senhas.

## Consulta e proteção

Somente MANAGER pode usar GET `/v1/staff/audit` e `/v1/staff/audit/:id`. O filtro de loja vem da sessão; IDs de outra loja retornam 404. A listagem exige datas ISO UTC, período de até 93 dias, até 100 linhas por página e cursor; snapshots são carregados somente no detalhe. Filtros: table, recordId, actorId, requestId, operation e origin. O painel oferece a consulta em Configurações → Consultar auditoria.

Não existem endpoints para editar/apagar registros. Triggers recusam UPDATE, DELETE e TRUNCATE da trilha e TRUNCATE das tabelas auditadas. Isso não protege contra o proprietário/superusuário que deliberadamente desabilite triggers, altere funções ou exclua a tabela. Não é uma trilha criptograficamente inviolável. Separar a conta de migração/proprietária da conta da aplicação; a migração usa função SECURITY DEFINER com search_path fixo para escrever a trilha. Não conceder privilégios de proprietário à operação diária. A conta de leitura do gerente só é exposta pela API, nunca por credencial PostgreSQL no navegador.

## Implantação e armazenamento

Aplicar `npm run db:migrate` antes da API/painel novos. A migração instala triggers; validar em homologação e manter o backup existente. As tabelas antigas não são descartadas. Ensaiar tanto gravações pela API quanto scripts administrativos com as permissões reais do runtime.

O histórico cresce com as gravações, especialmente pedidos e seus eventos. Consultas não fazem polling da auditoria. Monitorar tamanho de AuditTrail e a quota do Neon; não prometer retenção ilimitada no Free. Nenhuma limpeza automática foi acrescentada: eventual política de retenção/exportação precisa de um procedimento administrativo próprio, preservando evidência e backups. O backup completo passa a incluir a trilha. Restaurar em um banco vazio, conforme o runbook; copiar dados para homologação exige tratar também os dados pessoais da auditoria antes de liberar o acesso.
