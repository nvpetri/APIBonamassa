# Segurança: avaliação preliminar para produção

**Data: 14/09/2026. Escopo: leitura do código e testes disponíveis, não pentest nem certificação.**
Não foram inspecionadas credenciais, permissões, backups ou configurações privadas dos ambientes Render/Neon.
Não existe porcentagem de segurança confiável derivada da quantidade de testes.

## Controles encontrados

- API: autorização por perfil e escopo de loja/cliente/entregador; nova verificação da sessão dentro das escritas.
- Senhas com sal e scrypt; comparação resistente a diferenças de tempo; tokens aleatórios de sessão, armazenados como hash no banco, com expiração/revogação.
- Dados de cozinha sem endereço/contato/valores; cotação e regras de preço no servidor.
- Transações, restrições do PostgreSQL, controle de versão e idempotência persistida protegem dinheiro, cotas e reenvios.
- Validação de entrada, tamanho de corpos/imagens, conversão segura de fotos e cabeçalhos Helmet.
- Painel: cookie de sessão criptografado AES-256-GCM, HttpOnly, SameSite Strict e verificação de origem nas mutações; token não é exposto ao JavaScript da página.
- Android: armazenamento local protegido pelo Keystore e exigência de HTTPS no modo release.
- Testes cobrem acessos negados, isolamento, revogação, duplicidade e concorrência. Esses cenários não provam ausência de outras vulnerabilidades.

## Antes de operação comercial

| Prioridade | Ponto                                 | Evidência / ação necessária                                                                                                                                                                                                                                                 |
| ---------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alta       | Proxy e limitação de tráfego          | `src/auth.ts` usa `req.ip` sem confiar em forwarded headers. Atrás de proxy, clientes podem compartilhar o limite e bloquear uns aos outros. Definir proxies confiáveis, testar o trajeto real e proteger contra IP forjado. Não habilitar trust proxy indiscriminadamente. |
| Alta       | Disponibilidade, backup e restauração | Configuração privada não verificada. Usar serviço sempre ativo, cópias restauráveis, teste de recuperação e alertas para API, banco e filas paradas.                                                                                                                        |
| Alta       | Credenciais e bootstrap               | Rever segredos exclusivos, rotação, acesso mínimo ao banco, TLS, cookies Secure e `DOCS_ENABLED=false`. Nunca publicar contas/senhas de teste. O painel permite HTTP e COOKIE_SECURE=false por configuração: validar os valores em produção.                                |
| Alta       | Abuso de contas e reservas            | Cadastro não verifica e-mail/telefone. Três reservas por conta não impedem múltiplas contas falsas. Definir verificação/antifraude proporcional e regras operacionais antes de aceitar grande volume público.                                                               |
| Média      | Proteção administrativa               | MFA e recuperação segura de senha não estão implementados. Definir política e procedimento de recuperação; não compartilhar a conta do gerente.                                                                                                                             |
| Média      | Senhas e capacidade                   | Comparar os parâmetros scrypt e capacidade de memória/CPU com a política adotada. Ensaiar tentativas simultâneas de autenticação e negação de serviço em ambiente isolado.                                                                                                  |
| Média      | Privacidade e retenção                | Definir retenção de pedidos, endereços, auditorias, fotos e respostas de idempotência; procedimento de atendimento a solicitações e acesso mínimo.                                                                                                                          |
| Média      | Dependências e release                | Repetir auditoria de dependências, revisão de configurações e teste do APK release assinado; não tomar um npm audit sem alertas como garantia ampla.                                                                                                                        |
| Média      | Escala e tempo real                   | Avisos Socket.IO são locais ao processo. Escalar exige transporte compartilhado/outbox; reconciliação REST continua necessária.                                                                                                                                             |

**Conclusão:** há controles úteis para homologação controlada. Não há evidência suficiente para aprovar produção comercial irrestrita. Tratar os itens de maior impacto e executar uma verificação direcionada antes da liberação.

Referências: [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/) para verificação sistemática; [Render Free](https://render.com/docs/free) para limitações de infraestrutura. O Render pode hospedar produção em plano adequado; o plano gratuito não é recomendado pelo próprio provedor para esse uso.
