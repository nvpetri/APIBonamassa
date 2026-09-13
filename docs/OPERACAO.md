# Operação da base 0.1.0

## Configuração

| Variável                                                         | Uso                                                             |
| ---------------------------------------------------------------- | --------------------------------------------------------------- |
| `DATABASE_URL`                                                   | PostgreSQL; `.env` é local e não deve ser versionado.           |
| `PORT`                                                           | Porta HTTP, padrão 3001.                                        |
| `NODE_ENV`                                                       | development, test ou production.                                |
| `CORS_ORIGINS`                                                   | Origens exatas, separadas por vírgula; em produção exige HTTPS. |
| `SESSION_HOURS`                                                  | Duração de 1 a 24 horas, padrão 12.                             |
| `DOCS_ENABLED`                                                   | Swagger público para desenvolvimento/homologação; padrão false. |
| `SEED_STORE_SLUG`, `SEED_MANAGER_EMAIL`, `SEED_MANAGER_PASSWORD` | Configuração do bootstrap, sem senha embutida.                  |
| `SEED_DEMO`                                                      | Exemplos apenas quando true; recusado com NODE_ENV=production.  |
| `TEST_DATABASE_URL`                                              | Banco separado para testes de integração.                       |

O seed é explícito e não roda no startup padrão (`npm start` ou o CMD do Dockerfile). O comando opcional `npm run start:deploy`, descrito abaixo, executa migrations e seed antes de iniciar a API. O seed não sobrescreve preços ou credenciais existentes. Para uma nova loja operacional, execute com `SEED_DEMO=false`, depois cadastre dados oficiais usando o gestor. Cadastros públicos são sempre clientes; criação de equipe exige gestor autenticado. Não há recuperação de senha por e-mail nesta etapa.

## Render com PostgreSQL no Neon

No Render, use um **Web Service** com Language `Docker`, Docker Build Context Directory `.` e Dockerfile Path `./Dockerfile`. Configure o Health Check Path como `/v1/health`. No campo **Docker Command**, use somente:

```sh
npm run start:deploy
```

Esse comando usa o shell do npm dentro do contêiner Linux para executar `db:migrate`, `db:seed` e a API, nessa ordem. Se uma etapa falhar, a API não inicia. Não envolva o comando do campo do Render em aspas ou em outra chamada a `/bin/sh -c`. O campo Pre-Deploy Command pode ficar vazio no plano Free.

Defina no Render `NODE_ENV=production`, `DATABASE_URL` com a conexão direta do Neon completa (incluindo os parâmetros SSL), `SEED_STORE_SLUG=bonamassa`, `SEED_MANAGER_EMAIL`, `SEED_MANAGER_PASSWORD` (12 a 128 caracteres) e `SEED_DEMO=false`. Mantenha as credenciais apenas nas variáveis do serviço. A inicialização não transfere o banco local: em um banco vazio cria uma loja fechada e o gestor. Cardápio, equipe e dados existentes exigem cadastro ou transferência à parte.

Defina também `CORS_ORIGINS` explicitamente. Para o painel Next.js que encaminha chamadas pelo servidor e os aplicativos Android nativos, o valor pode ser vazio. Se um frontend no navegador acessar a API diretamente, liste suas origens HTTPS exatas, separadas por vírgula. O Render define `PORT` e a API escuta em `0.0.0.0`.

Depois do deploy, confirme que `/v1/health` retorna `status: "ok"` e que o gestor consegue fazer login. A cada reinício, o comando aplica somente migrations pendentes e preserva os cadastros e senhas existentes no seed. O comando padrão do Dockerfile permanece disponível para infraestruturas que executam migrations e seed separadamente.

## Banco e concorrência

Escritas da mesma loja adquirem `pg_advisory_xact_lock` **antes** de ler o estado, usando READ COMMITTED. Isso serializa criação de pedidos, edição do catálogo, promoções e ações da equipe no estabelecimento. Lojas diferentes usam chaves distintas. As consultas do catálogo usam snapshot REPEATABLE READ. Para o volume inicial de uma pizzaria, esse desenho prioriza a integridade; maior escala exige medir contenção e granularizar bloqueios.

Valores monetários não usam float. O banco impõe integridade de soma, cota promocional, estados de entrega, referências entre lojas e unicidade de cotação, número e chave de idempotência. Pedidos e eventos não são editados por rotas genéricas. Os detalhes e preços são snapshots JSON; os vínculos operacionais e contadores usam colunas relacionais.

As chaves de idempotência ficam persistidas sem expiração nesta versão. A resposta salva pode conter dados do pedido e é acessível somente ao autor autenticado com o perfil adequado. Definir retenção operacional antes de crescer a base; não apagar chaves isoladamente enquanto clientes puderem reenviar comandos antigos.

## Limites de operação

- Até 200 produtos, 500 campanhas e 100 funcionários por loja; cadastro público de clientes não usa esse limite de equipe.
- Até 30 linhas por pedido, 20 unidades por linha, 2 sabores por pizza e 6 componentes por combo.
- Subtotal dos produtos e total máximo por pedido: 10.000.000 centavos cada. Desconto não amplia esse limite. Taxa de entrega e comissão: até 10.000 centavos cada.
- Corpo JSON até 256 KB. Foto até 5 MB/16 MP na entrada, WebP até 1 MB ao armazenar. Até 100 MB de fotos por loja.
- Limitação persistida de requisições por IP; login também limitado por conta/loja. Headers X-Forwarded-For não são confiados por padrão.
- Sem geocodificação ou validação da região de entrega. Abrir loja é um comando explícito, sem agenda automática.

## Processo e manutenção

Use uma instância da API para os avisos Socket.IO. Várias instâncias compartilham corretamente as transações do banco, mas não propagam avisos entre processos: antes de escalar, implemente transporte compartilhado/outbox e mantenha reconciliação REST. O cliente deve indicar comandos pendentes e consultar novamente após reconexão; a API não mantém fila offline no aparelho.

Execute `npm run maintenance` periodicamente pela infraestrutura: remove sessões e limites expirados, cotações abandonadas há mais de 24 horas sem pedido e fotos órfãs há mais de 24 horas. Não remove pedidos, auditoria, campanhas ou chaves de idempotência. O comando não foi agendado automaticamente no ambiente do usuário.

Mantenha backup do PostgreSQL, que também contém as fotos, e teste sua restauração. O volume Docker local protege contra reinício, não contra perda do computador. A migration inicial é aditiva; não execute reset/drop na base operacional. Revisões posteriores devem usar novas migrations.

O servidor não publica domínio nem configura TLS. Na implantação, use HTTPS, PostgreSQL protegido, credenciais próprias e CORS da origem do painel. Defina DOCS_ENABLED=false se não quiser expor a especificação. Caso um proxy fique à frente da API, configure a confiança em IPs conhecidos explicitamente; não habilite trust proxy irrestrito. Sem isso, o limitador agrupa acessos pelo IP do proxy.

## Pagamento e distribuição

Dinheiro/cartão são preferências de recebimento, e `paymentCollected` é confirmação operacional. `record-payment` registra uma conferência externa com referência; não chama adquirente. Reembolsos, conciliação, Pix, webhooks e recebimento online precisam de integração própria. Pedidos confirmados não significam pagamento aprovado.

Rastreamento GPS, WhatsApp, push, fiscal, impressão, relatórios financeiros e distribuição dos Android não estão implementados aqui. Esta entrega prepara a integração das três interfaces; homologação do fluxo com a pizzaria e dados oficiais continua necessária.

## Dependências e validação

Versões e lockfile estão fixados. Overrides de `multer` e `deepmerge-ts` mantêm versões corrigidas dentro da árvore do Nest/Prisma; ambos devem passar novamente por upload, migrations e testes HTTP quando atualizados. Sharp também usa versão corrigida. Referências: [Multer](https://github.com/advisories/GHSA-wc9g-mqfw-jrwm), [DeepmergeTS](https://github.com/advisories/GHSA-ggr8-5vv4-36mx) e [Sharp](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c).

O CI executa build TypeScript, formatação, testes de preço e testes HTTP/Socket.IO com PostgreSQL 17. Os cenários cobrem promoção concorrente, reenvio de comandos, snapshots, cozinha sem dados privados, isolamento por loja e cliente, entregador atribuído, revogação, foto validada e persistência após reinício da API.
