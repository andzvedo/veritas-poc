# Veritas Live: segurança, privacidade, retenção e revisões

Referência para LIVE-037 (falhas e limites), LIVE-038 (segurança, privacidade e retenção) e LIVE-040 (revisões, invalidação e auditoria). Este documento descreve o comportamento do código. Ele **não** substitui uma revisão de segurança independente.

## 1. Retenção (P0: somente memória)

| Item | Política |
|---|---|
| Armazenamento | `MEMORY_ONLY`. Nada é gravado em disco ou em banco de dados. |
| Reinício do processo | Todas as sessões se perdem. `RESUME_SESSION` responde "indisponível" (`durableAfterRestart: false`). |
| Sessão ociosa | Expira em 15 min (`DEFAULT_LIVE_SESSION_IDLE_MS`) se estiver desconectada, pausada, encerrada ou com erro. A expiração cancela a sessão e apaga as credenciais. |
| Duração máxima | 2 h por sessão (`DEFAULT_LIVE_MAX_SESSION_MS`). |
| Áudio | Não é persistido. Os buffers PCM existem apenas durante a janela de transcrição. Exportações e snapshots nunca incluem áudio. |
| Representações de voz | Não são persistidas nem exportadas. O registro de locutores guarda apenas rótulos (`speaker-1`) e os nomes informados pelo usuário. |
| Credenciais (Google/Tavily) | Ficam só na memória do pipeline. São apagadas em `END` (após o *drain*), `CANCEL`, `DELETE`, expiração e falha no início. Nunca entram em logs, exportações, snapshots ou mensagens de erro (`redactSecrets` / `redactSecretText`). |
| Histórico de revisões | Fica em memória com limites: até 20 tentativas por verificação, 2.000 registros de auditoria e 500 claims/verificações substituídas. O que passa do limite é descartado e contabilizado em `audit.truncated`. |
| Limites da instância | No máximo 32 sessões por instância e 2 por conexão. |

A política vigente é publicada em `SESSION_EXPORT.retention` (schema `LIVE_RETENTION_POLICY_SCHEMA`).

### Exclusão (`DELETE_SESSION`)
A exclusão cancela investigações e captura e apaga transcrição (segmentos e histórico), claims, verificações, versões substituídas, auditoria, contexto e credenciais. Em seguida, remove a sessão do registro.

### Exportação (`EXPORT_SESSION` → `SESSION_EXPORT`)
A exportação traz:
- segmentos com histórico de revisões;
- claims e verificações vigentes e substituídas;
- auditoria (tentativas automatizadas, invalidações, revisões humanas, correções tipográficas);
- `links`, que encadeiam **fala → claim → documento/trecho → conclusão** com `segmentRefs` e revisões.

`excludes: ['AUDIO', 'CREDENTIALS', 'VOICE_EMBEDDINGS']`. Os textos passam por redação de segredos, sem truncamento.

## 2. Risco residual no navegador
O frontend ainda guarda as chaves de API do usuário em `localStorage`, em texto claro. Essa é uma escolha do modo atual, sem contas de usuário. Qualquer script injetado na mesma origem consegue lê-las. Mitigações atuais: as chaves não são enviadas para terceiros além dos provedores e não aparecem em logs do backend. Recomendação P1: armazenar só na sessão (`sessionStorage`/memória) ou usar um proxy autenticado.

## 3. Transporte e autorização
- **CORS não é autenticação.** A lista de origens (`FRONTEND_URL`) só restringe navegadores. Qualquer cliente Socket.IO fora do navegador ignora essa regra.
- **Posse da sessão.** Todo comando exige que o socket seja o dono da sessão (`requireOwned`). Saber o `sessionId` não autoriza nada.
- **Token de retomada.** `START_LIVE_SESSION` emite um token aleatório de 256 bits, enviado **apenas** em `LIVE_SESSION_STARTED` ao dono. O backend guarda só o hash SHA-256 e compara em tempo constante. Outro socket só retoma a sessão se ela estiver em `RECONNECTING` **e** apresentar o token. A resposta é a mesma para sessão inexistente, expirada ou sem autorização. Hoje a interface (PR #6) prefere encerrar a captura quando a conexão cai. O token deixa a retomada segura disponível para quando o frontend a habilitar, e nunca deve ir para `localStorage`.
- **Limites por conexão** (token bucket): áudio com rajada de 64 e 32/s; controle (correção, revisão, exportação etc.) com rajada de 20 e 5/s; início/retomada com rajada de 5 e 1 a cada 6 s. Ao exceder o limite, o cliente recebe um aviso por segundo e o evento é descartado.
- **Tamanho de mensagem.** `maxHttpBufferSize` é de 512 KB. Cada chunk de áudio precisa ser binário PCM16, com tamanho par, não vazio e de até `maxChunkSamples` (160.000 amostras).
- **Validação de payload.** Todos os eventos passam por zod: IDs `^[A-Za-z0-9._:-]+$` com até 128 caracteres, correção com até 4.000 caracteres, nota de revisão com até 2.000 e até 32 mapeamentos de locutor. Payloads nulos ou malformados geram erro tratado e nunca derrubam o processo. As mensagens de erro para o usuário só repassam erros de domínio conhecidos. Os demais viram uma mensagem genérica, e o detalhe vai para o log sanitizado (`safeErrorForLog`).

## 4. Política de URLs (SSRF)
Pesquisa e extração aceitam só `http`/`https` públicos (`isSafeExternalUrl`). São recusados:
- URLs com credenciais;
- `localhost`, `*.local`, `*.internal`, `*.lan` e `*.home.arpa`;
- IPv4 privados, de loopback, link-local (inclui `169.254.169.254`), CGNAT e multicast;
- IPv6 de loopback, ULA e link-local;
- IPs decimais ou hexadecimais;
- URLs com mais de 2.048 caracteres.

**Risco residual:** não há resolução DNS no backend. Um domínio público que resolva para um IP interno (DNS rebinding) não é bloqueado aqui. A extração é feita pela Tavily, e não pelo nosso servidor, o que limita o impacto. Se um dia houver fetch direto, será preciso validar o IP resolvido.

## 5. Injeção de instruções
A transcrição e o contexto anterior entram no prompt de extração como **dados não confiáveis**. O prompt manda ignorar instruções embutidas na fala. Além disso, citações que não aparecem literalmente na transcrição são rejeitadas (PR #6). Documentos de fontes são tratados como evidência e nunca como instrução.

## 6. Revisões e invalidação (LIVE-040)
- **Correção com revisão desatualizada:** é rejeitada (`expectedRevision`) e nada é invalidado.
- **Correção de número, negação ou redação:**
  - as claims do segmento são substituídas e as investigações em curso, abortadas;
  - claims de outros segmentos que usaram o trecho como contexto são invalidadas (`CONTEXT_CHANGED`);
  - os dois grupos são reextraídos.
- **Correção puramente tipográfica** (caixa, espaços, pontuação fora de números): a revisão do segmento sobe e a mudança é auditada (`KEEP_RESULTS`), mas os resultados são mantidos. Separadores dentro de números (`1.000` × `1,000`) **não** são tipográficos.
- **Autoria:** atribuir ou trocar o nome de um locutor invalida as verificações dele (`SPEAKER_MAPPING_CHANGED`) e **reinvestiga as mesmas claims**, que não são descartadas. Confirmar o mesmo nome não invalida nada.
- **Resultado tardio:** só a tentativa vigente pode publicar. Uma resposta tardia de tentativa cancelada ou substituída é descartada (`DISCARDED_STALE` / métrica `late_result_discarded`) e nunca chega ao card.
- **Revisões monotônicas:** cada verificação tem um contador estritamente crescente. A invalidação recebe uma revisão maior que a do resultado anterior, e o novo resultado, maior que a da invalidação.
- **Reconexão:** o `SESSION_SNAPSHOT` inclui `invalidations` pendentes. O frontend transforma o card local antigo em "superado", com o motivo, e não ressuscita o veredito.
- **Revisão humana** (`SUBMIT_HUMAN_REVIEW`): fica registrada separadamente (`reviewType: 'HUMAN'`), sempre vinculada a uma revisão da verificação, e nunca altera o veredito automatizado (`reviewType: 'AUTOMATED'`). Uma revisão desatualizada é rejeitada.

## 7. Falhas (LIVE-037)
- Cota ou orçamento esgotado em LLM/pesquisa → `DEFERRED`, sem retentativa (repetir só gastaria mais).
- A falha de uma claim não bloqueia as outras, porque a fila tem concorrência e isolamento por job.
- `END` faz o *drain* da extração e da pesquisa já aceitas, depois finaliza a última frase aberta. `CANCEL` aborta tudo imediatamente.
- Chunks duplicados ou fora de ordem são confirmados sem duplicar a transcrição.
