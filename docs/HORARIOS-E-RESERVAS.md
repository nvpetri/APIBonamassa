# Horários automáticos e reservas

## Regra operacional

- Padrão diário: abre às **17:00** e fecha às **03:00 do dia seguinte**.
- Fuso fixo da pizzaria: `America/Sao_Paulo`; cálculos usam dados IANA do servidor. O relógio e o fuso do celular não definem o funcionamento.
- A abertura é inclusiva; o fechamento é exclusivo. 02:59 está aberto, 03:00 está fechado.
- Horários diurnos também são aceitos. Horários iguais, fora de HH:mm ou inválidos são recusados.
- Não há calendário semanal, feriados nem seleção livre de data nesta entrega: a reserva é para a próxima abertura.
- Fora do expediente, um cliente atualizado pode cotar com `allowScheduling: true`. Sem essa opção, o servidor mantém a recusa de loja fechada para clientes antigos.
- A cotação informa `scheduledFor` e `timeZone`. O cliente revisa esse horário antes de confirmar. O horário significa entrada na fila de atendimento, **não entrega/retirada garantida nesse minuto**.
- Alteração de preço ou horário entre cotação e confirmação gera conflito; o cliente deve revisar novamente.
- Reservas persistem como `SCHEDULED`. Não podem ser aceitas, preparadas, atribuídas ou entregues antes da liberação.
- Gerente/atendimento e cliente dono veem suas reservas. A projeção da cozinha não as inclui.
- Cliente pode cancelar uma reserva ou pedido NEW antes da aceitação. Cancelamento libera a cota promocional.
- Preços, descontos e cota são reservados na confirmação; a campanha não é recalculada na abertura. A cota só conta como venda após conclusão.
- Limites: 3 reservas ativas por cliente e 500 por loja, verificados sob a mesma trava transacional da criação. Esses limites não substituem verificação de identidade/controle de abuso.

## Configuração e abertura manual

No painel conectado, vá a **Configurações → Horário de funcionamento → Configurar horários**.
O gerente define abertura e fechamento. Salvar uma programação diferente remove a abertura/pausa temporária atual.

Para proteger horários já prometidos, a API bloqueia mudança de programação enquanto houver reservas SCHEDULED. Atenda ou cancele com comunicação ao cliente antes de mudar o expediente. Não há reagendamento silencioso.

Na tela Pedidos, ao abrir fora da programação, um popup pede confirmação. A API exige `confirmEarlyOpen: true` e perfil MANAGER, versão válida e chave de idempotência. A abertura antecipada libera as reservas da próxima abertura, ainda sujeitas à aceitação normal do atendimento. A intervenção manual expira na próxima fronteira do calendário: a programação normal assume de novo. Fechar manualmente não cancela pedidos em andamento. **Retomar programação** encerra a intervenção manual.

O modo manual legado (`scheduleEnabled: false`) permanece apenas para compatibilidade e bases demonstrativas. Nesse modo, loja fechada não oferece reserva sem horário.

## Recuperação e infraestrutura

Enquanto a API estiver rodando, há reconciliação a cada 15 segundos. Consultas de catálogo, listas/detalhes de pedido e comandos também reconciliam a operação. A liberação usa transação e trava por loja, preserva o horário original, incrementa a versão uma vez e grava um evento de sistema (`actorId: null`). Chamadas concorrentes/repetidas não duplicam a liberação.

O tempo de espera operacional usa `queuedAt`, não o momento em que a reserva foi criada. Assim, uma reserva criada pela manhã não nasce atrasada na cozinha ao abrir.

Um processo desligado não executa tarefas. Render Free dorme após inatividade: não existe garantia de processamento exato às 17h em uma instância adormecida. Ao acordar dentro do expediente, a API recupera as reservas vencidas; se toda a janela passou sem serviço, elas continuam preservadas e aguardam uma abertura efetiva. A operação real precisa de instância sempre ativa, monitoramento e procedimentos para indisponibilidade. Referência: [Render Free](https://render.com/docs/free).

## Publicação coordenada

1. Homologue os três PRs contra banco separado e use backup com restauração verificada.
2. Publique o painel atualizado (ele reconhece o contrato legado) e a API com as duas migrations aditivas, em janela controlada. Após a API, publique o APK cliente 0.5.0. Não misture painel antigo com API que já tenha pedidos SCHEDULED.
3. A API passa a usar 17h–03h na migration, inclusive em lojas existentes. O seed de demonstração cria novas lojas em modo manual para manter testes previsíveis; ele não sobrescreve lojas existentes.
4. Revalide reservas e abertura antecipada com os responsáveis. Não use bancos reais para a suíte de integração.

Migrations não apagam pedidos e não devem ser revertidas com reset/drop. Clientes antigos fechados precisam ser atualizados para reservar. APK de teste não é artefato de distribuição de produção.
