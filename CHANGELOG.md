# Histórico da API Bonamassa

## [0.12.1] - 2026-09-28

Corrige a numeração do pacote e do health após classificação de todos os 67 commits anteriores. A sequência reconstruída chega a 0.12.0 no commit `77c1c93` (metadados de deploy e CI); esta correção de numeração é o PATCH 0.12.1.

A [relação integral de commits](docs/HISTORICO-COMMITS.md) registra cada hash, categoria e versão atribuída. Os marcos funcionais são: 0.1 API central; 0.2 agendamentos; 0.3 segurança/preflight; 0.4 atualização de hashes; 0.5 endereços/rotas; 0.6 verificação/reset; 0.7 sessões deslizantes; 0.8 métricas; 0.9 convites; 0.10 backups/Neon; 0.11 auditoria; 0.12 metadados de deploy/versionamento. As correções intermediárias estão discriminadas no levantamento.

As versões históricas são atribuídas retrospectivamente, sem reescrever commits ou inventar tags/deploys passados. O registro de 0.2.0 abaixo preserva a versão efetivamente gravada pela consolidação anterior, agora substituída; não deve ser confundido com o ciclo 0.2.0 de agendamento na reconstrução.

Health e Swagger continuam lendo `package.json`. Não há alteração funcional nem migration nova nesta revisão. Próximos incrementos: 0.12.2 para correção compatível ou 0.13.0 para nova funcionalidade.

## [0.2.0] - 2026-09-28

Primeira consolidação do versionamento após a base 0.1.0. O levantamento encontrou 66 commits alcançáveis em `main` até `07a7395`, dos quais 64 posteriores à implementação inicial `8b5e602` (incluindo merges, testes e formatação). Não havia tags ou GitHub Releases. O pacote, health e Swagger ainda declaravam 0.1.0 em todas essas revisões. Os marcos abaixo são mudanças verificadas nos commits, sem atribuir versões retroativas que não foram publicadas.

| Data  | Marco                                                             | Commits de referência           | Impacto                                                                                                     |
| ----- | ----------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 13/09 | Limites monetários e inicialização no Render                      | `f491bf2`, `08f1da9`, `54a1007` | Correções de integridade e deploy.                                                                          |
| 14/09 | Horários da loja e pedidos agendados persistentes                 | `0277f55`, `d8bb493`            | Nova funcionalidade; separa reserva e entrada na fila, recupera pendências após reinício.                   |
| 14/09 | Configuração de produção, segurança e atualização de senha legada | `95a3114`, `8b9832f`            | Validações de produção, limites de requisição e compatibilidade de hashes.                                  |
| 14/09 | Complemento do endereço e saída conjunta de entregas              | `6e3b195`                       | Novo contrato de endereço e início atômico de rota com vários pedidos.                                      |
| 21/09 | Verificação de e-mail e recuperação de senha                      | `f6550ac` até `a9232a9`         | Códigos de uso único, envio de e-mail, confirmação antes do acesso e revogação de sessões.                  |
| 22/09 | Sessão por cinco dias de inatividade                              | `9523cd0` até `dad549c`         | Renovação por atividade em HTTP e tempo real; correção da confirmação de e-mail.                            |
| 23/09 | Métricas gerenciais                                               | `31424eb`, `e2e3491`            | Período, canais de pedido, vendas em quantidade/valor e situação dos entregadores.                          |
| 28/09 | Convites de funcionários                                          | `40e3b45`                       | Gerente informa nome, função e e-mail; funcionário ativa a conta pelo convite.                              |
| 28/09 | Consumo do Neon e backup criptografado                            | `2077601`, `d551858`, `d19bda4` | Cache, manutenção, rotina de backup e correções do cliente PostgreSQL 17.                                   |
| 28/09 | Auditoria transacional                                            | `07a7395`                       | Trilha de gravações, identidade, contas de setor, antes/depois protegido, consulta gerencial e captura SQL. |

Esta consolidação também centraliza a versão em `package.json`, alinha o Swagger, acrescenta o commit do deploy ao health e verifica pacote/lockfile/changelog no CI. O CI exige incremento de versão quando a entrega altera código, contratos, dependências, Docker ou a rotina de backup.

### Mudanças de contrato e implantação

- Cadastro de cliente passa a exigir verificação de e-mail e responde `verificationRequired`; não emite sessão imediatamente.
- Cadastro de funcionário usa convite; clientes antigos que enviavam senha no cadastro da equipe precisam ser atualizados.
- `SESSION_IDLE_DAYS` controla a janela; `SESSION_HOURS` deixou de controlar a sessão.
- Usar as migrations acumuladas e clientes compatíveis. A família de rotas continua `/v1`; 0.x ainda representa desenvolvimento/homologação, com evolução de contrato coordenada entre repositórios.
- A mudança de metadados da versão não cria migration adicional.

### Integração conferida antes desta consolidação

| Repositório         | Revisão                                    |
| ------------------- | ------------------------------------------ |
| BonamassaPainel     | `aea77723bde9c0c69de513a492d8f869c7a465cc` |
| BonamassaAndroid    | `f57ad5957b7af0c5cac989497a0207f073eff3d3` |
| BonamassaEntregador | `1d924ab403ad2899e35dd6e7456dafc339f0aa7d` |

Esses consumidores foram validados com a API `07a73957de48267384b35a21068cea1380dc64fa`. Seus números de versão são independentes; commits exclusivos de interface não incrementam a versão da API. A revisão atual da API é identificada pelo campo `commit` do health após o deploy.

## [0.1.0] - 2026-09-13

Versão declarada na implementação inicial `8b5e602`: pedidos, catálogo/fotos, promoções, sessões e perfis, cozinha, entregas, idempotência, controle de concorrência e eventos em tempo real. Os commits posteriores mantiveram esse número indevidamente até a consolidação 0.2.0 acima.
