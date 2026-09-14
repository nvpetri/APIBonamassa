# Bonamassa — manual de preparação para produção

Revisão: 14/09/2026. Responsável técnico: preencher. Responsável da pizzaria: preencher.

**Situação: preparação de código e procedimentos, não autorização para operação pública.** Este material não é certificado de segurança, pentest, contrato de disponibilidade nem prova de restauração. Nenhum deploy, contratação, alteração de DNS ou banco hospedado foi realizado nesta etapa.

## Por onde começar

Leia na ordem. Cada capítulo explica o motivo, o procedimento e como conferir o resultado.

1. [Arquitetura, ambientes e decisões](01-ARQUITETURA.md).
2. [Configuração da API e do painel](02-CONFIGURACAO.md).
3. [Implantação, migrações e rollback](03-DEPLOY.md).
4. [Backup e recuperação](04-BACKUP.md).
5. [Operação, incidentes e segurança](05-OPERACAO-SEGURANCA.md).
6. [Checklist de liberação e registro de evidências](06-CHECKLIST.md).
7. [Assinatura e publicação do cliente Android](https://github.com/nvpetri/BonamassaAndroid/blob/codex/preparacao-producao/docs/PRODUCAO.md) e [entregador Android](https://github.com/nvpetri/BonamassaEntregador/blob/codex/preparacao-producao/docs/PRODUCAO.md).
8. [Evidências das verificações de código](07-VALIDACAO.md).

Os endereços terminados em `.example`, usuários e valores vazios são **marcadores**. Não são recursos criados ou credenciais utilizáveis.

## O que foi preparado no código

- API: validação de ambiente, TLS do PostgreSQL com certificado verificado, documentação pública/demo desativados em staging/produção.
- Proxy: confiança somente em IPs/CIDRs explícitos, com teste contra X-Forwarded-For forjado. A topologia real do Render ainda precisa ser confirmada.
- Limites: usuário autenticado separado dos demais usuários atrás do mesmo painel/NAT; teto geral por IP mantido; Retry-After corresponde à janela real.
- Senhas: formato scrypt v2 com custo maior e atualização automática dos hashes legados após login válido.
- Cadastro: opção de suspender novas contas; limites adicionais por loja/e-mail antes do cálculo da senha.
- Painel: validação de HTTPS, cookie seguro, segredo de sessão e origem fixa; proteção contra enquadramento em outro site e políticas estruturais de navegador.
- Androids: tarefa obrigatória de configuração release, recusa de HTTP e flags demo/integração; compilação release sem assinatura de produção na CI.

## O que continua dependendo de ação

**Antes de um piloto com pessoas conhecidas:** configurar infraestrutura e credenciais, ensaiar restore, validar proxy/rede real, conferir permissões, assinar APKs e executar o roteiro com o gerente.

**Antes de abrir para clientes desconhecidos:** tratar contas/pedidos falsos, decidir verificação de contato e recuperação de conta, revisar acesso administrativo forte, capacidade e privacidade. Limites de requisições não substituem esses controles.

Um check verde significa apenas que aquilo que ele verifica passou. Uma variável preenchida não comprova que o serviço está acessível. Um backup gerado não comprova que pode ser restaurado. Render pago não substitui operação e monitoramento.

## Primeira ação recomendada

Definir quem é dono das contas de nuvem/domínio e escolher o endereço definitivo da API. Manter a demonstração separada enquanto o ambiente de produção é montado. Não é necessário comprar domínio para testar o sistema: o HTTPS do provedor pode ser usado, mas o endereço precisa ser estável antes de distribuir os APKs.
