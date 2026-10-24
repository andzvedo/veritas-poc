# Avaliação de falantes e claims (LIVE-034 / LIVE-015)

`pnpm --filter backend eval:speakers` roda **offline**. Usa `SpeakerRegistry`, `ContextManager`,
`extractClaims` (FakeChatModel com saídas roteirizadas, sujeitas à checagem de citação literal),
`findDuplicate` e a mesma regra de atribuição do `LiveSession` (fala simultânea vira autoria desconhecida).

## Grupos de métricas (separados de propósito)

- **Diarização**: erro entre as janelas atribuídas; acurácia incluindo o desconhecido (o
  fallback desconhecido **não** conta como acerto); sobreposição que permanece desconhecida.
- **Associação**: mapeamentos confirmados corretos versus não confirmados.
- **Extração**: precisão, recall, triagem do que não é verificável, incompletas não investigadas e fidelidade literal.
- **Duplicatas**: repetições investigadas de novo, reusos indevidos (“não”, números e unidades) e o
  mesmo fato dito por outro autor com ocorrência própria.
- **Contexto e autoria**: perda de contexto, vazamento de autoria, desconhecido exibido com nome,
  claims invalidadas após correção e falsos alarmes.

Os gates bloqueantes ficam em `SPEAKER_CLAIM_GATES`. Os gates de prontidão
`automatic-authorship-*` (mínimo de 200 janelas, acurácia ≥ 90% e erro de voz ≤ 5%) são calculados
**apenas** em fixtures `REAL_DEBATE` com diarização `RECORDED`.

## Limites

Os fixtures são texto com rótulos de diarização roteirizados. Eles medem as regras do pipeline,
**não** a qualidade do pyannote. A conclusão atual é: autoria automática **não pronta**.

## Validação em máquina real (LIVE-000)

1. Rode o pyannote no áudio real e salve, para cada segmento, os rótulos e as confianças em `observations`.
2. Marque `diarizationProvenance: "RECORDED"` e `media.kind: "REAL_DEBATE"`, e anote `refSpeaker` manualmente.
3. Opcionalmente, grave as saídas reais do extrator em `extraction` (`extractionProvenance: "RECORDED"`).
4. Rode `eval:speakers`. Os gates de prontidão só passam com amostra suficiente.
