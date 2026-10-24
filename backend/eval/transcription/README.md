# Avaliação de transcrição (LIVE-033)

`pnpm --filter backend eval:transcription` roda **offline**, sem chaves e sem GPU.

## O que mede (denominadores explícitos, só no corpus)

| Métrica | Denominador | Gate |
|---|---|---|
| WER | palavras da referência | ≤ 15% (mín. 50), bloqueante |
| CER | caracteres da referência | ≤ 10% (mín. 200), bloqueante |
| Erros críticos (nomes, números, datas, %, unidades, negação) | ocorrências anotadas | ≤ 10% (mín. 20), bloqueante |
| Negação perdida/inserida | ocorrências de “não” (+1 slot por guarda de inserção) | = 0 (mín. 3), bloqueante |
| Números/datas/%/unidades | ocorrências numéricas | ≤ 5% (mín. 10), bloqueante |
| Nomes próprios | ocorrências | ≤ 25% (mín. 5), bloqueante |
| Janelas dentro do tempo real | janelas | ≥ 95%, bloqueante |
| Latência por janela ≤ 5 s | janelas | ≥ 90%, bloqueante |
| Mídia real gravada | 30 min exigidos | ≥ 100%, **prontidão** (não falha o CI) |

Os resultados são separados por condição: `CLEAN`, `NOISE`, `INTERRUPTION`, `OVERLAP`.
Fixtures `CONTROL` não entram nos gates; elas provam que os gates reprovam negação
perdida/inserida, percentual trocado e janela mais lenta que o tempo real.

## Limites atuais (honestidade)

As hipóteses dos fixtures são `SIMULATED`: elas validam o harness e as métricas, **não**
a qualidade do whisper.cpp. Por isso o relatório sai com `Modelo pronto: NÃO` até existir
mídia real gravada (LIVE-000).

## Validação em máquina real (LIVE-000)

1. Grave ou recorte o áudio de cada fixture (`media.reference`, `offsetMs`, `durationMs`) em WAV mono de 16 kHz.
2. Rode o whisper.cpp com saída JSON:
   `whisper-cli -m models/ggml-<modelo>.bin -l pt -oj -of out/<fixture-id> audio/<fixture-id>.wav`
3. Crie `out/<fixture-id>.meta.json`:
   `{"model": "ggml-small", "hardware": "MacBook M2 16GB", "processingMs": 2100, "mediaKind": "REAL_DEBATE"}`
   (o arquivo é obrigatório porque modelo e hardware fazem parte do resultado).
4. `pnpm --filter backend eval:transcription -- --hypotheses out/`

Registre no PR o modelo, o hardware, o RTF e as limitações observadas. Para fechar o gate
de prontidão, inclua 30 min ou mais de debate real anotado.
