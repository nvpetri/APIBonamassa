# Contrato de integração — API 0.1.0

Base: `/v1`. JSON UTF-8, centavos inteiros e horários ISO 8601 com fuso. Na interface, apresentar horários em `America/Sao_Paulo`. O relógio válido para promoções e cotações é o do servidor.

## Sessão e perfis

`POST /sessions` recebe `{"storeSlug":"bonamassa","email":"...","password":"..."}` e devolve `accessToken`, `tokenType: "Bearer"`, `expiresAt` e `user`. O token é opaco, aleatório; somente seu SHA-256 fica no PostgreSQL. O acesso dura até 12 horas por padrão (configurável entre 1 e 24). Não existe refresh token: reautentique após expiração. `DELETE /sessions/current` revoga a sessão. `POST /me/password` confere a senha atual e revoga todas as sessões, inclusive a atual.

O token vai em `Authorization: Bearer <token>`, nunca na URL. `POST /customers` cria exclusivamente `CUSTOMER`. Somente gestores usam `/staff/users` para cadastrar equipe. Não existe seletor local de perfil com poder de autorização. A loja e o perfil são obtidos da sessão em todas as operações privadas.

| Perfil      | Permissões operacionais                                                                                    |
| ----------- | ---------------------------------------------------------------------------------------------------------- |
| `MANAGER`   | Equipe, catálogo, fotos, promoções, loja, pedidos, cozinha, despacho, cancelamento e pagamento externo.    |
| `ATTENDANT` | Pedidos manuais, aceite, atribuição, consulta de catálogo/promoções/entregadores, retirada e devolução.    |
| `KITCHEN`   | Consulta da produção, iniciar preparo e marcar pronto. Sem dados do cliente, endereço, pagamento ou preço. |
| `DRIVER`    | Própria disponibilidade e entregas atribuídas; coleta, rota, conclusão, tentativa e devolução.             |
| `CUSTOMER`  | Próprias cotações e pedidos; cancelamento somente enquanto `NEW`.                                          |

Desativar funcionário revoga suas sessões. Um entregador com pedidos ativos precisa concluir ou reatribuir a carga antes de ser desativado. Pausar novas coletas é diferente de desativar a conta: um entregador pausado pode concluir pedidos já coletados.

## Rotas

O Swagger expõe os corpos e parâmetros de cada endpoint. Nos caminhos abaixo, acrescente `/v1`.

| Rotas                                                                              | Uso                                                                               |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `GET /stores/{slug}/catalog`                                                       | Catálogo público de produtos disponíveis e campanhas ativas.                      |
| `GET /staff/catalog`                                                               | Catálogo administrativo, incluindo pausados, versões e configurações da loja.     |
| `POST /staff/products`, `PATCH /staff/products/{id}`                               | Cadastro e edição completa do produto. Categoria de produto existente é imutável. |
| `POST /staff/product-images`                                                       | Upload autenticado, `multipart/form-data`, campo `file`; resposta com `imageId`.  |
| `GET /stores/{slug}/images/{id}`                                                   | Imagem já associada a produto da loja, com ETag.                                  |
| `GET/POST /staff/promotions`, `PATCH /staff/promotions/{id}`                       | Campanhas e consumo; edição não zera reservas nem vendas.                         |
| `PATCH /staff/store`                                                               | Nome, abertura, taxa fixa e comissão do entregador.                               |
| `GET/POST /staff/users`, `PATCH /staff/users/{id}`                                 | Equipe; o PATCH ativa/desativa e exige versão.                                    |
| `GET /staff/drivers`, `PATCH /staff/drivers/{id}/availability`                     | Disponibilidade e carga dos entregadores; PATCH exclusivo do gestor.              |
| `POST /orders/quote`                                                               | Cotação autenticada para cliente ou atendimento.                                  |
| `POST /orders`, `POST /staff/orders`                                               | Criar a partir de `quoteId`; cliente e atendimento, respectivamente.              |
| `GET /me/orders`, `GET /orders/{id}`                                               | Histórico e detalhe do próprio cliente.                                           |
| `GET /staff/orders`, `GET /staff/orders/{id}`                                      | Pedidos da loja, com resposta filtrada para a cozinha.                            |
| `POST /staff/orders/{id}/accept`, `/prepare`, `/ready`                             | Aceite, início e término do preparo.                                              |
| `POST /orders/{id}/cancel`, `POST /staff/orders/{id}/cancel`                       | Cancelamento com motivo; cliente em NEW, gestor antes da coleta.                  |
| `POST /staff/orders/{id}/assign`                                                   | Atribuir/reassociar entregador disponível antes da coleta.                        |
| `POST /staff/orders/{id}/pickup-complete`                                          | Concluir retirada no balcão.                                                      |
| `POST /staff/orders/{id}/record-payment`                                           | Gestor registra pagamento externo conferido, com `reference`.                     |
| `POST /staff/orders/{id}/return`                                                   | Expedição confirma carga devolvida após tentativa.                                |
| `GET /driver/deliveries`, `GET /driver/deliveries/{id}`                            | Entregas atribuídas ao usuário autenticado.                                       |
| `PATCH /driver/availability`                                                       | Disponibilidade do próprio entregador.                                            |
| `POST /driver/deliveries/{id}/collect`, `/start`, `/complete`, `/issue`, `/return` | Fluxo autenticado do motoboy.                                                     |

Listagens de pedidos aceitam `status`, `limit` (1–100, padrão 30) e `cursor`. Resposta: `{items, nextCursor}`. O cursor é opaco para o cliente; mantenha o mesmo filtro ao avançar. A ordenação usa a numeração decrescente da loja, sem deslocamentos de paginação quando entra um pedido novo. `delivery.id` é o mesmo `order.id` nesta versão.

## Criar um pedido

O cliente se cadastra ou autentica, lê o catálogo e envia referências de produto. Não envia totais, taxas, status, perfil ou marcação de pagamento.

```json
{
  "items": [
    {
      "kind": "PIZZA",
      "flavorIds": ["calabresa", "frango"],
      "size": "LARGE",
      "crust": "CREAM",
      "quantity": 1,
      "note": "Sem cebola"
    },
    { "kind": "DRINK", "productId": "refrigerante-2l", "quantity": 1 },
    { "kind": "COMBO", "productId": "combo-dupla", "quantity": 1, "note": "" }
  ],
  "mode": "DELIVERY",
  "address": {
    "street": "Rua de Teste",
    "number": "10",
    "neighborhood": "Centro",
    "city": "Cidade Exemplo",
    "state": "SP",
    "postalCode": "01001000",
    "reference": "Portão de teste"
  },
  "note": "",
  "payment": "CARD",
  "cashTendered": null,
  "promotionId": null
}
```

Envie para `POST /orders/quote` com Bearer e uma `Idempotency-Key`. Na retirada use `mode: "PICKUP"` e `address: null`. Em dinheiro, `cashTendered: null` significa valor exato; um valor informado deve cobrir o total. O gestor/atendente usa a mesma cotação, acrescentando `customer: {name, phone}` e `channel: "COUNTER" | "WHATSAPP"`. Esses campos são recusados no app cliente.

A resposta inclui `quoteId`, `expiresAt`, `items`, `subtotal`, `fee`, `discount`, `total` e `promotion`. Após mostrar os valores ao cliente, envie `{"quoteId":"..."}` para `POST /orders`, com **outra chave**. Pedidos manuais usam `POST /staff/orders`.

A cotação dura cinco minutos e **não reserva cota promocional**. Na confirmação, a API recalcula tudo sob a mesma transação que grava o pedido e a reserva. Mudanças de preço, descrição, composição, vigência ou distribuição promocional retornam `409 QUOTE_CHANGED`; a interface deve cotar e pedir revisão do novo resultado. Não repita automaticamente com um preço diferente.

Uma cotação só pode originar um pedido. Reutilizar seu `quoteId` com outra chave retorna o pedido existente, sem nova cobrança ou reserva. O reenvio da mesma chave retorna exatamente a resposta original, mesmo que o pedido já tenha avançado depois; faça GET para obter o estado mais recente.

## Versão, idempotência e erros

Todas as mutações de negócio (incluindo cotação, cadastro e upload) exigem `Idempotency-Key` com 16–100 caracteres entre letras, números, hífen e sublinhado. Gere um UUID e **persista chave + corpo antes do envio**. Não é necessário para login, cadastro público, logout e troca de senha. Esses endpoints têm regras próprias; não execute retries cegos de cadastro ou troca de senha.

Chaves são isoladas por loja e usuário. A mesma chave e o mesmo comando retornam a resposta salva; mudar o corpo ou o recurso com a mesma chave retorna `409 IDEMPOTENCY_CONFLICT`. Não há efeito parcial: alteração, evento, reserva e registro da chave são confirmados juntos.

```http
POST /v1/staff/orders/{id}/prepare
Authorization: Bearer <token>
Idempotency-Key: <uuid-persistido>
Content-Type: application/json

{"expectedVersion":2}
```

| Situação                                 | Resposta e tratamento                                 |
| ---------------------------------------- | ----------------------------------------------------- |
| Campo inválido ou desconhecido           | `400 INVALID_INPUT`; conferir `details`.              |
| Sessão ausente, expirada ou revogada     | `401`; autenticar novamente.                          |
| Perfil sem permissão                     | `403 FORBIDDEN`.                                      |
| Recurso de outro cliente/loja/entregador | `404 NOT_FOUND`, sem revelar sua existência.          |
| Versão, cotação ou etapa desatualizada   | `409`; consultar o recurso e reconciliar a interface. |
| Regra comercial inválida                 | `422`; explicar o motivo retornado.                   |
| Limitação de tentativas                  | `429`; aguardar `Retry-After`.                        |
| Falha transitória da transação           | `503 RETRY_LATER`; reenviar com a mesma chave.        |

Erros contêm `code`, `message` e `requestId`, também recebido no header `X-Request-Id`. Não usar o texto de `message` como enum. Em perda de conexão, o estado é **pendente de confirmação**, não sucesso nem falha definitiva. Reenviar chave e corpo resolve a ambiguidade.

## Catálogo, combos e imagens

Categorias: `PIZZA`, `CRUST`, `DRINK`, `COMBO`. Pizzas exigem `pizzaGroup: "TRADITIONAL" | "SPECIAL"`. Meio a meio é um item com dois `flavorIds` diferentes. Tamanhos: `SMALL`, `MEDIUM`, `LARGE`; o maior preço dos sabores escolhidos é cobrado, mais uma borda. `NONE` significa sem recheio na borda; `CREAM` e `CHEDDAR` são produtos do seed, não enum fixo.

Um produto tem `prices: {SMALL, MEDIUM, LARGE}` em centavos. Bordas, bebidas e combos exigem valores iguais nos três campos. Limite de 200 produtos/loja; o nome normalizado não pode se repetir na mesma categoria, inclusive sob concorrência. Produtos são pausados, sem exclusão física ou troca de categoria. PATCH envia todos os campos editáveis e `expectedVersion`.

`combo` contém 2–6 linhas PIZZA/DRINK, com quantidade e configuração de cada pizza. Uma linha pode ser inteira ou meio a meio. O pedido COMBO envia apenas `productId`, quantidade e observação; a composição é fixa nesta etapa. O preço cadastrado do combo é independente da soma avulsa. `comparison` informa a referência atual, diferença e percentual, sem alterar o valor final. Pausar componente impede novas vendas do combo.

Pedidos preservam nomes, descrições, notas, preço unitário e componentes. As quantidades em `items[].components` são **por combo**: multiplique por `items[].quantity` apenas ao mostrar a produção. Não some componentes novamente ao total. Alterar o catálogo não modifica o histórico.

Upload de foto: máximo 5 MB de entrada e 16 megapixels, formato estático JPEG/PNG/WebP validado pelo conteúdo. O servidor remove metadados, ajusta orientação e converte para WebP de até 1200×1200 e 1 MB. A resposta traz `imageId`; associe-o no cadastro/edição. Para remover a foto, use `imageId: null`.

O catálogo fornece `photo` como caminho relativo da API. A imagem só fica acessível depois de associada a um produto, e deve pertencer à mesma loja. Não envie data URLs no produto. Fotos ficam no PostgreSQL nesta base (limite de 100 MB por loja); podem migrar para R2/S3 mantendo o contrato de IDs. Não são copiadas para pedidos ou eventos. Manutenção remove imagens sem associação após 24 horas.

## Promoções

Campanhas aceitam `kind: PERCENTAGE | FIXED`, `value` (% inteiro ou centavos), início, fim opcional e cota de pizzas opcional. Deve existir fim ou cota. O fim da vigência é exclusivo. Há uma promoção selecionada por pedido, sem acumular campanhas.

Somente pizzas avulsas participam; desconto calculado por unidade sobre o preço do sabor, excluindo borda, bebidas, combos e entrega. Meia pizza não duplica consumo. Percentual arredonda por pizza em centavos; valor fixo é limitado ao valor do sabor. A cota restante é aplicada na ordem dos itens, podendo cobrir parte de uma quantidade. O orçamento mostra essa distribuição para revisão.

Pedido ativo reserva; entregue converte reserva em vendido. Cancelado/devolvido libera; em retorno ainda ocupa cota. Edição da campanha não zera consumo nem altera descontos passados. A cota não pode ser reduzida abaixo de reservado + vendido. A base mantém esses contadores e restrições também no banco, sem depender de pedidos recentes ou do histórico carregado na tela.

## Estados e entregador

| Pedido             | Entrega                         | Ação seguinte                                                   |
| ------------------ | ------------------------------- | --------------------------------------------------------------- |
| `NEW`              | `null`                          | Aceitar ou cancelar.                                            |
| `CONFIRMED`        | `null`                          | Iniciar preparo.                                                |
| `PREPARING`        | `null`                          | Marcar pronto.                                                  |
| `READY`            | `null`                          | Atribuir entregador ou concluir retirada.                       |
| `READY`            | `ASSIGNED`                      | Entregador confirma coleta.                                     |
| `READY`            | `COLLECTED`                     | Entregador inicia rota.                                         |
| `OUT_FOR_DELIVERY` | `ON_ROUTE`                      | Concluir ou informar tentativa.                                 |
| `RETURNING`        | `RETURNING`                     | Confirmar devolução.                                            |
| `DELIVERED`        | `DELIVERED` ou `null` no balcão | Terminal.                                                       |
| `RETURNED`         | `RETURNED`                      | Terminal, sem venda concluída nem comissão nesta regra inicial. |
| `CANCELLED`        | `null`                          | Terminal, antes da coleta.                                      |

`assign` recebe `driverId`; `complete` e `pickup-complete` recebem `recipient` e `paymentCollected`; `issue` e `cancel` recebem `reason`. Todos carregam `expectedVersion`. Não há comando genérico para definir livremente um status.

`fee` é a taxa do cliente. `driverFee` é a comissão combinada, fotografada na atribuição, e só entra em `driverEarnings` quando entregue. Não somar dinheiro recebido à comissão. `PREPAID` vem exclusivamente de registro do gestor, com referência do pagamento conferido fora da API. A seleção do cliente não confirma pagamento. Cancelamento/devolução de pedido com pagamento externo não executa estorno; a conferência financeira é externa nesta versão.

## Tempo real e reconexão

Socket.IO no mesmo host, caminho `/socket.io`. Envie o token em `auth.token`. Origens web devem estar em `CORS_ORIGINS`; apps nativos não precisam enviar Origin. Não existem salas ou assinaturas escolhidas pelo cliente.

```ts
const socket = io(API_ORIGIN, { auth: { token: accessToken } });
socket.on("ready", () => repository.reload());
socket.on("invalidate", () => repository.reload());
```

Tipos: `order.created`, `order.updated`, `catalog.updated`, `promotion.updated`, `promotion.usage.changed`, `store.updated`, `driver.availability.changed`. Eventos de pedido carregam apenas `type`, `orderId` e `version`. Cliente recebe avisos dos próprios pedidos, entregador dos atribuídos, equipe da sua loja. Reatribuição também avisa o entregador anterior para remover a entrega. Eventos de catálogo/loja não contêm dados pessoais.

Os avisos são enviados depois do commit, sem garantia de entrega. Reconsultar REST ao conectar, voltar ao primeiro plano e periodicamente enquanto a tela operacional estiver aberta. O evento `ready` pede essa reconciliação. Queda entre commit e aviso ou eventos perdidos não pode travar o app. Logout/desativação desconecta sessões, e a expiração encerra o socket.

## Ajustes necessários nas demos

| Diferença atual                                                            | Decisão para integrar                                                                                                           |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Cliente Android usa Média/Grande/Família; painel usa Pequena/Média/Grande. | Alinhar cardápio e enum explicitamente; não mapear por posição nem transformar família silenciosamente.                         |
| Android calcula BONA10, adicionais, sobremesas e frete local.              | Remover totais confiáveis locais; usar cotação da API. BONA10, adicionais e sobremesas não estão neste contrato.                |
| Android mostra Pix simulado.                                               | Oferecer somente `paymentMethods` retornados pela API; gateway e webhook serão outra etapa.                                     |
| Painel usa endereço em texto e foto em data URL.                           | Adaptar o formulário ao endereço estruturado e upload com `imageId`.                                                            |
| Datas promocionais do painel são epoch em ms.                              | Converter explicitamente para ISO 8601 no adaptador; apresentar no fuso da loja.                                                |
| Demos usam simulações e transformações de estado local.                    | Substituir por comandos; aceitar somente a resposta do servidor.                                                                |
| IndexedDB/DataStore preservam dados de demonstração.                       | Não importar pedidos simulados para a API; migrar preferências separadamente e iniciar cache remoto com escopo por sessão/loja. |

No painel, um BFF do Next pode manter o Bearer no servidor e usar cookie HttpOnly para o navegador; esta API ainda não fornece autenticação por cookie. Nos Android, a integração deve implementar armazenamento protegido de sessão, fila de comandos, INTERNET e configuração de rede apenas de debug para servidor local. Não colocar segredos de gateway no APK. Para emulador Android, o host local costuma ser `10.0.2.2:3001`; dispositivos físicos precisam acessar o IP de desenvolvimento na mesma rede.

Fontes técnicas: [autenticação no NestJS](https://docs.nestjs.com/security/authentication) e [OpenAPI no NestJS](https://docs.nestjs.com/openapi/introduction).
