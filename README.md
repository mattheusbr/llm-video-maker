# llm-video-maker (fork)

Fork de [GoldLegendW80/llm-video-maker](https://github.com/GoldLegendW80/llm-video-maker), de
Harald Thorvald Hautin, mantido por [mattheusbr](https://github.com/mattheusbr) para uso no
projeto [motion-ia](https://github.com/mattheusbr/motion-ia).

Duas skills de agente (Claude Code e similares) que transformam um brief em vídeo MP4: roteiro,
design, storyboard, assets, composição em HTML/GSAP, validação e render com o motor
[HyperFrames](https://www.npmjs.com/package/hyperframes).

## O que este fork muda em relação ao original

- **Enxugado:** removidos `media/` e `examples/` (cerca de 19 MB cada, vídeos de demonstração do autor original).
- **Narração e legendas em pt-BR, locais:** `tts_pt.py` (Kokoro-82M, voz `pf_dora` por padrão) e
  `captions_pt.py` (faster-whisper `base` multilíngue, palavra a palavra, áudio decodificado pelo FFmpeg).
  O motor de voz do schema é só `kokoro`.
- **Validação em uma passada:** `check.mjs` roda lint, validate (console e contraste) e inspect e imprime um
  relatório compacto.
- **Economia de tokens:** `make-video/SKILL.md` reescrito (de 28 KB para cerca de 15 KB) com regras de trabalho
  (sem worktree, sem reescrever arquivos, um passe de validação), `design/design.md` fixo opcional e
  no máximo uma cena a cada 5 s.
- **SFX em duas camadas:** biblioteca embutida da skill `media-use` (padrão, sem chave) e Freesound CC0 para sons
  específicos, escolhendo o resultado por nota e downloads. Campo `sfx` no schema.
- **Correções de revisão de código:**
  - a chave de API deixa de aparecer em mensagens de erro;
  - URLs do manifesto só aceitam http(s) e recusam endereços locais e privados (`capture` aceita `localhost`);
  - download com limite de tamanho em streaming;
  - orientação de imagem mapeada por provedor (Pixabay e Pexels);
  - `plan-scenes --check` passa a reportar cenas sem `segmentIds` ou sem tempo válido;
  - o validador não quebra com `chapters` inválido e rejeita `image_gen` não implementado;
  - `analyze-codebase` ignora badges do README e lê só o commit raiz;
  - `capture-demo` não deixa a pasta temporária para trás em caso de falha.
- README reescrito em português.

Para acompanhar o original:

```bash
git remote add upstream https://github.com/GoldLegendW80/llm-video-maker
git fetch upstream
```

## Conteúdo

```
skills/make-video/   /make-video: brief → design → storyboard → assets → composição → validação → MP4 + relatório (scripts: tts_pt, captions_pt, check, fetch-assets…)
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
