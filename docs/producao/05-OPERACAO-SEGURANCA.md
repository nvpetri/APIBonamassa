# 5. Operação, segurança e incidentes

## O que os controles existentes fazem

- Preços calculados no servidor, valores em centavos, transações e cotas de promoções protegidas contra concorrência.
- Papéis e unidade conferidos na API; cliente vê seus pedidos, entregador vê os atribuídos, cozinha recebe projeção restrita.
- Tokens aleatórios, somente hash do token no banco, expiração e revogação. Senha alterada revoga sessões.
- Senhas com salt e scrypt; formato v2 usa N=32768, r=8, p=3. Registros antigos continuam verificáveis e são atualizados no login correto, com histórico. Não foi necessário resetar senhas.
- Cookie do painel autenticado/criptografado, HttpOnly, SameSite e Secure; dados de sessão Android protegidos pelo Keystore.
- Reenvio de operações com chave de idempotência; controle de versão evita sobrescrever uma edição concorrente.
- Limites de tamanho, validação de entradas, imagens processadas no servidor e respostas sem stack trace público.
- Novas barreiras de configuração, proxy explícito, limites por usuário e origem fixa do painel.

O custo de senha v2 usa uma das combinações mínimas publicadas pela OWASP, com opção de 32 MiB. **Ainda medir CPU, memória e latência de login na instância escolhida**, inclusive na primeira atualização de uma conta antiga. [Referência de armazenamento de senhas](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).

CORS não é autenticação. HTTPS não impede pedido falso. Criptografia não corrige uma autorização errada. Rate limit não é proteção completa contra DDoS.

## Bloqueadores e decisões antes de exposição pública

| Item | Situação desta preparação | Próximo passo |
| --- | --- | --- |
| Verificação de e-mail/telefone | Não implementada | Escolher fluxo/provedor, comprovar posse e controlar reenvios/recuperação |
| MFA do gerente | Não implementado no produto | Definir MFA e/ou acesso administrativo restrito, com ameaça residual registrada |
| Recuperação de senha | Sem autosserviço verificado | Procedimento assistido seguro; implementar fluxo de recuperação auditável |
| Topologia de proxy do Render | Código preparado; nuvem não conferida | Ensaiar rede, spoofing e limites; não inventar CIDRs |
| Banco com menor privilégio | Depende do provedor | Separar runtime/migração, testar permissões |
| Backups/RPO/RTO | Runbook pronto; restore não realizado | Executar e guardar evidências privadas |
| Reserva/pedido falso | Cotas ajudam, não provam identidade | Política de confirmação, contato verificado e monitoramento |
| Manutenção sem novos pedidos | Sem botão global completo | Preparar bloqueio controlado e evolução específica |
| Monitoramento/plantão | Roteiro preparado, nenhum alerta criado | Escolher canal, responsáveis, limites e escalonamento |
| Teste de carga/pentest | Não realizados | Executar escopo autorizado em homologação; corrigir achados |
| Assinatura/distribuição release | Compilação preparada | Chaves, instalação real e canal de distribuição aprovados |

Não declarar conformidade ASVS, LGPD, PCI ou segurança “100%”. O objetivo é uma avaliação verificável de riscos e controles. A revisão deve incluir autorização por objeto, fluxos de negócio e abuso, não somente scanner de dependências. [OWASP API Security](https://owasp.org/www-project-api-security/).

### Piloto restrito versus lançamento aberto

Um piloto só com participantes conhecidos pode manter CUSTOMER_REGISTRATION_ENABLED=false depois do cadastro acompanhado de cada participante. Esta flag não cria convites nem contas: o fluxo de convite ainda não existe. Nunca escolher/coletar a senha pessoal do cliente.

Suspender novos cadastros não cancela reservas nem impede pedidos de usuários já existentes. A operação precisa acompanhar esses pedidos normalmente. Para publicidade e cadastro aberto, tratar os bloqueadores acima primeiro.

## Rotina da pizzaria

Antes da abertura:

1. Conferir internet, painel online, usuário correto e disponibilidade dos entregadores.
2. Conferir preços, fotos, adicionais, combos, estoque lógico/disponibilidade e promoções.
3. Conferir horário/fuso e reservas. Reserva para 17h significa entrada no atendimento/preparo a partir da abertura, **não entrega garantida às 17h**.
4. Conferir maquininha, formas de pagamento e eventual sistema fiscal separado.
5. Definir quem atende incidentes e qual canal alternativo será usado.

Durante o atendimento: acompanhar fila, aceitar/cancelar conscientemente, tratar ocorrências de entrega, conferir pagamento real antes de registrá-lo. Não compartilhar login de gerente com cozinha/motoboy.

No fechamento: conferir pedidos em andamento, entregas/retornos, pagamentos e reservas pendentes. O fechamento às 03h não cancela pedidos em andamento. Revisar os procedimentos em [Horários e reservas](../HORARIOS-E-RESERVAS.md).

## Monitoramento mínimo

Separar três sinais:

| Sinal | Exemplo de verificação | O que não comprova |
| --- | --- | --- |
| Técnico | GET /v1/health e painel / respondem | Pedido completo funcionando |
| Operacional | Reservas liberadas na abertura, fila sem atrasos inexplicados | Infraestrutura livre de falhas |
| Recuperação | Backup recente e restore ensaiado | Ausência de perda desde o backup |

A API /v1/health consulta o banco. A resposta 200 é útil para disponibilidade, mas não testa todos os papéis, preços ou entrega.

Configurar monitor externo para API/painel com prazo compatível ao plano; alerta de erros 5xx/429, reinícios, CPU/RAM, armazenamento/conexões do banco, backup atrasado e certificado/domínio. Propostas iniciais: avisar após falhas consecutivas, investigar p95 e fila acima do combinado com a pizzaria. **Valores finais dependem de medição e capacidade**, não estão prometidos.

A rotina de horário faz reconciliação periódica e por requisição. Observar reservas vencidas que não foram liberadas e erro da rotina, não só “processo vivo”.

Nenhum monitor, webhook ou contato de alerta foi configurado automaticamente neste trabalho. Não apontar teste de carga à API hospedada de clientes.

### Dados que não devem entrar em logs

Authorization, cookies, SESSION_SECRET, DATABASE_URL completa, senhas, documentos, telefone/endereço completo e corpo integral do pedido. Usar requestId, código de erro, operação e identificadores mínimos necessários, com acesso restrito e retenção definida.

Relatório público/LinkedIn: somente dados fictícios, contagens e resultados verificáveis. Não inventar duração do desenvolvimento, cobertura, ausência de vulnerabilidades ou testes de invasão.

## Manutenção do banco

`npm run maintenance` remove sessões e limites expirados, cotações abandonadas antigas sem pedido e imagens órfãs. **É uma operação de escrita e remoção**, não um check read-only. Não executada nesta preparação.

Ensaiar em homologação, conferir credenciais e programar somente com autorização. Ela não remove histórico de pedidos, auditoria ou idempotências; essa retenção precisa de política própria. Apagar idempotência sem planejamento pode permitir repetição de pedidos antigos.

Usar job/cron operacional separado quando contratado e configurado; a existência do comando no Git não agenda sua execução.

## Rotação de segredos

| Segredo/acesso | Efeito e cuidado |
| --- | --- |
| SESSION_SECRET | Troca invalida cookies do painel; avisar equipe e testar novo login |
| Senha do banco | Coordenar nova credencial com API/job; testar antes de revogar a anterior |
| Senha da equipe | Troca ou desativação deve invalidar acessos; testar usuário revogado |
| Token/sessão comprometido | Revogar sessão/conta e investigar origem |
| Chave de assinatura Android | Não trocar arbitrariamente: preservar capacidade de atualizar aplicativos |
| Conta de provedor | MFA, recuperação e revisão dos colaboradores |

Guardar segredos em cofre. Não enviar por issue, PR, planilha pública ou chat. Senha no histórico Git deve ser revogada; apagar só a linha do arquivo não resolve o vazamento.

## Incidente: primeiros passos

1. Identificar sintoma, horário, ambiente e requestId, sem coletar dados excessivos.
2. Avisar gerente e responsável técnico; evitar ações simultâneas conflitantes.
3. Conter acesso comprometido ou novos pedidos quando necessário. Lembrar que fechar a loja mantém reservas.
4. Preservar logs e evidências restritas. Não resetar banco, limpar filas ou apagar histórico para “destravar”.
5. Escolher correção, rollback compatível ou recuperação, com avaliação de pedidos já atendidos/pagos.
6. Revalidar fluxo e reabrir acompanhado.
7. Registrar causa, impacto, correção e prevenção; avaliar obrigações de comunicação com os responsáveis.

Plano alternativo de operação: canal de telefone/atendimento aprovado e registro organizado para reconciliação, sem prometer sincronização offline inexistente.

## Próximas evoluções separadas

MFA/recuperação verificada, combate a abuso com verificação de contato, manutenção granular, observabilidade de negócio e alertas, CSP completa com política de scripts/nonces, verificação de dependências/imagens com processo de atualização e revisão externa de segurança.

Gateway de pagamento/PIX automático, fiscal, WhatsApp e rastreamento contínuo não devem ser vendidos como implementados só porque o fluxo básico de pedido/entrega funciona.
