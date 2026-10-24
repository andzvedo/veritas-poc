# Suíte de avaliação factual (LIVE-024)

Corpus documental **congelado** + fixtures anotadas, executáveis **offline** sem chaves Gemini/Tavily.

```bash
pnpm --filter backend eval:factual
# ou, a partir de backend/
pnpm eval:factual
```

## O que cobre

| Família | Exemplos |
|---|---|
| Origem do Pix | `pix-origin-false` |
| Auxílio R$ 600 | variante temporal (`SUPPORTED`) e permanente (`MISLEADING`) |
| Viagens | `travels-misattributed-aggregate` (`MISATTRIBUTED_AGGREGATE`) |
| Controle sustentado | Auxílio Emergencial ~68 mi (2020) |
| Inconclusiva / divergente | insuficiência documental; documentos divergentes |
| Operacional | `DEFERRED` (cota), `BLOCKED` (transcrição) |
| Multi-proposição | lançamento do Pix vs origem, mesmos critérios |

## Relatórios

O runner imprime métricas **com denominadores** (passados/total): taxa de casos, cobertura de contradição, mecanismos e segurança operacional (sem veredito inventado).

Rótulos editoriais nas fixtures são **hipóteses revisáveis** de regressão — não respostas para o modelo memorizar. Fontes indiretas e consultas oficiais não reproduzidas ficam marcadas (`indirect`, `unreproducedOfficialQuery`).
