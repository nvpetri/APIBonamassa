# 6. Checklist de liberação

Uma caixa marcada precisa de data, responsável e evidência. Este documento começa em branco: não significa que a nuvem foi configurada.

## Infraestrutura e acesso

- [ ] Dono das contas/domínio, colaboradores e recuperação definidos; MFA dos provedores ativo.
- [ ] Homologação e produção com bancos, URLs e credenciais separados.
- [ ] API/painel em recursos apropriados, sem suspensão por inatividade.
- [ ] PostgreSQL com TLS/certificado verificado; papéis de runtime e migração conferidos.
- [ ] APP_ENV/NODE_ENV corretos; production:check da API e painel aprovado.
- [ ] API_URL/PANEL_ORIGIN e domínio final conferidos; nenhum segredo no frontend/Git.
- [ ] DOCS_ENABLED=false, SEED_DEMO=false, senhas de bootstrap removidas do runtime.
- [ ] Topologia de proxy e limites testados com Wi-Fi/rede móvel e header falso.
- [ ] Dependências de runtime verificadas; achados corrigidos ou risco documentado.

## Produto e segurança

- [ ] Gerente, atendimento, cozinha e entregador usam contas separadas.
- [ ] Cliente A não lê/cancela pedido B; entregador não vê entrega alheia.
- [ ] Cozinha não recebe dados de cliente/preços fora da projeção permitida.
- [ ] Logout, alteração de senha e desativação revogam acesso.
- [ ] Login com hash legado atualiza para v2 sem alterar a senha.
- [ ] Cadastro/recuperação/MFA: decidir controles antes de abertura pública.
- [ ] Limite/monitoramento de reservas e processo contra pedidos falsos aprovados.
- [ ] Política de dados/privacidade, suporte e responsabilidades revisados.
- [ ] Plano alternativo para internet/serviço indisponível ensaiado.

## Fluxo de aceitação — somente em homologação

- [ ] Pizza inteira, meio a meio, bordas, bebidas e combo com preço próprio.
- [ ] Desconto por período e por quantidade; cota não duplicada por reenvio.
- [ ] Foto e novo sabor aparecem para cliente; item indisponível é bloqueado.
- [ ] Delivery e retirada, taxa, troco e forma de pagamento corretos.
- [ ] Fechada antes de 17h: cliente vê agendamento, confirma e acompanha/cancela.
- [ ] Reserva não aparece como produção atrasada nem pode ser aceita antes de liberar.
- [ ] Às 17h: abre e libera uma vez, inclusive após reinício da API.
- [ ] Às 03h: fecha para novos pedidos imediatos, mantém os que já estão em andamento.
- [ ] Pedido após fechar fica para a próxima abertura correta (dia/fuso).
- [ ] Abrir antecipadamente exige popup; desistir não altera a loja.
- [ ] Horário não pode mudar silenciosamente enquanto há reservas prometidas.
- [ ] Aceitar → preparar → pronto → atribuir → coletar/sair → concluir.
- [ ] Ocorrência/retorno, cancelamento e registro de pagamento funcionam.
- [ ] Perda de rede e reenvio não duplicam pedido, desconto, baixa ou entrega.
- [ ] Dois operadores concorrentes recebem conflito tratável em vez de sobrescrita.

## Androids

- [ ] Ambos apontam à API/unidade definitiva, sem flags demo/integração.
- [ ] Build release e lint aprovados; APK/AAB assinado com chave protegida.
- [ ] Hash SHA-256, versionCode, certificado e commit registrados.
- [ ] Release instalado em aparelho real: login, imagem, compra/reserva ou entrega.
- [ ] Atualização sobre release anterior preserva sessão/pedidos pendentes quando aplicável.
- [ ] Wi-Fi/rede móvel, Android mínimo suportado e dispositivos de uso real testados.
- [ ] Canal de distribuição e política de atualização definidos.

## Recuperação e operação

- [ ] Backup e retenção configurados e monitorados.
- [ ] Restore em banco isolado realizado; RTO/RPO medidos.
- [ ] Commit anterior e compatibilidade do banco avaliados para rollback.
- [ ] Alertas testados, com alguém responsável por receber e agir.
- [ ] Gerente treinado; preços/cardápio/taxas/horários homologados.
- [ ] Piloto restrito concluído, sem pedidos ou pagamentos fictícios misturados aos reais.
- [ ] Autorização final do responsável técnico e da pizzaria registrada.

## Registro da versão candidata

| Campo | Valor/evidência |
| --- | --- |
| Data e responsáveis | |
| Commit API / run CI | |
| Commit painel / run CI | |
| Commit Android cliente / run CI | |
| Commit Android entregador / run CI | |
| Ambiente/banco, sem credenciais | |
| Domínios | |
| Migration mais recente | |
| Versões e certificados dos APKs | |
| Resultado restore/carga/revisão de segurança | |
| Pendências aceitas e prazo | |
| Decisão: não liberar / piloto / lançamento aberto | |

## Como repetir as verificações de código

API (banco local/teste separado, com migrations):

```powershell
npm ci
npm run db:migrate
npm test
npm run check
npm run test:integration
npm run audit:production
```

No painel, após configurar homologação local conforme seu README:

```powershell
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run test:api
npm run audit:production
```

A suíte real do painel/Android escreve dados fictícios no banco de teste. Não use a API pública de produção como alvo. Os workflows dos repositórios descrevem a montagem automática dos ambientes descartáveis.

Os Androids possuem comandos no guia de cada repositório. CI verde não comprova restauração, segurança dos provedores, cobertura integral ou desempenho no aparelho de cada entregador.
