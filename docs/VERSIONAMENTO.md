# Versão da API e identificação do deploy

## Decisão da consolidação

A única versão declarada até 28/09/2026 era 0.1.0. O histórico contém novas funcionalidades, correções e mudanças de contrato, sem tags/releases intermediários. A próxima versão consolidada é **0.2.0**: incremento MINOR, PATCH zerado e MAJOR zero enquanto o projeto segue em desenvolvimento/homologação. Não existe um cálculo único baseado no total de commits: merges, testes, formatação e vários commits da mesma funcionalidade não representam releases independentes. O [CHANGELOG](../CHANGELOG.md) registra o levantamento e as incompatibilidades acumuladas.

Usamos [Semantic Versioning](https://semver.org/lang/pt-BR/). Durante 0.x, adições e mudanças de contrato são entregues em novo MINOR, com os consumidores atualizados quando necessário. Correções compatíveis usam PATCH. A aprovação de 1.0.0 estabelece o contrato estável de produção; a partir daí, incompatibilidades exigem novo MAJOR e um plano de migração dos consumidores.

## Fonte única e health

`package.json.version` é a fonte da versão. TypeScript copia o pacote para `dist/package.json`; health e OpenAPI importam esse mesmo valor da compilação. Não há `API_VERSION` manual nem dependência de `npm_package_version`, e o processo pode iniciar diretamente com Node no Docker.

`GET /v1/health` continua executando `SELECT 1` antes de responder. Exemplo sem metadado Git:

```json
{ "status": "ok", "version": "0.2.0", "commit": null }
```

No Render, `commit` usa `RENDER_GIT_COMMIT`, fornecido pela plataforma também para Docker ([documentação](https://render.com/docs/environment-variables)). Fora do Render, pode-se fornecer `APP_COMMIT_SHA` ao iniciar o contêiner/processo. Informe o SHA completo de 40 caracteres dos fontes da imagem. Valor ausente ou inválido resulta em `null`; o programa não inventa um hash. Não passe o SHA de outro repositório ou do checkout do servidor que apenas executa uma imagem antiga.

A versão identifica a entrega; o commit identifica a revisão exata. O prefixo `/v1` é a família de rotas e não muda a cada release MINOR/PATCH. Cada aplicativo/painel mantém sua versão própria.

## Próximas alterações

| Alteração da API                                     | Próxima versão a partir de 0.2.0 | Comando                                                    |
| ---------------------------------------------------- | -------------------------------- | ---------------------------------------------------------- |
| Correção compatível                                  | 0.2.1                            | `npm version patch --no-git-tag-version`                   |
| Funcionalidade ou evolução de contrato em 0.x        | 0.3.0                            | `npm version minor --no-git-tag-version`                   |
| Estabelecimento do contrato estável                  | 1.0.0                            | `npm version 1.0.0 --no-git-tag-version`                   |
| Somente documentação/testes sem alteração executável | Mantém a versão                  | Atualizar o documento/teste; o commit distingue a revisão. |

1. Classificar o conjunto de mudanças da entrega, atualizar a versão com o comando adequado e acrescentar a seção correspondente no changelog.
2. Executar `npm run release:check`, `npm test` e `npm run check`. CI também valida integração real e o health na imagem Docker.
3. Publicar a entrega e implantar o mesmo commit no ambiente desejado. Conferir `version` e `commit` no health após o deploy.

Em pull requests e pushes em `main`, o CI compara a base e recusa alterações em `src/`, `prisma/`, `scripts/`, pacotes, Docker ou workflow de backup sem incremento de versão. Também recusa regressão numérica, lockfile divergente ou versão sem entrada no changelog. Em branches de trabalho, valida a consistência; a comparação da entrega ocorre contra a base do PR. Os números usados pelo projeto são tripletas MAJOR.MINOR.PATCH; homologação e produção são ambientes do mesmo artefato, não números diferentes por ambiente.

Essa verificação não escolhe automaticamente a categoria: quem altera o contrato precisa declarar seu impacto. Não depende de prefixos `feat`/`fix`, pois o histórico possui mensagens em formatos diferentes. Ela falha de forma visível se a atualização da versão for esquecida.
