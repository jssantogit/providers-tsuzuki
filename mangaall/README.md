# MangaAll — agregador multifonte

MangaAll **não é MangaDex**. Seu papel é reunir adaptadores HTTP(S) que fornecem:

1. Observações verificáveis de capítulos para o **ICE**. A autoridade editorial
   continua no catálogo canônico do Tsuzuki; observações de um site permanecem
   `PROVIDER_PROVISIONAL` até reconciliação segura e nunca geram capítulos fictícios.
2. Fontes de **leitura** para o Reader, com `reading.pages@1` somente após
   páginas reais, permissões de rede e termos do serviço serem validados.

MangaDex, MangaBall e MangaDot constituem o conjunto mínimo do primeiro smoke
real, e fazem parte da mesma experiência MangaAll. Manga Livre.to, MangaFire,
AnimeXNovel e MangaFlix seguem no escopo de ampliação posterior. MangaFire
existente (`app.tsuzuki.mangafire`) não será alterado nesta frente.

## Estado técnico

- `mangaall/product.json`: identidade única do produto e matriz de fontes.
- `mangaall/index.js`: contrato de orquestração, com resultados por origem,
  falhas independentes e roteamento tipado de capítulos e páginas.
- `providers/mangaall-dex`, `mangaall-ball`, `mangaall-dot`: adaptadores
  SCRIPT isolados para testes Host V1; **detalhe técnico transitório**, não
  três produtos independentes para o usuário.

**A UX MangaAll com instalação única ainda não está implementada.** O Host V1
guarda apenas um vínculo de obra por provider/facet e aplica grants de rede
ao manifesto inteiro; não pode orquestrar essas fontes como um único provider
sem mudar o contrato Host ou criar um grupo coordenado. Não publicar o root
`app.tsuzuki.mangaall` como um alias de MangaDex nem reivindicar isolamento
de fontes sem enforcement do Host.

A implementação atual oferece somente `lookup` e `chapters` em fixtures;
`reading.pages` permanece pendente e não é anunciada pelos manifestos.
Nenhum smoke físico ou consulta upstream real ocorreu neste incremento.
