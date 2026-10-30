# MangaAll — fontes ativas e preparação de leitura (30/10/2026)

Estado: **MangaDex e MangaDot em desenvolvimento; MangaBall pausado** por decisão do usuário enquanto não houver autorização verificável de API. Não remover a identidade `app.tsuzuki.mangaall.mangaball`; ela poderá ser retomada em outra revisão. Não consultar MangaBall, contornar 403, usar cookies de outros apps ou imitar navegador/Mihon.

## Instalação e integridade

- Produto MangaAll permanece agregado; identidades/grants por fonte continuam isolados.
- `mangaall/product.json` lista somente MangaDex e MangaDot em `firstPhysicalSmokeSources`. MangaBall tem `status=paused-awaiting-api-approval`.
- `mangaall/index.js` nunca seleciona MangaBall para `lookupAcross`; `chapters/pages` rejeitam explicitamente a fonte pausada.
- Host [PR #167](https://github.com/jssantogit/tsuzuki/pull/167): catálogo e `ProviderRepositoryManager.installMangaAll` exigem somente as duas fontes ativas, com verificação de índice assinado, repository/trust origin, staging atômico e revogação. Identidade MangaBall reservada e seus artefatos não baixados.
- Os manifestos MangaDex/MangaDot permanecem `publication=development`, sem `reading.pages@1`. Não há APK de validação do MangaAll nem merge autorizado.

## Verificações por fonte

### MangaDex

- Um único [preflight de API pública #41056812707](https://github.com/jssantogit/providers-tsuzuki/actions/runs/41056812707) de `GET /manga?title=Dandadan&limit=1`, com identificação real do Tsuzuki, sem cookies, redirects ou retries, recebeu **HTTP 200** e um registro de obra com esquema reconhecido. Nenhuma chamada de capítulos, At-Home ou CDN. Isso comprova apenas conectividade e descoberta a partir do runner, não entrega no Android.
- `reading.lookup` e `reading.chapters` estão cobertos por fixtures; identidade do work e do chapter são preservadas, e observações chegam ao ICE como `PROVIDER_PROVISIONAL`, sem promoção editorial fictícia.
- O protótipo interno de páginas já valida relação capítulo/obra e limita servidores de imagens a `uploads.mangadex.org` e subdomínios `*.mangadex.network` HTTPS:443. Não está exportado.
- **Aceite de Reader pendente:** atender à [política de uso do MangaDex](https://api.mangadex.org/docs/redoc.html#section/Acceptable-use-policy), incluindo crédito à fonte, crédito ao grupo de scanlation, pedidos de remoção de conteúdo e restrições à monetização; verificar a UI existente e testes de imagens reais antes de declarar `reading.pages@1`.

### MangaDot

- A implementação usa os endpoints e DTOs documentados pela extensão [Keiyoushi MangaDot](https://github.com/keiyoushi/extensions-source/blob/main/src/all/mangadotnet/src/eu/kanade/tachiyomi/extension/all/mangadotnet/MangaDot.kt); respostas e URLs são verificadas apenas em fixtures offline. URLs de imagem devem ser `mangadot.net` HTTPS:443; CDNs externas não recebem grants implícitos.
- O [changelog público do MangaDot](https://mangadot.net/page/changelogs) menciona proteção anti-scraping para imagens. **Não afirmar acesso de API ou leitura real**, nem responder a bloqueios com bypass. Confirmar regras de uso e disponibilidade antes de smoke online. Mesmo que metadados funcionem, as páginas podem requerer revisão de acesso.
- Mantém diferenciação de capítulos por origem (`uploads` e `chapters`), idioma desconhecido como `null`, verificação obra/capítulo em protótipos, e URLs fail-closed.

## Gates pendentes

1. Host PR #167 e Provider PR #47 Draft com CI exata verde; validação do `ProviderRepositoryManager` em install/update/rollback das **duas** fontes.
2. Confirmação de políticas de acesso/atribuição, principalmente Reader MangaDex e anti-scraping MangaDot.
3. Ponta a ponta `lookup → binding → chapters → ICE` por fonte, correlação de obra/edição, sem títulos sintéticos ou contaminação de progresso.
4. Somente após os itens anteriores: autorizar `reading.pages@1` por fonte, checar CDN/headers, renderização/cancelamento e progresso no Samsung Galaxy A54 Android 14.
5. APK **Release assinada atualizável sobre a instalação existente**, sem reset ou nova instalação de repositórios, após compilar/CI full e sem misturar com o fechamento do Catálogo.

Não confundir **fixtures verdes** ou **GET de metadados MangaDex** com aceitação física de leitura.
