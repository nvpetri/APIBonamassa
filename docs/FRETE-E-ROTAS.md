# Endereço da pizzaria, frete e rotas

Disponível na API 0.13.0. Aplicar todas as migrations pendentes, incluindo `202610010001_distance_delivery`. Nenhuma base de produção é alterada por este documento.

## Ativação

1. Criar uma conta no [OpenRouteService/HeiGIT](https://account.heigit.org/) e obter uma chave com acesso a geocoding e directions. Conferir no painel do provedor o plano e os limites atuais; as cotas são independentes do Neon.
2. Configurar `MAPS_API_KEY` somente no serviço da API e reiniciar o deploy. `MAPS_API_URL` usa `https://api.openrouteservice.org/` por padrão. Nunca colocar a chave nos apps, no navegador ou no Git.
3. No painel, entrar como gerente → Configurações → Editar operação. Informar rua, número, bairro, cidade, UF e CEP da pizzaria.
4. Selecionar **Cinco faixas por distância**, preencher os cinco limites crescentes em km e os valores em reais e salvar.
5. Homologar com endereços reais próximos, nos limites das faixas e fora da área, antes de liberar para clientes.

Lojas existentes usam `deliveryPricingMode=FLAT` e mantêm seu frete atual até a ativação. É possível salvar o endereço em modo fixo sem chave; ele fica sem coordenadas até a ativação. O repasse fixo ao motoboy continua configurado separadamente do frete cobrado do cliente.

## Regras

As faixas são contíguas e têm exatamente cinco limites. Exemplo ilustrativo, ajustável pelo gerente:

| Faixa | Distância do trajeto  | Frete de exemplo |
| ----- | --------------------- | ---------------- |
| 1     | 0 até 2 km, inclusive | R$ 5,00          |
| 2     | Acima de 2 até 4 km   | R$ 7,00          |
| 3     | Acima de 4 até 6 km   | R$ 9,00          |
| 4     | Acima de 6 até 8 km   | R$ 11,00         |
| 5     | Acima de 8 até 10 km  | R$ 13,00         |

Cada limite pode ir de 0,1 a 100 km; cada taxa de R$ 0 a R$ 100. Valores são armazenados em metros inteiros e centavos. Uma distância de 2.000 m pertence à primeira faixa; 2.001 m, à segunda. Distâncias do provedor são arredondadas para cima até o próximo metro antes de escolher a faixa. Além do quinto limite, a entrega é bloqueada e retirada continua disponível.

A API usa o menor trajeto viário do perfil `driving-car` do ORS, baseado em OpenStreetMap, desde a pizzaria até o endereço. Não é distância em linha reta nem distância percorrida entre paradas de um lote. O perfil é uma referência para cobrança; a navegação do Google Maps pode escolher outro caminho, conforme trânsito e suas regras.

O endereço precisa ser localizado no número e rua informados, no Brasil, com cidade/UF correspondentes e confiança mínima 0,8. Resultados no centro de CEP/cidade/rua, número diferente ou candidatos conflitantes são rejeitados; o sistema não inventa coordenadas nem cobra frete fixo silenciosamente quando mapas falham. A cobertura depende dos dados do provedor: conferir endereços reais da região durante a homologação. Ainda não há seleção manual de ponto no mapa.

## Cotação e persistência

`PATCH /v1/staff/store` aceita os campos opcionais `address`, `deliveryPricingMode` e `deliveryBands` (cinco objetos `{upToMeters, fee}`). As coordenadas da loja são geradas pela API; clientes não podem fornecê-las. Alterações exigem gerente, `expectedVersion` e `Idempotency-Key`. Os formulários antigos de horário não apagam essas configurações.

`POST /v1/orders/quote` calcula o frete para APP, WHATSAPP e COUNTER. Retirada tem frete zero e não consulta mapas. A resposta contém `delivery` com distância, duração de referência, origem, destino, faixa e provedor. A duração não é promessa de horário de entrega. O gerente/balcão e o cliente revisam os valores antes de confirmar.

O pedido guarda `deliverySnapshot` com a origem e o cálculo verificado da cotação. A confirmação não volta a consultar mapas. Se taxas/endereço/localização mudarem durante ou depois da cotação, ela é invalidada e deve ser refeita. Pedidos confirmados preservam frete e endereço de origem, inclusive os agendados. A auditoria mantém identidade e nomes dos campos alterados, ocultando coordenadas e endereço nas cópias de antes/depois.

Consultas externas têm timeout de 8 segundos por chamada e ocorrem antes do lock transacional da loja. A configuração é conferida novamente sob lock. Reenvios de uma chave já concluída consultam a resposta persistida antes de acessar o provedor. Cache por processo: geocodificação 24 h, trajeto 1 h, até 1.000 entradas; consultas simultâneas iguais são compartilhadas. Endereços e trajeto são dados sensíveis: o cache usa hashes como chave e não registra a chave do provedor em logs.

## Entregadores

A saída conjunta devolve pedidos por distância crescente da pizzaria. O app agrupa pedidos de um mesmo endereço, preserva apartamentos/clientes separados e ordena as paradas pela menor distância registrada naquele endereço. Empates usam a ordem dos pedidos; pedidos anteriores à ativação, sem distância, ficam depois e precisam ser conferidos.

O primeiro trecho no Google Maps sai da origem guardada no pedido; destinos usam as coordenadas verificadas quando disponíveis. Trechos seguintes começam na última parada do trecho anterior. O app mantém até três paradas intermediárias por URL e não omite entregas ao dividir a rota. A ordem solicitada é próxima → distante a partir da pizzaria; não é otimização global entre destinos nem acompanha GPS em tempo real.

## Validação

Testes da API cobrem limites, cinco faixas, endereços ambíguos, coordenadas, cache, falha/limite do provedor, isolamento, snapshot, idempotência e mudança concorrente da configuração. Integrações do painel e Android usam um provedor descartável ORS-shaped em `127.0.0.1:3031`, iniciado apenas com `APP_ENV=test`, sem consumir a chave real. O teste com a chave e endereços reais continua necessário na homologação.

Referências: [ORS directions](https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/), [qualidade do Pelias](https://github.com/pelias/documentation/blob/master/result_quality.md), [Google Maps URLs](https://developers.google.com/maps/documentation/urls/get-started).
