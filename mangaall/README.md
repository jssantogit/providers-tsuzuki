# MangaAll — um provider, várias fontes de conteúdo

**Identidade única:** `app.tsuzuki.mangaall`. O usuário instala, habilita e gerencia somente o MangaAll. MangaDex, MangaDot e MangaFire são **fontes internas** de conteúdo, não produtos ou providers que o usuário precise instalar separadamente.

## Implementação nesta PR

- `providers/mangaall/manifest.json` e `main.js`: **um único pacote SCRIPT** (em desenvolvimento, ainda não assinado/publicado), com `reading.lookup@1`, `reading.chapters@1` e `reading.pages@1`.
- `providers/mangaall/modules/router.js`: consulta as fontes, preserva `source:externalWorkId` e `source:providerChapterId`, valida proveniência antes de encaminhar chapters/pages e mantém cursores paginados sem misturar identidades.
- `providers/mangaall/modules/sources/`: módulos verificados de MangaDex, MangaDot e MangaFire, copiados na mesma árvore do pacote para não depender de um provider externo instalado.
- **Reader:** páginas reais implementadas pelo MangaFire; MangaDex/MangaDot continuam somente descoberta e capítulos até revisão de permissões/atribuição, imagens reais e smoke físico. O MangaAll não inventa páginas.
- **MangaBall:** pausado até autorização legítima da API. Manga Livre.to, AnimeXNovel e MangaFlix permanecem planejados.

As permissões de rede do manifesto único correspondem à união mínima das origens necessárias às fontes ativas. O Host V1 autoriza origens no nível do provider, **não** no de cada fonte: isolamento de operação e identidade é feito pelo roteador e pelos módulos, mas grants/revogação por fonte exigem contrato Host adicional antes de serem anunciados como segurança forte.

## Compatibilidade e migração

Os pacotes antigos `app.tsuzuki.mangafire`, `app.tsuzuki.mangaall.mangadex` e `app.tsuzuki.mangaall.mangadot` permanecem publicados no índice atual por compatibilidade. **Eles não são pré-requisito do novo MangaAll.** Não desinstalar, substituir ou desabilitar automaticamente providers anteriores antes de uma estratégia de migração de bindings/progresso verificada.

`mangaall/index.js` é o protótipo anterior de orquestração e mantém testes históricos; a implementação publicável é `providers/mangaall`. Não considerar agrupamento de cards do Host PR #194 suficiente para atingir a arquitetura de provider único.

## Gates

1. CI do repositório + empacotamento e contrato Host V1.
2. Validação de discovery/chapters/pages reais no Host e correção da experiência de instalação única, sem duplicação visível no Reader.
3. APK Release assinada atualizável e smoke físico no aparelho.
4. Publicação assinada somente após essas verificações. A flag `publication=development` impede a inclusão prematura no índice.
