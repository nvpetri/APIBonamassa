# 3. Implantação e rollback

## Antes de qualquer merge

Os PRs de preparação da API, painel e cliente foram empilhados sobre os PRs de horários, ainda abertos na data desta revisão. O entregador parte de main.

1. Desligar o auto-deploy dos serviços envolvidos durante a preparação coordenada. Isto é uma ação futura do responsável, não foi feito por este trabalho.
2. Revisar/mesclar primeiro os PRs de horários: API #3, painel #6 e cliente #3.
3. Conferir a base dos PRs de preparação: API #4, painel #7, cliente #4. Se ainda apontarem para codex/horarios-e-reservas, alterar a base para main e aguardar os checks novamente. Entregador #2 já aponta para main.
4. Só mesclar a preparação após configurar o ambiente de ensaio e entender as novas variáveis. **Um merge em branch ligada ao Render pode iniciar deploy.**
5. Depois do ensaio, repetir a sequência aprovada em produção numa janela acompanhada.

Não usar git reset --hard para resolver mudanças locais. Execute git status antes de trocar de branch; preserve alterações locais, em especial settings.gradle.kts, sem colocar senhas no Git.

## Etapa A — banco e credenciais

Criar o banco de homologação vazio e conferir host, nome e proprietário. Ativar o mecanismo de recuperação do plano escolhido. Usar TLS com validação de certificado.

Definir dois papéis de banco: **migração**, que pode alterar estrutura, e **runtime**, com somente as permissões que a aplicação precisa. O runtime não deve ser dono/superusuário nem poder criar/remover tabelas. As credenciais do migrador não ficam permanentemente no serviço web.

Esta separação ainda precisa ser aplicada no provedor e testada. O projeto não provisiona roles do Neon automaticamente. As tabelas da aplicação precisam de leitura/escrita conforme os serviços; Audit e OrderEvent devem ser tratados como registros de histórico. Não copiar GRANT ALL ou concessões globais sem revisar o banco alvo.

Migrações com credencial separada podem ser executadas por um operador ou job restrito, com DATABASE_URL temporariamente apontando para a conexão do migrador. O servidor usa DATABASE_URL do runtime. Cada execução precisa registrar commit, banco/ambiente (sem senha), responsável e resultado.

## Etapa B — API

Criar um Web Service Docker de homologação, vinculado ao commit/branch aprovado. Região próxima do banco, recursos que não durmam para o ensaio operacional.

| Campo | Valor |
| --- | --- |
| Docker Build Context | . |
| Dockerfile Path | ./Dockerfile |
| Docker Command | npm run start:production |
| Health Check Path | /v1/health |
| Variáveis | Capítulo 2, APP_ENV=staging |

**Migração não é compilação.** npm run build compila TypeScript e gera Prisma Client; não cria as tabelas.

Na cópia aprovada do projeto, com variáveis do migrador de homologação e após backup/check do alvo:

```powershell
npm ci
npm run build
npm run production:check
npm run db:migrate
```

Atenção: **db:migrate grava no banco configurado**. Não rodar antes de conferir host, nome e ambiente. O comando usa migrate deploy, não migrate dev/reset.

Render pago oferece Pre-Deploy Command. Pode usar `npm run production:check && npm run db:migrate` quando o desenho de permissões do job estiver resolvido; não supor que o pre-deploy tem credenciais isoladas só porque roda em outro processo. Alternativa preferível ao separar roles: job/operador de migração restrito antes de liberar o deploy. [Como os comandos de deploy funcionam](https://render.com/docs/deploys).

O comando legado start:deploy continua disponível para demonstração: migra, executa seed e inicia a API. **Não é o modelo recomendado de operação permanente em produção.**

## Etapa C — bootstrap, uma única vez

Somente em banco/unidade novos e no ambiente confirmado:

1. Configurar temporariamente SEED_STORE_SLUG, SEED_MANAGER_EMAIL e SEED_MANAGER_PASSWORD fortes, SEED_DEMO=false.
2. Rodar production:check e então db:seed com credencial autorizada.
3. O seed preserva dados e senhas existentes; não é ferramenta de reset de senha.
4. Entrar como gerente, trocar a senha, cadastrar equipe nominal e configurar cardápio, taxas e horários.
5. Remover as variáveis de senha/e-mail de bootstrap do serviço permanente.
6. Confirmar que a API inicia com start:production **sem** executar seed.

O seed atual usa telefone fictício do gestor; ajustar o cadastro antes do uso real. Se for necessário recuperar senha de gerente, usar procedimento assistido com verificação de identidade; não compartilhar credenciais da equipe.

As migrações de horários ativam 17h–03h em lojas existentes. Não migrar num dia movimentado sem revisar essa mudança. Lojas novas não ganham cardápio real automaticamente.

## Etapa D — painel

Criar Web Service **Node**, não Static Site. Configurar as variáveis do capítulo 2, usando API de homologação.

| Campo | Valor |
| --- | --- |
| Root Directory | Vazio (raiz do repositório) |
| Build Command | npm ci && npm run build |
| Start Command | npm run start:production |
| Health Check Path | / |
| Runtime Node | Respeitar .nvmrc do repositório |

O check do painel valida a configuração; / apenas comprova que o painel respondeu. **Não comprova que o login ou o banco estão funcionando.** Testar o login e uma operação controlada na homologação.

Se trocar a API, STORE_SLUG ou SESSION_SECRET, esperar que sessões anteriores precisem de novo login.

## Etapa E — domínio e TLS

No serviço correto, adicionar o domínio em Settings → Custom Domains. No provedor DNS, inserir **exatamente** os registros apresentados pelo Render, preservando os registros de e-mail/outros serviços. Verificar o domínio e aguardar o certificado HTTPS. [Procedimento oficial de domínios](https://render.com/docs/custom-domains).

Conferir API_URL e PANEL_ORIGIN com os domínios definitivos. Não desativar a origem onrender.com enquanto aplicativos distribuídos ainda a utilizarem. Os Androids atuais não seguem redirects: manter a origem antiga funcionando durante uma migração, em vez de depender de redirecionamento.

## Etapa F — homologação e liberação

Executar o checklist do capítulo 6 com dados fictícios e registrar resultados. Depois criar/validar o ambiente de produção separado, repetir backup/migração/configuração e distribuir o APK assinado aprovado.

Primeiro lançamento: gerente presente, poucos participantes conhecidos, contato de suporte funcionando. Não descobrir indisponibilidade de impressão, emissão fiscal ou forma de pagamento no primeiro pedido do público.

Depois do piloto, ativar deploy automático somente se o processo de aprovação estiver claro. Preferir manual no início ou “After CI Checks Pass” com checks realmente exigidos no GitHub. Não usar pull_request_target para executar código de PR com segredos. A CI deste projeto usa bancos descartáveis, não produção.

## Rollback: código e banco são coisas diferentes

Se o problema é código e a versão anterior aceita o esquema/dados atuais, voltar ao deploy/commit aprovado e testar o fluxo. Verificar também os valores de ambiente e comandos que o provedor reaplica. [Rollback no Render](https://render.com/docs/rollbacks).

Não voltar para uma API que desconhece SCHEDULED quando já existem reservas, nem instalar APK antigo que não interpreta o contrato atual. É necessário avaliar compatibilidade, não só escolher o deploy verde anterior.

**Rollback de código não desfaz uma migração ou um pedido.** Preferir correção aditiva (“roll forward”) para banco. Restaurar banco pode perder pedidos posteriores ao ponto recuperado e não desfaz entregas/pagamentos ocorridos no mundo real. Seguir capítulo 4, reconciliar com a pizzaria e aprovar a decisão.

Para Android já distribuído, normalmente publicar a correção com versionCode maior e mesma assinatura. Não orientar clientes a desinstalar se há operações pendentes.
