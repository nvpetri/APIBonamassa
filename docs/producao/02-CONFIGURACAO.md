# 2. Configuração segura

## Conceitos antes dos comandos

- NODE_ENV=production otimiza a execução das bibliotecas.
- APP_ENV define o ambiente operacional. Sem APP_ENV, NODE_ENV=production assume produção.
- APP_ENV=staging e production ativam as mesmas verificações de segurança.
- APP_ENV=test existe para testes descartáveis, inclusive builds de Next/Docker. **Nunca o use no Render real para fazer um check passar.**
- Variáveis são configuradas no serviço correto. Senha do banco é da API; SESSION_SECRET é do painel. Não use prefixo NEXT_PUBLIC_ para segredos.

Os modelos [.env.production.example](../../.env.production.example) da API e do painel não contêm senhas. No Render, preencher em Environment. Não enviar prints com valores, não colar segredos no chat e não fazer commit de .env.

## API

| Variável | Produção | Por quê |
| --- | --- | --- |
| NODE_ENV | production | Runtime de produção |
| APP_ENV | production; staging no ambiente de ensaio | Ativa verificações |
| DATABASE_URL | URL PostgreSQL própria deste ambiente | Acesso ao banco |
| CORS_ORIGINS | Vazio no desenho atual com BFF + Android | Não abrir acesso de navegador indiscriminadamente |
| DOCS_ENABLED | false | Não expor documentação interativa |
| SESSION_HOURS | 12, ou prazo menor aprovado | Expiração das sessões |
| SEED_DEMO | false | Não inserir cardápio/abertura de demonstração |
| CUSTOMER_REGISTRATION_ENABLED | false no piloto restrito, após cadastrar os participantes | Suspender novas contas sem revogar as existentes |
| TRUSTED_PROXY_CIDRS | Somente proxies cuja topologia foi validada | Não confiar em IP enviado pelo cliente |
| PORT | Variável fornecida pelo Render | API escuta em 0.0.0.0 |

A conexão Prisma/PostgreSQL deve conter **uma ocorrência** de sslmode=require e sslaccept=strict. Exemplo de formato, sem credenciais reais:

```text
postgresql://USUARIO:SENHA@HOST/BANCO?sslmode=require&sslaccept=strict
```

Não substitua uma URL inteira cegamente: preserve os parâmetros necessários do Neon e não duplique parâmetros. Senhas com caracteres especiais devem estar codificadas corretamente na URL. Não use sslaccept=accept_invalid_certs para resolver erro de certificado. Confirme CA, hostname, data do sistema e cadeia de certificados.

O check valida configuração, não abre conexão TLS. A conectividade real e a verificação do certificado precisam ser confirmadas em homologação. Referência do conector: [PostgreSQL no Prisma](https://www.prisma.io/docs/orm/overview/databases/postgresql).

Comece com a conexão direta do Neon para migrações. Se usar pooling no runtime, valide a compatibilidade de Prisma/transações e mantenha a conexão apropriada para migrações; não reescreva automaticamente host/porta. Começar com uma instância e poucas conexões facilita medir antes de escalar.

## Painel

| Variável | Valor |
| --- | --- |
| NODE_ENV | production |
| APP_ENV | production ou staging |
| PANEL_MODE | api |
| API_URL | Origem HTTPS da API, sem /v1, usuário, query ou fragmento |
| PANEL_ORIGIN | Origem HTTPS exata em que a equipe acessará o painel |
| STORE_SLUG | bonamassa, ou a unidade realmente cadastrada |
| COOKIE_SECURE | true |
| SESSION_SECRET | 32 bytes aleatórios em hexadecimal: 64 caracteres |
| PORT | Fornecida pelo Render |

Gerar o segredo **no seu computador**, não aqui, em um terminal privado:

```powershell
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
```

Guarde o valor no gerenciador de senhas e no Environment do painel. O comando imprime um segredo; não grave a tela, não use CI e limpe o terminal depois. Não reutilizar entre ambientes.

PANEL_ORIGIN fixa a origem permitida para operações que alteram dados. Depois de trocar de domínio, atualize essa variável e teste login, salvar produto e aceitar pedido pelo domínio novo. Com a origem antiga, mutações serão recusadas. HTTPS interno também é exigido para a conexão painel → API nesta preparação.

Não configurar CORS_ORIGINS=* nem COOKIE_SECURE=false para “resolver CORS”. O navegador conversa com o painel; o painel chama a API no servidor. Erro de origem/cookie geralmente indica URL ou ambiente incorreto.

## Proxy e limites: etapa obrigatória de homologação

O código recusa trust proxy=true, número de saltos, apelidos de redes e /0. IPs/CIDRs explícitos são apenas a configuração: uma rede ampla também pode ser perigosa. **Não copie 10.0.0.0/8 ou a rede inteira da nuvem sem análise.**

Confirme com o provedor quais caminhos chegam ao processo, quem insere/remove headers e como impedir acesso direto por caminhos não confiáveis. Se os endereços do proxy não forem estáveis, não invente uma lista. Defina uma solução de entrada controlada ou obtenha orientação do provedor antes de declarar o item aprovado.

Na homologação, teste duas origens de rede (Wi-Fi e rede móvel), usuário autenticado, navegador através do BFF, IPv4/IPv6 e X-Forwarded-For deliberadamente falso. A documentação oficial explica por que confiar no primeiro valor do header é inseguro. [Express atrás de proxies](https://expressjs.com/en/guide/behind-proxies.html).

O painel **não repassa X-Forwarded-For do navegador**. Seus acessos anônimos compartilham o IP de saída do BFF. Os autenticados são limitados por usuário, além do teto do IP. A checagem em CI valida a lógica local, não a topologia hospedada.

Limites atuais: teto de 6.000/min por IP, anônimo 600/min, rotas de login/cadastro 60/min por IP, autenticado 600/min por usuário, login 10/15 min por loja/e-mail, cadastro 30/h por loja e 3/h por e-mail. São barreiras iniciais a medir, não proteção DDoS. Um atacante ainda pode consumir cota de cadastro de uma loja.

## Comandos de verificação

Na pasta da API, com Node 24 e variáveis do ambiente de ensaio:

```powershell
npm ci
npm run build
npm run production:check
```

No painel:

```powershell
npm ci
npm run production:check
npm run build
```

O painel lê .env.local no comando de check; na API, .env. Para variáveis já configuradas no Render não é necessário criar esses arquivos. Os checks não gravam no banco nem exibem os valores. Aviso de proxy ou cadastro aberto **não é aprovação de segurança**.

Se falhar, conferir a tabela e as variáveis no serviço correto. Nunca remover as verificações ou mudar APP_ENV para test na nuvem como solução.

## Contas de infraestrutura

Ativar MFA e recuperação segura no GitHub, Render, Neon, provedor DNS e registro de domínio. Convites individuais, menor permissão possível, sem conta compartilhada. Guardar códigos de recuperação fora do repositório. Revogar acesso quando alguém sair da equipe.
