# llm-video-maker (fork)

Fork de [GoldLegendW80/llm-video-maker](https://github.com/GoldLegendW80/llm-video-maker), de
Harald Thorvald Hautin, mantido por [mattheusbr](https://github.com/mattheusbr) para uso no
projeto [motion-ia](https://github.com/mattheusbr/motion-ia).

Duas skills de agente (Claude Code e similares) que transformam um brief em vídeo MP4: roteiro,
design, storyboard, assets, composição em HTML/GSAP, validação e render com o motor
[HyperFrames](https://www.npmjs.com/package/hyperframes).

## O que este fork muda em relação ao original

- Removidos `media/` e `examples/` (cerca de 19 MB cada, vídeos de demonstração do autor original) e
  os trechos do README que dependiam deles. Ficou só o que o pipeline usa: as skills.
- README reescrito em português.

Estado atual: as **skills em `skills/` ainda são as do upstream, sem alterações**. As adaptações
feitas no motion-ia (narração e legendas em pt-BR com Kokoro e faster-whisper, validação em uma
passada com `check.mjs`, SFX em duas camadas, regras de economia de tokens) vivem hoje em
`.claude/skills/` daquele projeto e serão trazidas para este fork aos poucos.

Para acompanhar o original:

```bash
git remote add upstream https://github.com/GoldLegendW80/llm-video-maker
git fetch upstream
```

## Conteúdo

```
skills/make-video/   /make-video: brief → pesquisa → design → storyboard → assets → composição → validação → MP4 + relatório
skills/edit-video/   /edit-video: refaz só um capítulo de um vídeo já gerado
LICENSE              MIT, copyright do autor original
```

Formato do brief: [`skills/make-video/schema.json`](skills/make-video/schema.json). Campos
obrigatórios: `id`, `platform`, `story` e `source`; o restante (voz, legendas, música, estilo) é
opcional.

## Uso

```bash
npx skills add mattheusbr/llm-video-maker
```

Depois, no agente:

```
/make-video briefs/meu-video.json
/edit-video <id> <capítulo> "instrução"
```

A saída fica em `projects/<id>/` (MP4 e todos os arquivos intermediários, o que permite retomar
uma execução interrompida).

## Requisitos

Node 22 ou superior, FFmpeg e Google Chrome. A skill confere tudo com
`npx hyperframes@0.6.91 doctor` e para cedo se faltar algo. Chaves opcionais de API
(`PEXELS_API_KEY`, `PIXABAY_API_KEY`, `GIPHY_API_KEY`, `TENOR_API_KEY`, `FREESOUND_API_KEY`,
`OPENAI_API_KEY`) liberam mídia real; sem elas, o pipeline usa ícones e logos embutidos e
placeholders.

## Licença e atribuição

Este repositório é um fork de um projeto sob a **licença MIT**. O arquivo [LICENSE](LICENSE) é o
original e foi mantido sem alterações, com o aviso de copyright de Harald Thorvald Hautin, como a
licença exige. As modificações feitas neste fork também são distribuídas sob a licença MIT.

Dependências e componentes de terceiros mantêm as próprias licenças: HyperFrames, Kokoro-82M,
Iconify e simple-icons, entre outros. Os assets baixados pelo pipeline trazem um arquivo
`.credit.json` com fonte e licença.

## Uso responsável

Você é responsável pelas afirmações, marcas e avisos legais do que gerar (por exemplo, anúncios de
apostas ou finanças exigem avisos de idade e risco conforme a jurisdição). O pipeline ancora os
fatos na tela e registra a licença de cada asset, mas a liberação de direitos e a conformidade são
suas.
