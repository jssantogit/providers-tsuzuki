# MangaAll / MangaBall — auditoria de compatibilidade Keiyoushi

Estado: 2026-10-30. Registro técnico da [PR #47](https://github.com/jssantogit/providers-tsuzuki/pull/47); **não** é aceite real de HTTP, ICE ou Reader.

## O que o repositório Keiyoushi realmente fornece

- [keiyoushi/extensions](https://github.com/keiyoushi/extensions) publica APKs/índices para Mihon e afins; **não executa** por si só requests ao MangaBall.
- [MangaBall.kt](https://github.com/keiyoushi/extensions-source/blob/main/src/all/mangaball/src/eu/kanade/tachiyomi/extension/all/mangaball/MangaBall.kt) define rotas e transformação de payloads, enquanto [Dto.kt](https://github.com/keiyoushi/extensions-source/blob/main/src/all/mangaball/src/eu/kanade/tachiyomi/extension/all/mangaball/Dto.kt) define schemas.
- [KeiSource.kt](https://github.com/keiyoushi/extensions-source/blob/main/core/src/main/kotlin/keiyoushi/source/KeiSource.kt) herda `network.client` do app Android, exige presença de `UserAgentInterceptor`, `CloudflareInterceptor` e `UncaughtExceptionInterceptor`, adiciona `Referer: https://mangaball.com/` e `Origin: https://mangaball.com`. A verificação da existência de um interceptor **não demonstra** que ele foi usado para resolver qualquer desafio.
- Os endpoints da fonte são `GET /api/v1/title/search-advanced`, `POST /api/v1/chapter/chapter-listing-by-title-id` e `GET /api/v1/chapter-detail`. A requisição POST usa bytes com **`Content-Type: application/json` exato**, pois a própria fonte relata HTTP 400 quando OkHttp acrescenta `charset=utf-8`. Esse problema já foi resolvido no [Host PR #167](https://github.com/jssantogit/tsuzuki/pull/167), com teste MockWebServer.
- O `KeiSource.imageRequest` repassa os cabeçalhos base para páginas; não basta enviar `Referer` sem barra ou omitir `Origin` no metadata de leitura.

## Ajustes na branch MangaAll

1. **User-Agent identificável** para requisições MangaBall, `Tsuzuki-MangaAll/0.1 (+https://github.com/jssantogit/providers-tsuzuki)`, em vez de depender do valor implícito do Host/runner. Não fingir ser Mihon/Chrome. Regressão RED na [CI #41034177962](https://github.com/jssantogit/providers-tsuzuki/actions/runs/41034177962).
2. **Pré-smoke distingue falhas de rede**, sem propagar URLs, IPs, cookies, certificados ou mensagens de exceção. Códigos conhecidos `ENOTFOUND/EAI_AGAIN` → `transport_dns`; `ERR_SSL_*/ERR_TLS_*` → `transport_tls`; `ECONNRESET/ECONNREFUSED` → `transport_connect`; `ETIMEDOUT/UND_ERR_CONNECT_TIMEOUT` → `transport_timeout`. Falhas HTTP permanecem `upstream_http_403`, `upstream_http_429` etc.; causas desconhecidas → `upstream_failed`. RED na [CI #41034337925](https://github.com/jssantogit/providers-tsuzuki/actions/runs/41034337925).
3. **Metadados de imagens MangaBall** refletem `Referer: https://mangaball.com/` e `Origin: https://mangaball.com` do `KeiSource.imageRequest`. RED na [CI #41034510856](https://github.com/jssantogit/providers-tsuzuki/actions/runs/41034510856).
4. [Provider CI #41034608671](https://github.com/jssantogit/providers-tsuzuki/actions/runs/41034608671) **SUCCESS** na revisão de código `b4e28ddd`, com fixtures de API, Reader, transporte e segurança. Os três adaptadores seguem `publication: development`, sem `reading.pages@1` declarado e sem grants adicionais.

## Evidência de que o 403 não equivale a falta de implementação

- O [primeiro preflight real](https://github.com/jssantogit/providers-tsuzuki/actions/runs/40902087863), num runner GitHub, recebeu HTTP 403 **já na primeira GET MangaBall**. Portanto, o `Content-Type` da futura POST não poderia explicar esse 403. Cabeçalhos ajustados ainda não foram validados num Android real.
- Em [keiyoushi/extensions-source issue #19839](https://github.com/keiyoushi/extensions-source/issues/19839), usuário relatou em 11/10/2026 que a API MangaBall respondia 200 no navegador, mas a extensão Mihon falhava com TLS/connection reset sem VPN. Contribuidor suspeitou da rede; **não houve demonstração de causa universal**. Logo, nem a extensão Keiyoushi possui acesso garantido em todas as redes.
- O Host do Tsuzuki já distingue famílias diagnósticas `DNS`, `TLS`, `CONNECT`, `READ_TIMEOUT` e `HTTP_STATUS` em `DefaultProviderHttpHostService` na PR #167. As novas famílias no preflight Node servem para comparações sem expor dados sensíveis; não substituem testes nativos.

## Segurança, autorização e aceite

As [regras públicas do MangaBall](https://mangaball.com/article/site-rule) proíbem bots/scraping automatizado sem aprovação explícita da API. **Não** automatizar desafios, importar cookies de outros apps, imitar browser/Mihon, alternar IP/VPN para evitar bloqueios nem executar probes repetidos como reação ao 403. Os ajustes desta auditoria são compatibilidade legítima de protocolo e fixtures offline.

Próxima validação, condicionada à autorização de uso: no Android, executar uma única coleta sanitizada por fonte, distinguir HTTP/TLS/DNS e confrontar `lookup → binding → chapters → ICE` com o mesmo título; validar Reader apenas após permissão de imagem/CDN e `reading.pages@1` seguro. Não publicar/mesclar nem gerar APK MangaAll com leitura prometida antes dessas provas.


## Política técnica — imagens, autorização e ativação (30/10/2026)

A [licença Apache 2.0 do Keiyoushi](https://github.com/keiyoushi/extensions-source/blob/main/README.md) permite estudar/adaptar código sujeito a avisos e condições da licença; **não concede ao Tsuzuki uma autorização de API**. O projeto Keiyoushi declara não possuir afiliação com as fontes. As [regras oficiais do MangaBall](https://mangaball.com/article/site-rule) exigem **aprovação explícita de API** para bots ou scraping automatizado e orientam contatar a moderação via Discord. Não foi demonstrado um contrato de autorização transferível do Keiyoushi ao Tsuzuki.

### Matriz fail-closed para o primeiro smoke

| Fonte | Origem/URL dos metadados de imagens | Grants atuais da fonte | Resultado offline / próxima exigência |
| --- | --- | --- | --- |
| MangaDex | `https://uploads.mangadex.org/data/…` ou `https://<node>.mangadex.network/<token>/data/…` | `api.mangadex.org`, `uploads.mangadex.org`, `*.mangadex.network` | URLs HTTPS/443 dentro do escopo validáveis pelo Host; **Reader ainda não ativado**, verificação física e política MangaDex pendentes |
| MangaBall | `https://mangaball.com/…` ou CDN observado em fixtures Keiyoushi, por exemplo `https://gengar.poke-black-and-white.net/storage/…` / `*.red-and-blue.net/storage/…` | **somente** `mangaball.com` | Primeira origem coberta, CDNs **não cobertos**; Host rejeita imagem externa. Não conceder wildcard amplo para produzir leitura artificialmente; exigir aprovação de API e evidência específica antes de grants de CDN |
| MangaDot | `https://mangadot.net/pages/…` em fixtures atuais | **somente** `mangadot.net` | URLs same-origin cabem no Host; novos CDNs exigiriam contrato e grants novos, não presumidos |

Regressão offline [`tooling/test_mangaall_image_origin_contract.mjs`](../tooling/test_mangaall_image_origin_contract.mjs) vinculada à Provider CI verifica origens exatas/wildcards/HTTPS/443, **prova que as CDNs MangaBall não têm grant**, e impede anúncio/exportação prematura de `reading.pages@1` nos três manifests. Esse teste reproduz a semântica de `ProviderOriginRule` para fixtures, **não é uma execução de imagem nem substitui testes nativos do Host**.

Gates restantes para liberação: autorização de acesso por fonte (MangaBall em particular); prova de URLs reais e escopo dos CDNs; Reader headers e página realmente renderizada no Samsung; evidências `lookup → chapters → ICE` com binding verificável; teste de regressão de progresso/capítulos; CI Release assinada in-place. Manter os três adaptadores `development` e a PR Draft até aceite.
