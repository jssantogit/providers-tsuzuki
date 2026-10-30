# MangaAll live preflight — manual and restricted

`node tooling/mangaall_live_probe.mjs --live` runs a **manual-only**
three-source check using public HTTPS APIs: MangaDex, MangaBall and MangaDot.
It is NOT part of standard CI and does not automatically bypass Cloudflare or
capture credentials. It intentionally uses one known work ("Haikyuu!!") and
makes at most eight requests per source, sequentially, no automatic retries.

The probe reports only sanitized per-source outcomes:
- no safe exact match, ambiguous, no chapters, upstream failure,
- number of chapter observations and count of **page metadata**,
- whether every page URL is covered by the source's **current manifest** grants.

It never displays external IDs, URLs, titles, page bodies, image URLs or tokens.
It does not fetch images. Even `observed` **does not prove actual reading**;
a physical Android smoke must still confirm image delivery, ICE reconciliation
and reader progress. A `pagesInsideGrantedOrigins:false` response
explains why `reading.pages@1` remains disabled in these prototypes.

No HTTP redirect is followed. Host grants are enforced per source, and the
probe never contacts external image CDNs. A 403/429 is a failure status, not
an invitation to circumvent the site.

Upstream availability, request policies and attribution must be verified
before running this probe and before signed publication.

## Segurança do diagnóstico — correção de 29/10/2026

Na [PR #47](https://github.com/jssantogit/providers-tsuzuki/pull/47), o
pré-smoke agora reconhece `https://*.mangadex.network` conforme o grant
HTTPS do Host: subdomínios legítimos na porta padrão são aceitos como
**metadados dentro dos grants existentes**; domínio raiz, host parecido,
credenciais e portas não padrão são rejeitados. Isso corrige um falso
negativo do relatório, **sem conceder novas permissões** e sem baixar imagens.

A escolha de até três capítulos do primeiro lote passou de "os três
primeiros" para "primeiro, central e último". Isso encontra capítulos
internos que podem estar depois de capítulos externos e mantém o limite
de 8 HTTP requests por fonte. Se só forem encontrados capítulos externos,
o resultado descreve **a amostra**, não a disponibilidade de leitura da
obra inteira. Os testes foram reproduzidos RED na
[CI #40970659592](https://github.com/jssantogit/providers-tsuzuki/actions/runs/40970659592)
e na [CI #40970737112](https://github.com/jssantogit/providers-tsuzuki/actions/runs/40970737112),
antes do [GREEN #40970807663](https://github.com/jssantogit/providers-tsuzuki/actions/runs/40970807663)
na revisão `948643f4`.

Nada disso comprova acesso HTTP real no Galaxy A54, remove o 403 do
runner ou autoriza `reading.pages@1`. Os três adaptadores permanecem
`publication: development` e sem distribuição assinada.

## Primeiro preflight real — 2026-10-29

Execução única e deliberadamente limitada, no **GitHub-hosted Ubuntu runner**:

| Fonte | Resultado | Interpretação segura |
| --- | --- | --- |
| MangaDex | 4 requisições, primeiro resultado `upstream_failed` | Reclassificado por inspeção posterior como `phase=pages`, `invalid_page_metadata`; 5 capítulos evidenciados no primeiro lote |
| MangaBall | HTTP 403 na primeira requisição | Bloqueio deste ambiente; não prova indisponibilidade global nem problema no Android |
| MangaDot | HTTP 403 na primeira requisição | Bloqueio deste ambiente; não prova indisponibilidade global nem problema no Android |

Traces preservados:
- [Três fontes #40902087863](https://github.com/jssantogit/providers-tsuzuki/actions/runs/40902087863)
- [Estágio MangaDex #40902575241](https://github.com/jssantogit/providers-tsuzuki/actions/runs/40902575241)
- [Formato anonimizado de dois capítulos #40902791104](https://github.com/jssantogit/providers-tsuzuki/actions/runs/40902791104)

A inspeção da estrutura de **dois** registros do MangaDex verificou
`externalUrl` presente e arrays `chapter.data=[]` e `chapter.dataSaver=[]`,
com `chapter.hash` vazio. A ausência de páginas é legítima para lançamentos
externos: esses capítulos podem alimentar **evidências do ICE**, mas o MangaDex
não fornece conteúdo interno ao Reader. O protótipo passou a identificar
`external_chapter` antes de chamar MangaDex@Home. Não inventar imagens nem
abrir a URL externa como se fosse um recurso sob as permissões do MangaDex.

A saída do probe não inclui URLs, cookies, identificadores nem conteúdo de
imagens. Os probes não seguem redirects, não contornam 403/429 e não executam
autenticação. Os workflows de disparo único foram removidos da branch após
os testes. O comando manual `--live` permanece disponível, mas **não deve ser
executado de forma recorrente ou usado para driblar bloqueios**.

**Critério do primeiro smoke não atendido:** nenhuma das três fontes teve
páginas efetivamente carregadas no Reader do Tsuzuki. Para testar MangaDex,
selecionar um capítulo permitido com páginas internas e confirmar os grants
dinâmicos de imagens, atribuição e política de uso. Para MangaBall/MangaDot,
confirmar o acesso normal ao serviço no dispositivo, sem bypass de proteções,
antes de anunciar `reading.pages@1`.

A API MangaDex exige identificação honesta do cliente via `User-Agent`,
crédito à fonte e aos grupos e respeito aos pedidos de remoção:
https://gitlab.com/mangadex-pub/mangadex-api-docs/-/blob/main/index.md
