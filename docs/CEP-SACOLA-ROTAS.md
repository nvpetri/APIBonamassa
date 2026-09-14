# CEP, sacola e saída conjunta

## Ordem de atualização

1. Atualize a API antes de distribuir os APKs: ela aceita `address.complement`, `address.noComplement` e `POST /v1/driver/routes/start`.
2. Atualize o painel para exibir o complemento sem confundi-lo com referência.
3. Instale Cliente 0.6.0 (versionCode 6) e Entregador 0.4.0 (versionCode 4), com a mesma assinatura dos aplicativos já distribuídos. A URL padrão permanece a mesma.

Não há migration nova: o endereço é um snapshot JSON. Campos de complemento são opcionais na API para aceitar clientes anteriores. Cotações/pedidos antigos e referências já salvas continuam válidos. A nova API também mantém as ações individuais do entregador.

Esta branch inclui a preparação de produção já revisada anteriormente: a API #4 havia sido mesclada em `codex/horarios-e-reservas`, após a incorporação dessa branch em `main`. Revise o [manual de produção](producao/README.md) e as variáveis antes de aplicar em um serviço com auto-deploy. Nenhum merge ou deploy é executado por estes arquivos.

## Endereço do cliente

O CEP vem primeiro. Com oito dígitos e uma pausa de 400 ms, o aplicativo consulta `https://viacep.com.br/ws/{cep}/json/`, usando um cliente HTTP separado, sem token, cookies ou dados do pedido. Só o CEP é enviado ao ViaCEP. O retorno preenche rua, bairro, cidade e UF; confirme os dados, que permanecem editáveis. Número é obrigatório no aplicativo e na API. Complemento é opcional e separado de ponto de referência; marcar “Não possui complemento” limpa/desabilita o campo.

O campo `complemento` retornado pelo ViaCEP pode indicar uma faixa postal (por exemplo, “lado ímpar”). Ele **não** é usado como apartamento/complemento do cliente. CEP geral pode não retornar rua/bairro: o cliente completa esses dados. Erro, CEP inexistente ou indisponibilidade permitem corrigir/reconsultar ou preencher manualmente. Mudar o CEP limpa o endereço anterior e impede que uma consulta antiga preencha o novo CEP. Edições manuais durante a consulta são preservadas. Confira a [documentação ViaCEP](https://viacep.com.br/).

## Uma sacola, um pedido

Adicionar produto apenas salva a sacola local. A inclusão mostra “Continuar comprando” e “Ir para checkout”. A sacola e a revisão também permitem adicionar produtos. A cotação considera todos os itens e uma única taxa de entrega. O cliente só envia após revisar os valores e confirmar o diálogo final. Retirada mantém taxa zero; reservas continuam exigindo confirmação de agendamento.

O envio continua sendo persistido antes da requisição. Toques repetidos são bloqueados enquanto a ação está em andamento, e tentativas de recuperação usam a mesma chave de idempotência. Não se apaga um envio cujo resultado é desconhecido. Depois de um pedido confirmado, outra compra é outro pedido e pode ter outro frete. Esta alteração não reúne nem estorna pedidos antigos automaticamente.

## Entregador

Pedidos ativos são agrupados por rua, número, bairro, cidade, UF e CEP, normalizando espaços, maiúsculas e acentos. Apartamentos diferentes ficam na mesma parada, mantendo os pedidos e complementos individualizados. Endereços ausentes não são agrupados entre si. Não se aproximam nomes de ruas nem se inferem coordenadas.

“Iniciar rota com N pedidos” inclui os pedidos prontos atribuídos ao entregador, ainda a retirar ou já retirados. O diálogo lista os pedidos e exige confirmar a conferência/retirada. A API faz uma única transação: verifica conta, loja, atribuição, versões, disponibilidade e etapas de todos. Se algum falhar, nenhum começa. Para os ainda não coletados, registra retirada e início, mantendo ambos os eventos. Os demais recebem apenas o evento de início. Cobrança, entrega e devolução continuam individuais.

Contrato (exemplo, IDs substituídos pelos pedidos reais):

```json
{
  "deliveries": [
    { "id": "c8f8a8c0-b944-45ec-8158-8dcf437d5185", "expectedVersion": 5 },
    { "id": "f0dcc606-2b58-4635-9d5d-14f23c61c312", "expectedVersion": 6 }
  ],
  "confirmCollected": true
}
```

Exige Bearer de entregador e `Idempotency-Key`; aceita 1–100 IDs distintos. Responde `{ "items": [...] }` com a projeção de cada entrega. Repetir a mesma chave/corpo devolve a confirmação anterior; o app recarrega o estado canônico antes de habilitar novos comandos. Uma versão/atribuição alterada exige atualizar e conferir novamente. Pedidos atribuídos após a conferência ficam para a próxima saída, sem inclusão silenciosa.

## Navegação

Depois da saída, “Abrir rota no Google Maps” inclui os endereços em andamento, agrupados por parada. A sequência é a do pedido mais antigo de cada endereço: **não há otimização por distância, trânsito ou GPS**. O motoboy deve conferir a sequência antes de dirigir.

Os links do Maps têm limite de 2.048 caracteres e até três paradas intermediárias em navegadores móveis. Por isso, o app mostra trechos de até quatro destinos e divide mais cedo se necessário pelo tamanho da URL. Todos os trechos ficam visíveis: nenhum endereço é omitido. Consulte [Maps URLs](https://developers.google.com/maps/documentation/urls/get-started). Completar uma entrega a remove da rota ativa; as outras continuam pendentes. Waze individual permanece disponível no detalhe.

## Testar antes da apresentação

- Adicione pizza, escolha continuar comprando e adicione bebida. Antes da confirmação, a API não deve conter pedido novo. Na revisão, confira dois produtos e um frete; envie uma vez.
- Troque rapidamente o CEP, simule falta de conexão, use CEP geral, deixe número vazio e teste com/sem complemento. Confira o endereço no painel e no entregador.
- Atribua dois pedidos do mesmo prédio e outro de endereço distinto. Confira agrupamento, confirmação obrigatória, saída de todos e navegação por paradas. Entregue apenas um e confirme que os outros não foram concluídos.
- Reatribua um pedido enquanto o diálogo de saída estiver aberto: a rota deve recusar a lista antiga sem saída parcial. Simule perda da confirmação e use “Verificar envio”: os eventos não podem duplicar.
- Testes automatizados da API usam PostgreSQL descartável; testes Android usam API local isolada e respostas controladas para CEP. Nunca a loja pública.
