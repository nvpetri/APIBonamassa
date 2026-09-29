# Versão da API e identificação do deploy

## Reconstrução das versões

A versão atual é **0.12.1**, resultante da classificação individual dos 67 commits anteriores até `77c1c93`, com um PATCH para corrigir a numeração nesta revisão. A [relação integral](HISTORICO-COMMITS.md) contém hash, mensagem original, categoria, ciclo atribuído e justificativa de cada commit. Foram identificados 12 ciclos funcionais/operacionais, incluindo a implementação inicial, com correções PATCH entre eles.

A consolidação anterior em 0.2.0 agrupou excessivamente a evolução. Ela foi substituída pela reconstrução solicitada: cada ciclo distinto recebe seu incremento, componentes da mesma funcionalidade compartilham o ciclo, e merges comuns/testes/documentação/formatação equivalente não criam novas versões funcionais. A análise considera o código alterado, inclusive correções de compilação escondidas em mensagens de formatação.

Os números antigos são uma classificação retrospectiva, não tags/releases que existiam na época. O Git original é preservado. O [CHANGELOG](../CHANGELOG.md) registra a versão efetiva atual e mantém a evidência da consolidação anterior.

Seguimos a convenção [Semantic Versioning](https://semver.org/lang/pt-BR/): durante 0.x, novas capacidades e mudanças de contrato elevam MINOR; correções compatíveis elevam PATCH. Cada MINOR zera PATCH. A passagem a 1.0.0 estabelecerá o contrato estável de produção; incompatibilidades posteriores exigirão MAJOR e migração coordenada dos consumidores. O total de versões históricas é resultado do agrupamento documentado, não uma propriedade automática ou única do Git.

## Fonte única e health

`package.json.version` é a fonte da versão. TypeScript copia o pacote para `dist/package.json`; health e OpenAPI importam esse mesmo valor da compilação. Não há `API_VERSION` manual nem dependência de `npm_package_version`, e o processo pode iniciar diretamente com Node no Docker.

`GET /v1/health` continua executando `SELECT 1` antes de responder. Exemplo sem metadado Git:

```json
{ "status": "ok", "version": "0.12.1", "commit": null }
```

No Render, `commit` usa `RENDER_GIT_COMMIT`, fornecido pela plataforma também para Docker ([documentação](https://render.com/docs/environment-variables)). Fora do Render, pode-se fornecer `APP_COMMIT_SHA` ao iniciar o contêiner/processo. Informe o SHA completo de 40 caracteres dos fontes da imagem. Valor ausente ou inválido resulta em `null`; o programa não inventa um hash. Não passe o SHA de outro repositório ou do checkout do servidor que apenas executa uma imagem antiga.

A versão identifica a entrega; o commit identifica a revisão exata. O prefixo `/v1` é a família de rotas e não muda a cada release MINOR/PATCH. Cada aplicativo/painel mantém sua versão própria.

## Próximas alterações

| Alteração da API                                     | Próxima versão a partir de 0.12.1 | Comando                                                    |
| ---------------------------------------------------- | --------------------------------- | ---------------------------------------------------------- |
| Correção compatível                                  | 0.12.2                            | `npm version patch --no-git-tag-version`                   |
| Funcionalidade ou evolução de contrato em 0.x        | 0.13.0                            | `npm version minor --no-git-tag-version`                   |
| Estabelecimento do contrato estável                  | 1.0.0                             | `npm version 1.0.0 --no-git-tag-version`                   |
| Somente documentação/testes sem alteração executável | Mantém a versão                   | Atualizar o documento/teste; o commit distingue a revisão. |

1. Classificar o conjunto de mudanças da entrega, atualizar a versão com o comando adequado e acrescentar a seção correspondente no changelog.
2. Executar `npm run release:check`, `npm test` e `npm run check`. CI também valida integração real e o health na imagem Docker.
3. Publicar a entrega e implantar o mesmo commit no ambiente desejado. Conferir `version` e `commit` no health após o deploy.

Em pull requests e pushes em `main`, o CI compara a base e recusa alterações em `src/`, `prisma/`, `scripts/`, pacotes, Docker ou workflow de backup sem incremento de versão. Também recusa regressão numérica, lockfile divergente ou versão sem entrada no changelog. Em branches de trabalho, valida a consistência; a comparação da entrega ocorre contra a base do PR. Os números usados pelo projeto são tripletas MAJOR.MINOR.PATCH; homologação e produção são ambientes do mesmo artefato, não números diferentes por ambiente.

Essa verificação não escolhe automaticamente a categoria: quem altera o contrato precisa declarar seu impacto. Não depende de prefixos `feat`/`fix`, pois o histórico possui mensagens em formatos diferentes. Ela falha de forma visível se a atualização da versão for esquecida.
