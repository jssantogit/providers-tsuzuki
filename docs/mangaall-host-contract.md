# MangaAll — produto multifonte, ICE e Reader

**Estado: protótipo na [PR #47](https://github.com/jssantogit/providers-tsuzuki/pull/47), sem distribuição assinada ou smoke físico.**

## Contrato do produto (corrigido em 29/10/2026)

**MangaAll não é MangaDex.** `app.tsuzuki.mangaall` é a identidade do produto
agregador e não pode anunciar apenas o MangaDex. MangaDex é uma fonte interna,
assim como MangaBall e MangaDot, que precisam funcionar juntas no primeiro smoke.
As outras quatro fontes iniciais planejadas são Manga Livre.to, MangaFire,
AnimeXNovel e MangaFlix; MANGA Plus permanece candidato adicional.

O MangaAll tem **duas capacidades obrigatórias**:
1. **Capítulos canônicos:** descobrir obras/chapters/variants com números, idiomas,
   grupos, data e identidade verificáveis e oferecer observações
   `PROVIDER_PROVISIONAL` ao ICE. O ICE continua a única autoridade para
   reconciliação de capítulo e edição; não gerar 1..N nem afirmar vínculo
   só por título, número ou disponibilidade de páginas.
2. **Leitura:** selecionar a origem correta para o capítulo, resolver imagens
   reais por `reading.pages@1` com grants e termos apropriados, e fornecer
   recursos ao Reader mantendo identidade canônica e progresso independentes.

Uma fonte pode oferecer capítulos sem páginas durante desenvolvimento, mas
isso **não é aceite de leitura nem conclusão do MangaAll**.

## Implementação atual

| Camada | Identidade | Responsabilidade | Estado |
| --- | --- | --- | --- |
| Produto | `app.tsuzuki.mangaall` em `mangaall/product.json` | MangaAll, seleção de fontes e UX de instalação única | Contrato, sem Host integrado |
| Adapter MangaDex | `app.tsuzuki.mangaall.mangadex` | Discovery e capítulos `en/pt-br`, páginas via MangaDex@Home | Prototipado, não publicado |
| Adapter MangaBall | `app.tsuzuki.mangaall.mangaball` | Discovery, chapters e URLs de páginas por API | Prototipado, não publicado |
| Adapter MangaDot | `app.tsuzuki.mangaall.mangadot` | Discovery, chapters com origem upload/chapter e imagens | Prototipado, não publicado |

`mangaall/index.js` é um contrato de agregação **não executável diretamente
pelo SCRIPT Host V1**. Já implementa resultados por origem, falha independente,
rotas explícitas de `chapters` e `pages`, rejeição de workId/chapterId sem a
fonte correta. Não deve ser embalado como se fosse um provider MangaDex.

## Por que há unidades de execução com IDs internos distintos?

O Host V1 armazena um binding por `(canonicalTitleId, providerId, facetId)`,
não por source interno. Se três sites com o mesmo título retornarem candidatos
na mesma facet de um único `providerId`, o motor considera ambiguidade e não
materializa um vínculo confiável. Além disso, `manifest.permissions.network.origins`
autoriza todo o provider, sem revogação segura por adaptador JS.

Os adaptadores isolados são **compatibilidade transitória** com o Host atual,
não autorização para mostrar três cards finais nem para pedir novo cadastro de
repositórios. A integração necessária no aplicativo está registrada na
[issue #166 do Tsuzuki](https://github.com/jssantogit/tsuzuki/issues/166):
uma experiência/instalação MangaAll com subfontes isoladas por grants,
proveniência e diagnóstico, com transição segura de bindings, Reader e backup.

## Reader: trabalho ainda não liberado

Os módulos das três fontes têm funções `pages()` internas e testes de fixtures
com IDs por origem, HTTPS e origens de imagens restritas. **Nenhum manifesto
anuncia `reading.pages@1`** e nenhum Reader Android foi validado. Isso evita
prometer leitura quando o MangaDex@Home devolve CDN dinâmico, MangaBall devolve
CDNs terceiros ou MangaDot devolve URLs que precisam de revisão. Expandir grants
somente após confirmar domínios, redirects, direitos e atribuição.

O MangaDex exige crédito à fonte e aos grupos, remoção de conteúdo mediante
pedido de grupos e proíbe monetização/publicidade em apps que usam a API:
https://gitlab.com/mangadex-pub/mangadex-api-docs/-/blob/main/index.md

## Gates da primeira validação real

- Confirmar chamadas ao vivo das **três fontes**, payloads reais, limites de uso,
  idiomas e aliases, sem depender do MangaFire existente.
- Host único MangaAll instalado/gerenciado pelo repositório assinado
  existente, com subfontes opt-in, grants específicos e sem perda de progresso.
- `lookup → binding → chapters → ICE` para MangaDex, MangaBall e MangaDot,
  com evidências por fonte, edição e idioma; rejeitar resultados ambíguos.
- `reading.pages@1 → Reader` para os mesmos três, com páginas realmente
  renderizadas e permissão dos hosts de imagem. Se uma fonte falhar, registrar
  bloqueio sem afirmar que a capacidade está pronta.
- TDD+CI, Android instrumentado e **smoke físico in-place** no Galaxy A54
  com APK Release `app.tsuzuki` e mesma assinatura/banco.
- Não modificar `app.tsuzuki.mangafire`, `dist/index.json`,
  `repository/config.json`, grants nem assinatura antes de aceite.
