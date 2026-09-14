# 7. Evidências de validação de código

Data: 14/09/2026. Este relatório registra execuções de CI em infraestrutura descartável, não resultados de um pentest ou teste de carga em produção.

## API

Commit testado: 66bf5d042bd533bbf87098629c7825a81286d25c.

[Execução aprovada da API](https://github.com/nvpetri/APIBonamassa/actions/runs/34884510145).

- 30 testes unitários aprovados.
- 21 casos de integração HTTP/PostgreSQL aprovados; o runner mostra 22 testes incluindo o agrupador.
- Prisma migrations, build, TypeScript e formatação aprovados.
- Inicialização Docker com migração, seed isolado, health e login de gestor aprovada.
- Auditoria de dependências de runtime sem vulnerabilidades reportadas naquela execução.

Os casos novos verificam configuração insegura rejeitada, confiança explícita de proxy e XFF falso, janela real de Retry-After, limites separados por usuário, suspensão de cadastro e atualização de senha legada para hash v2. O teste de hash legado usa um hash criado com os parâmetros anteriores, faz login HTTP, confirma a atualização única no banco, repete o login e confirma a revogação após desativar a conta.

A suíte também preserva os casos de horário/reservas, permissões, segregação por unidade, concorrência, idempotência, preços, cotas, estados de pedido, reinício e revogação.

O teste Docker usa APP_ENV=test e banco local descartável. A política de TLS de produção é verificada por testes de configuração; conexão TLS real com Neon e permissões do banco hospedado continuam no checklist de homologação.

## Painel

Commit testado: 7091c2093ec6303ef6a7f0361a29856270968250.

[Execução aprovada do painel](https://github.com/nvpetri/BonamassaPainel/actions/runs/34884112030).

- 77 testes unitários aprovados.
- 22 testes de navegador da demonstração aprovados, incluindo os cabeçalhos de segurança realmente recebidos por HTTP.
- 1 fluxo amplo de navegador integrado à API/PostgreSQL aprovado, com diversas etapas de operação e reservas.
- Lint, TypeScript e build Next.js aprovados.
- Auditoria de dependências de runtime sem vulnerabilidades reportadas naquela execução.

Há verificações de origem fixa, HTTPS, cookie seguro, segredo de sessão e recusa de configuração inadequada. Não foi executado teste do domínio/conta Render do usuário.

## Android cliente

Commit testado: 17c7b14514374f63053e989a980622a4a93c3243.

[Execução aprovada do cliente](https://github.com/nvpetri/BonamassaAndroid/actions/runs/34883727551).

- Testes JVM, build debug, lint debug e pacote de testes instrumentados aprovados.
- Build release com redução/ofuscação e lint release aprovados.
- Configuração release HTTP recusada conforme esperado.
- 7 testes instrumentados concluídos no emulador Android 15/API 35, incluindo fluxo com API/PostgreSQL e agendamento.

## Android entregador

Commit testado: 3feae4f014e08230bb44eaddf05d4a8a94c62cd5.

[Execução aprovada do entregador](https://github.com/nvpetri/BonamassaEntregador/actions/runs/34883769193).

- Testes JVM, build debug, lint debug e pacote de testes instrumentados aprovados.
- Build release com redução/ofuscação e lint release aprovados.
- Configuração release HTTP recusada conforme esperado.
- 3 testes instrumentados concluídos no emulador Android 15/API 35 com API/PostgreSQL.

Os dois Androids compilaram release **sem chave de produção**. Os testes instrumentados usam variante de teste/debug; assinatura, instalação do release em aparelho real e atualização entre releases ainda precisam ser validadas.

## Vínculo entre os repositórios

As integrações do painel e Androids fixam a API no commit 8b9832fdb0d509e89e1897822de414a6521e7254. O código de execução é equivalente ao da API validada acima; os commits seguintes ajustaram formatação, documentação e a montagem de um dado legado de teste.

Commits posteriores que somente acrescentem este relatório não mudam o código testado. Para uma nova alteração de runtime, repetir a CI e atualizar o registro de versão candidata.

## O que este relatório não prova

- Percentual de cobertura de código ou ausência de todos os bugs.
- Resistência a ataques em infraestrutura real, DDoS, pentest ou conformidade.
- Capacidade em sexta-feira de pico, latência/custo de senha na instância contratada ou suporte a todos os aparelhos.
- Backup restaurável, metas de recuperação, alertas recebidos ou domínio/segredos configurados.
- Publicação/aprovação em loja, assinatura real ou pagamento/fiscal integrado.

“0 vulnerabilidades” do npm significa ausência de alertas conhecidos retornados para as dependências consultadas naquele momento, não ausência de falhas no sistema. Consultar novamente antes do lançamento.

Para repetir: workflows dos repositórios e [checklist de liberação](06-CHECKLIST.md). Nenhum banco de produção foi usado nestas execuções.
