# MangaAll — fontes ativas e preparação de leitura (30/10/2026)

Estado: **MangaDex e MangaDot liberados somente para publicação assinada de lookup/chapters; MangaBall pausado** por decisão do usuário enquanto não houver autorização verificável de API. Não remover a identidade `app.tsuzuki.mangaall.mangaball`; ela poderá ser retomada em outra revisão. Não consultar MangaBall, contornar 403, usar cookies de outros apps ou imitar navegador/Mihon.

## Instalação e integridade

- Produto MangaAll permanece agregado; identidades/grants por fonte continuam isolados.
- `mangaall/product.json` lista somente MangaDex e MangaDot em `firstPhysicalSmokeSources`. MangaBall tem `status=paused-awaiting-api-approval`.
- `mangaall/index.js` nunca seleciona MangaBall para `lookupAcross`; `chapters/pages` rejeitam explicitamente a fonte pausada.
- Host [PR #167](https://github.com/jssantogit/tsuzuki/pull/167): catálogo e `ProviderRepositoryManager.installMangaAll` exigem somente as duas fontes ativas, com verificação de índice assinado, repository/trust origin, staging atômico e revogação. Identidade MangaBall reservada e seus artefatos não baixados.
- Manifestos MangaDex/MangaDot usam `publication=metadata-only`, versão `0.1.0`/code 1 e somente `reading.lookup@1` + `reading.chapters@1`; MangaBall continua `development`. O índice assinado poderá transportar evidências sem páginas; não há APK de validação nem aceite da leitura.

## Verificações por fonte

### MangaDex

- Um único [preflight de API pública #41056812707](https://github.com/jssantogit/providers-tsuzuki/actions/runs/41056812707) de `GET /manga?title=Dandadan&limit=1`, com identificação real do Tsuzuki, sem cookies, redirects ou retries, recebeu **HTTP 200** e um registro de obra com esquema reconhecido. Nenhuma chamada de capítulos, At-Home ou CDN. Isso comprova apenas conectividade e descoberta a partir do runner, não entrega no Android.
- `reading.lookup` e `reading.chapters` estão cobertos por fixtures; identidade do work e do chapter são preservadas, e observações chegam ao ICE como `PROVIDER_PROVISIONAL`, sem promoção editorial fictícia.
- O protótipo interno de páginas já valida relação capítulo/obra e limita servidores de imagens a `uploads.mangadex.org` e subdomínios `*.mangadex.network` HTTPS:443. Não está exportado.
- **Aceite de Reader pendente:** atender à [política de uso do MangaDex](https://api.mangadex.org/docs/redoc.html#section/Acceptable-use-policy), incluindo crédito à fonte, crédito ao grupo de scanlation, pedidos de remoção de conteúdo e restrições à monetização; verificar a UI existente e testes de imagens reais antes de declarar `reading.pages@1`.

### Auditoria específica Keiyoushi MangaDot (30/10/2026)

Revisão do upstream `keiyoushi/extensions-source`, arquivo [MangaDot.kt](https://github.com/keiyoushi/extensions-source/blob/main/src/all/mangadotnet/src/eu/kanade/tachiyomi/extension/all/mangadotnet/MangaDot.kt) (SHA de blob observado `5ad2d285`) e [KeiSource.kt](https://github.com/keiyoushi/extensions-source/blob/main/core/src/main/kotlin/keiyoushi/source/KeiSource.kt). O [changelog MangaDot](https://mangadot.net/page/changelogs) informa que o site introduziu proteção de imagens em cinco camadas em 21/03/2026; isso **não** equivale a prova de que a extensão contorna ou satisfaz tais camadas em toda rede.

O Keiyoushi faz `GET /api/manga/{id}/chapters/list?lang=...` e `GET /api/{uploads|chapters}/{id}/images`, desserializa `images[].url`, converte paths relativos para o domínio do site e aceita URLs absolutas HTTP de origem externa na sua implementação. Para cada imagem, `imageRequest` define o **Referer completo da página do capítulo** (sem fragmento); `KeiSource.headersBuilder()` acrescenta `Origin: https://mangadot.net` e `Referer: https://mangadot.net/` como defaults, com User-Agent fornecido pelo app; o cliente compartilhado verifica presença de `UserAgentInterceptor` e `CloudflareInterceptor`, mas **não há lógica MangaDot específica para decodificar tokens, cookies, captcha, ou burlar as cinco camadas**. Uma requisição assíncrona de contabilização `POST /api/manga/{id}/view` é executada após recuperar metadados de páginas, mas não é mecanismo de decodificação nem requisito comprovado para carregar imagens.

No MangaAll, a estrutura das rotas e Referer da página já coincidem, com checagem adicional de vínculo obra/capítulo. Diferentemente do cliente Keiyoushi, o protótipo `pages()` envia somente `Referer`, sem `Origin`; seus `GET` de API usam `Accept: application/json`, sem customização MangaDot específica de User-Agent. A URL de imagem é deliberadamente limitada a HTTPS do domínio `mangadot.net`, sem aceitar URLs absolutas externas não verificadas. Essas são diferenças de contrato, **não defeitos comprovados no Android**. Não alargar manifests nem adicionar Cloudflare/bypass, cookies ou credenciais simplesmente para reproduzir Keiyoushi. Uma vez esclarecidas as permissões, verificar com um único smoke consentido e logs sanitizados se o endpoint fornece imagens first-party, se os cabeçalhos previstos são suficientes, qual código HTTP retorna e se bytes realmente decodificam no Reader. Continuar com `reading.pages@1` desabilitado até validação.

### MangaDot

- A implementação usa os endpoints e DTOs documentados pela extensão [Keiyoushi MangaDot](https://github.com/keiyoushi/extensions-source/blob/main/src/all/mangadotnet/src/eu/kanade/tachiyomi/extension/all/mangadotnet/MangaDot.kt); respostas e URLs são verificadas apenas em fixtures offline. URLs de imagem devem ser `mangadot.net` HTTPS:443; CDNs externas não recebem grants implícitos.
- O [changelog público do MangaDot](https://mangadot.net/page/changelogs) menciona proteção anti-scraping para imagens. **Não afirmar acesso de API ou leitura real**, nem responder a bloqueios com bypass. Confirmar regras de uso e disponibilidade antes de smoke online. Mesmo que metadados funcionem, as páginas podem requerer revisão de acesso.
- Mantém diferenciação de capítulos por origem (`uploads` e `chapters`), idioma desconhecido como `null`, verificação obra/capítulo em protótipos, e URLs fail-closed.

## Fechamento técnico desta rodada (30/10/2026)

- **MangaDot — headers Keiyoushi alinhados por TDD:** `modules/http.js` usa `Origin: https://mangadot.net`, `Referer: https://mangadot.net/` e identificação honesta `User-Agent: Tsuzuki-MangaAll/0.1 (+https://github.com/jssantogit/providers-tsuzuki)` em metadados; `modules/mangadot.js` inclui esses mesmos `Origin` e `User-Agent` e preserva o Referer da página específica nas solicitações de imagens. Sem cookies, browser impersonation, Cloudflare bypass, `POST /view` ou ampliação de CDNs. RED [Provider CI #41062343319](https://github.com/jssantogit/providers-tsuzuki/actions/runs/41062343319) falhou no teste de metadados, GREEN #41062459348 aprovado.
- **MangaDex — imagens com identidade real do Tsuzuki:** mesma constante de `User-Agent` para API e listas de páginas `MangaDex@Home`, sem `Referer` artificial nem alterar grants. RED no teste de páginas [PR #47](https://github.com/jssantogit/providers-tsuzuki/pull/47), GREEN [Provider CI #41063097986](https://github.com/jssantogit/providers-tsuzuki/actions/runs/41063097986) **SUCCESS** na HEAD `98805a76`.
- **Preflight externo de capítulo MangaDex é INCONCLUSIVO, não verde:** [run #41062608658](https://github.com/jssantogit/providers-tsuzuki/actions/runs/41062608658) procurou uma obra exata `Dandadan` e recebeu `readable_chapter_unavailable` nos primeiros até dez resultados em inglês. A execução não alcançou o endpoint `/chapter/{id}` nem `MangaDex@Home`; 0 imagens baixadas e 0 retries. **Não concluir que MangaDex não contém capítulos**, nem fingir que image-host foi validado. O teste está explicitamente classificado como falha de amostra; não foi repetido. A busca anterior de obra, [#41056812707](https://github.com/jssantogit/providers-tsuzuki/actions/runs/41056812707), continua comprovação limitada de HTTP 200 de `/manga`.
- **Host Android:** adicionada à [PR #167](https://github.com/jssantogit/tsuzuki/pull/167) regressão MockWebServer para verificar que o Reader realmente encaminha `Referer`, `Origin` e `User-Agent` de `PreparedHttpPage` e mantém o corpo da imagem sem alterações. Não substitui smoke físico nem prova acesso ao site.

**Atribuição verificada no Host:** `ProviderChapterObservation.scanlationGroup` existe e `mangadex.chapters()` a preenche quando a API devolve uma relação `scanlation_group`. Mas `ProviderChapterEvidenceAdapter.toEvidence()` não transfere o campo, pois `ChapterEvidence` não possui grupo de scanlation; `ProviderReadingDelivery.PageList` também não fornece dados de crédito ao Reader. Logo, ainda não há uma rota comprovada para exibir o grupo correto de cada capítulo MangaDex no Reader. **Não contornar o requisito com crédito genérico**: projetar a atribuição por variante/produtor sem corromper identidade/progresso, assegurar exibição no Default Skin, cobrir com teste de integração, e validar processo de pedido de remoção antes de publicar.

**Decisão de release:** permanecem dois impedimentos de aceite. (1) A política oficial [MangaDex](https://gitlab.com/mangadex-pub/mangadex-api-docs/-/blob/main/index.md) exige crédito ao serviço e grupo, atendimento a pedidos de remoção e ausência de anúncios/serviços pagos; a UI/fluxo operacional precisa ter comprovação desse contrato. (2) A entrega física de páginas reais em MangaDex/MangaDot não foi demonstrada; MangaDot descreve proteção anti-scraping e nenhuma solução Keiyoushi específica foi encontrada. Portanto a **publicação restrita a metadata-only** e a ausência de `reading.pages@1` são **gates deliberados**; CI unitária verde não libera distribuição. MangaBall permanece pausado.

## Autorização de publicação assinada restrita (30/10/2026)

O usuário solicitou publicar o Provider assinado no repositório já matriculado. **Isso
autoriza apenas o pacote de evidências de capítulos** de MangaDex e MangaDot, sem
anunciar Reader, sem simular autorização para MangaBall e sem rotacionar a chave.
Manter o repositório `app.tsuzuki.providers`, key ID
`tsuzuki-provider-root-2026-02` e fingerprint existente. A publicação deve
incluir exatamente as duas identidades `app.tsuzuki.mangaall.mangadex` e
`app.tsuzuki.mangaall.mangadot`, preservar providers existentes e manter
`app.tsuzuki.mangaall.mangaball` fora do índice assinado.
O workflow em `main` assina o índice com o secret previamente configurado.
Mudar somente `repository.sequence` de forma estritamente crescente. Não
publicar um conjunto assinado incompleto nem chaves novas.

Esta é uma **prévia verificável de inventário**, não o aceite de páginas e
tampouco um APK. A instalação agrupada no Host depende da PR #167.

## Gates pendentes

1. Host PR #167 e Provider PR #47 Draft com CI exata verde; validação do `ProviderRepositoryManager` em install/update/rollback das **duas** fontes.
2. Confirmação de políticas de acesso/atribuição, principalmente Reader MangaDex e anti-scraping MangaDot.
3. Ponta a ponta `lookup → binding → chapters → ICE` por fonte, correlação de obra/edição, sem títulos sintéticos ou contaminação de progresso.
4. Somente após os itens anteriores: autorizar `reading.pages@1` por fonte, checar CDN/headers, renderização/cancelamento e progresso no Samsung Galaxy A54 Android 14.
5. APK **Release assinada atualizável sobre a instalação existente**, sem reset ou nova instalação de repositórios, após compilar/CI full e sem misturar com o fechamento do Catálogo.

Não confundir **fixtures verdes** ou **GET de metadados MangaDex** com aceitação física de leitura.
