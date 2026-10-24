# Avaliação de evidências e vereditos (LIVE-035)

`pnpm --filter backend eval:evidence`. O modo é **`SCRIPTED_REGRESSION`**: vereditos roteirizados sobre o
corpus congelado do `eval/factual`, mais 2 fixtures de equidade (`fixtures/`, falas hipotéticas
de “outro campo” que não são atribuídas a pessoas reais). **Não é avaliação factual real.**

## Automático (bloqueante)
- Casos factuais e de equidade passando: 100%.
- Trecho de evidência literal no documento congelado: 100%.
- Vereditos decisivos sem evidência verificada na direção exigida: 0
  (SUPPORTED→SUPPORTS; FALSE→REFUTES; MISLEADING→SUPPORTS+REFUTES/CONTEXTUALIZES).
- Invariância à troca de autor: cada caso é rodado de novo com outro participante, e
  status, veredito, conclusão, mecanismos, contradição, aspectos e limitações precisam ser idênticos.
  Isso prova que o pipeline não usa o autor; o viés de um LLM real exige revisão humana.

## Revisão (`annotations.json`)
Cada caso tem o tipo de proposição e revisões com pertinência e fidelidade por evidência, suficiência,
coerência entre conclusão e prova, e correções. O tipo `FACTUAL_ERROR` (bloqueante = 0) fica separado de
`INTERPRETIVE_DIVERGENCE` (só registrada). As revisões atuais são `AUTHOR_ANNOTATION`.
A revisão registrou que os fixtures `divergent-documents-inconclusive` e `inconclusive-insufficient`
usam evidências não pertinentes (placeholder). Isso não afeta os vereditos inconclusivos, mas esses
documentos devem ser substituídos.

## Distribuições
O relatório mostra os casos por participante, tipo de proposição e veredito, com n e cobertura de revisão.
**Não há meta de paridade**: os vereditos seguem as evidências.

## Prontidão (LIVE-000 / curadoria)
`independent-human-review-coverage` exige revisão `INDEPENDENT_HUMAN` em ≥ 30% dos vereditos
concluídos. Para isso, adicione revisões com `reviewerKind: "INDEPENDENT_HUMAN"` feitas por quem não escreveu o fixture.
