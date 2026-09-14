# Bonamassa API

API central da Bonamassa, em **NestJS + TypeScript + PostgreSQL + Prisma**. Versão 0.1.0: pedidos persistentes, login por perfil e fluxo completo entre atendimento, cozinha e entregador.

Este repositório fornece o backend. **As demos Android e o painel continuam usando seus bancos locais até a implementação dos adaptadores de integração nos respectivos repositórios.**

## O que está implementado

- Sessões Bearer revogáveis, senhas com scrypt, limitação de tentativas e perfis gestor, atendimento, cozinha, entregador e cliente.
- Cadastro de sabores tradicionais/especiais, bordas, bebidas e combos; preços em centavos e disponibilidade.
- Fotos JPEG/PNG/WebP: validação de conteúdo, otimização e persistência no banco.
- Pizza inteira ou meio a meio; borda por pizza. Combo com receita fixa, preço final próprio e comparação com itens avulsos.
- Promoções por prazo, quantidade ou ambos; percentual ou valor fixo por pizza. Reservas atômicas e histórico do desconto.
- Cotação com validade de 5 minutos e criação idempotente. Preços, taxa, desconto e permissões calculados no servidor.
- Aceite → cozinha → pronto → atribuição → coleta → rota → entrega; retirada no balcão, cancelamento, tentativa e devolução.
- Paginação, versões, snapshots dos pedidos, eventos de auditoria e Socket.IO com avisos filtrados por loja e perfil.
- Migrations, seed, Docker Compose, Swagger e testes HTTP com PostgreSQL no CI.

## Rodar no computador

Requisitos: Node.js 24, npm e Docker Desktop com contêineres Linux. As portas usadas são **3001 para a API**, 5432 para o banco e 3000 para o painel.

```powershell
git clone https://github.com/nvpetri/APIBonamassa.git
cd APIBonamassa
git switch codex/api-central
Copy-Item .env.example .env
npm ci
```

No `.env`, escolha `SEED_MANAGER_EMAIL` e uma senha de 12 a 128 caracteres em `SEED_MANAGER_PASSWORD`. Para experimentar com o cardápio de exemplo, defina `SEED_DEMO=true`. Com `false`, o seed cria somente a loja fechada e o gestor.

`POSTGRES_PASSWORD` é a senha local do PostgreSQL. Se alterá-la, atualize também `DATABASE_URL`. Caracteres especiais na senha precisam de codificação de URL na connection string; para a configuração local do Compose, use uma senha com letras, números, hífen e sublinhado. O valor do exemplo é apenas para desenvolvimento local.

```powershell
docker compose up -d db
npm run db:migrate
npm run build
npm run db:seed
npm run dev
```

No macOS/Linux, use `cp .env.example .env` no lugar de `Copy-Item`.

- Swagger: [http://localhost:3001/v1/docs](http://localhost:3001/v1/docs)
- OpenAPI: [http://localhost:3001/v1/openapi.json](http://localhost:3001/v1/openapi.json)
- Saúde: [http://localhost:3001/v1/health](http://localhost:3001/v1/health)
- Cardápio: [http://localhost:3001/v1/stores/bonamassa/catalog](http://localhost:3001/v1/stores/bonamassa/catalog)

No Swagger, execute `POST /v1/sessions` com `storeSlug`, e-mail e senha. Copie `accessToken` para **Authorize**. Para mutações, informe uma `Idempotency-Key` nova, por exemplo um UUID; se precisar reenviar a mesma ação, repita a chave e o corpo. Edite recursos usando a `version` recebida como `expectedVersion`.

O seed não altera preços, senhas ou abertura de uma loja que já existe. Alterações posteriores devem ser feitas pelos endpoints. Nenhuma credencial real é gravada no código.

## API também em Docker

Depois de configurar o `.env`:

```powershell
docker compose --profile app build api
docker compose --profile app run --rm api npm run db:migrate
docker compose --profile app run --rm api npm run db:seed
docker compose --profile app up -d
```

O volume `postgres-data` preserva os dados. `docker compose down` para os serviços sem apagar esse volume. Migrações são executadas explicitamente antes de iniciar uma versão nova. O Compose é uma configuração local; não fornece domínio, TLS, backup externo ou publicação em produção.

## Testar

```powershell
npm test
npm run check
```

Os testes de integração precisam de **outro banco**, cujo nome contenha `test`:

```powershell
docker compose exec db createdb -U bonamassa bonamassa_test
# Em uma sessão PowerShell dedicada aos testes:
$env:DATABASE_URL = "postgresql://bonamassa:local-only-change-me@localhost:5432/bonamassa_test"
$env:TEST_DATABASE_URL = $env:DATABASE_URL
npm run db:migrate
npm run test:integration
```

Se o banco de teste já existir, não repita `createdb`. Use a senha configurada no seu `.env`. O CI prepara esse banco em PostgreSQL 17. A suíte cria lojas com nomes aleatórios e remove somente os dados dessas lojas ao terminar; não use o banco operacional.

Com uma API de desenvolvimento aberta e o cardápio cadastrado, em outro terminal:

```powershell
npm run smoke
```

Esse comando **cria e conclui um pedido de teste de retirada** usando o gestor configurado. Valida cotação, envio repetido, preparo e conclusão. Use somente em ambiente de desenvolvimento.

## Integração dos outros projetos

| Projeto                                                               | Próxima alteração                                                                         |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [BonamassaPainel](https://github.com/nvpetri/BonamassaPainel)         | Trocar o repositório IndexedDB por chamadas autenticadas; conectar cozinha e expedição.   |
| [BonamassaAndroid](https://github.com/nvpetri/BonamassaAndroid)       | Carregar o catálogo, autenticar, cotar e enviar pedidos; remover avanço manual de status. |
| [BonamassaEntregador](https://github.com/nvpetri/BonamassaEntregador) | Substituir entregas de exemplo pelas atribuídas; enviar comandos e reconciliar o retorno. |

Os contratos completos e as diferenças das demos estão em [docs/INTEGRACAO.md](docs/INTEGRACAO.md). A configuração de operação está em [docs/OPERACAO.md](docs/OPERACAO.md).

## Limites desta etapa

O pedido aceita dinheiro ou cartão no recebimento. Um gestor pode registrar um pagamento **conferido externamente**, com referência de auditoria; isso não executa cobrança, Pix ou estorno. Não há integração de gateway, WhatsApp, GPS em tempo real, emissão fiscal, impressão ou publicação dos apps nesta versão.

A taxa de entrega é fixa por loja; a comissão do entregador é separada. Horários, bairros atendidos, cardápio real e regras comerciais ainda precisam ser confirmados com a pizzaria. Os nomes de tamanhos seguem o painel; o app cliente precisa ser alinhado antes de vender.

O servidor atende uma instância da API por enquanto. O banco separa lojas e serializa mutações por estabelecimento; os avisos Socket.IO estão no processo. REST e reconsulta após reconexão são obrigatórios. Não há promessa de sincronização offline nem confirmação de entrega de cada aviso.

## Preparação para produção

Antes de publicar as mudanças, leia o [manual operacional completo](docs/producao/README.md). Inclui novas variáveis obrigatórias, separação de ambientes, deploy sem seed permanente, backup/restore e critérios de liberação. Não mesclar em branch com auto-deploy antes de revisar a configuração.
