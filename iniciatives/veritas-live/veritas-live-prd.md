# PRD — Veritas Live

**Real-time Audio Fact Checking**

- **Versão:** 1.2
- **Data:** 23/10/2026
- **Status:** Implementação parcial no código; piloto/MVP ainda não validados
- **Repositório:** https://github.com/andzvedo/veritas-poc

---

## 1. Visão do produto

Evoluir o Veritas de um verificador de textos para uma plataforma capaz de **capturar, transcrever e verificar automaticamente afirmações feitas em transmissões ao vivo**.

O produto deve identificar quem fez cada afirmação, confrontá-la com evidências verificáveis e explicar claramente eventuais contradições, omissões e distorções.

**Princípio central:** não apenas classificar uma afirmação como verdadeira ou falsa, mas demonstrar o que as evidências comprovam, onde existe contradição e como o contexto altera sua interpretação.

## 2. Objetivo do MVP

**Documentos normativos:** [Especificação de verificações v1.1](veritas-live-especificacao-de-verificacoes.md) e [Plano técnico v1.1](veritas-live-iniciativas-e-tarefas.md). A versão vigente é a do cabeçalho. Há código parcial para captura, sessão, transcrição, extração, pesquisa e cards; isso não significa que o percurso esteja liberado nem que os gates de qualidade tenham sido cumpridos. Consulte o plano técnico para o estado e as evidências de cada tarefa.

### 2.1 Piloto experimental e MVP completo

| Capacidade | Piloto local experimental | MVP completo |
|---|---|---|
| Captura | Uma aba, navegador/sistema/player qualificados | Mesma combinação documentada, com tratamento de falhas |
| Transcrição e extração | Automáticas; trechos críticos incertos ficam bloqueados | Automáticas, avaliadas em corpus e ensaio prolongado |
| Autoria | Pode permanecer desconhecida; associação manual explícita | Diarização com continuidade de IDs e associação inicial confirmada; dúvidas sinalizadas |
| Pesquisa e resultado | Motor documental compartilhado com Texto | Mesmo motor, com qualidade e capacidade mensuradas |
| Sessão/revisões | Memória limitada; exportação e recuperação de conexão na mesma instância | Mesmo limite declarado; histórico durável é P1 |
| Mobile/histórico durável | Adiados | P1, sem bloquear aceite do MVP desktop |

O piloto não satisfaz o objetivo de autoria automática enquanto depender de atribuição manual de cada fala ou mantiver todas as vozes desconhecidas. Reconhecer vozes é diferente de descobrir os nomes dos candidatos: no MVP, os nomes podem ser associados uma vez pelo usuário durante a preparação.

O uso no debate de 23/10/2026 é uma oportunidade de piloto, **não um prazo que dispense validação**. Sem os gates de captura, evidências, segurança e ensaio, a entrega permanece experimental ou indisponível, com o bloqueio informado.

### 2.2 Jornada-alvo

Permitir que o usuário:

1. Acesse o Veritas e escolha **Áudio ao vivo**.
2. Clique em **Iniciar escuta**.
3. Selecione uma aba do navegador e autorize a captura de áudio.
4. Acompanhe a transcrição e as verificações automaticamente.
5. Explore as evidências relacionadas a cada afirmação.

Após a autorização inicial e, no MVP completo, a confirmação inicial da associação voz → participante, nenhuma interação adicional deve ser necessária para processar o áudio, salvo para resolver erros ou ambiguidades. A captura não pode ser reiniciada automaticamente quando o navegador exigir nova permissão.

**Restrição financeira:** priorizar soluções open-source, processamento local e cotas gratuitas de serviços externos, sem obrigatoriedade de assinatura paga.

## 3. Escopo funcional

| Funcionalidade | Prioridade |
|---|---|
| Preservar verificação manual por texto | P0 |
| Capturar áudio de aba do navegador | P0 |
| Transcrever áudio continuamente | P0 |
| Detectar afirmações verificáveis | P0 |
| Evitar claims duplicadas | P0 |
| Investigar claims automaticamente | P0 |
| Produzir vereditos documentados; contradição e mecanismo apenas quando aplicáveis | P0 |
| Revisões, invalidação de resultados e exportação da sessão atual | P0 |
| Exibir resultados progressivamente | P0 |
| Iniciar, pausar e encerrar sessões | P0 |
| Diarização com IDs contínuos e associação inicial aos participantes | P0 no MVP; piloto admite autoria desconhecida |
| Descoberta automática dos nomes sem confirmação inicial | P1 |
| Persistir sessões e verificações | P1 |
| Acompanhar sessões pelo celular | P1 |
| Captura nativa de áudio no mobile | Futuro |

### Fora do escopo inicial

- Retransmissão de áudio ou vídeo.
- Captura não autorizada de streams.
- Aplicativos nativos iOS e Android.
- Publicação automática de acusações sem evidências suficientes.
- Garantia de verificação instantânea.
- Garantia de funcionamento contínuo sem internet quando a pesquisa depender de serviços externos.

## 4. Jornada do usuário

### Entrada

O usuário escolhe entre **Texto** e **Áudio ao vivo**.

O modo Texto mantém a experiência atual.

### Iniciar escuta

1. O usuário clica em *Iniciar escuta*.
2. O navegador solicita a escolha da aba.
3. O usuário autoriza o compartilhamento de áudio.
4. O Veritas valida a captura.
5. A transcrição começa automaticamente.

### Processamento

O sistema detecta falas, extrai claims e executa pesquisas em paralelo, preservando o contexto.

### Resultados

Desktop: transcrição e verificações lado a lado. Resultados são agrupados pela fala original, com veredito por afirmação atômica. A primeira camada mostra a conclusão; a segunda explica o confronto; a terceira abre documentos, trechos, métodos, datas e limitações.

A interface mostra captura, transcrição e pesquisa separadamente, incluindo atraso, fila, saturação e consumo. Autoria desconhecida, falha técnica e falta de evidência têm apresentações distintas.

Mobile responsivo e acompanhamento em outro dispositivo são P1. O protótipo HTML é referência de apresentação, com dados simulados; opções de microfone não representam funcionalidade do piloto nem fonte autorizada pelo escopo.

## 5. Arquitetura técnica

**Pipeline**

Captura → blocos PCM com relógio de amostras → duas entradas independentes:

- Áudio → transcrição incremental → segmentos finalizados e versionados.
- Áudio → diarização → intervalos de locutor com IDs contínuos.

Alinhamento por timestamps → contexto com autoria preservada → triagem e afirmações atômicas → fila limitada → plano de prova → busca e inspeção de documentos → avaliação → veredito validado → UI em três camadas.

Texto manual → entrada imutável → mesma extração e mesmo motor de evidências. A diarização não pode depender apenas do texto ou da ordem de alternância dos candidatos.

A transcrição deve operar independentemente das pesquisas.

### Tecnologias propostas

| Camada | Tecnologia |
|---|---|
| Frontend | Next.js 15, React 19 |
| Captura | `getDisplayMedia` com vídeo exigido pela API, áudio validado, sem envio de vídeo |
| Transcrição | Adaptador Whisper.cpp local, sujeito à qualificação de hardware/modelo |
| Detecção de voz | VAD local |
| Identificação de participantes | Adaptador acústico local, continuidade entre blocos e associação inicial confirmada |
| Extração | Gemini Flash |
| Pesquisa | Tavily como primeiro adaptador; outros provedores após o piloto |
| Avaliação | LLM configurável |
| Fila | Em memória, capacidade/concorrência/tempo máximos e cancelamento explícitos |
| Comunicação | Socket.IO |
| Persistência | Revisões da sessão em memória e exportação no P0; SQLite/histórico durável no P1 |
| Estado | Zustand |

Os serviços devem ser encapsulados por adaptadores para permitir substituição posterior.

## 6. Modelo de verificação contextualizada

O resultado deverá contemplar:

| Campo | Objetivo |
|---|---|
| Afirmação original | Preservar a fala |
| Participante | Identificar a autoria |
| Veredito | Sintetizar o resultado |
| Conclusão | Explicar o principal achado |
| Contradição | Identificar conflito factual quando demonstrado; obrigatória em Falsa |
| Mecanismo | Explicar distorção demonstrada, com evidências; obrigatório em Enganosa |
| Contexto | Esclarecer condições e limitações |
| Evidências | Permitir conferência independente |

### Vereditos

- **Sustentada:** evidências suficientes confirmam a afirmação no escopo analisado.
- **Falsa:** evidências suficientes contradizem a afirmação.
- **Enganosa:** a afirmação utiliza fatos corretos de maneira que provoca interpretação substancialmente incorreta.
- **Inconclusiva:** as evidências não permitem uma conclusão segura.

### Regras obrigatórias

1. Não classificar como falso sem evidência que contradiga a afirmação.
2. Não classificar como enganoso sem identificar claramente a distorção ou omissão relevante.
3. Apresentar a contradição de maneira compreensível para pessoas sem conhecimento prévio do assunto.
4. Diferenciar dado real, interpretação e atribuição de responsabilidade.
5. Não inferir intenção deliberada de mentir sem evidências específicas.
6. Aplicar os mesmos critérios aos diferentes participantes.
7. Não usar confiança do modelo como substituto de verificação documental.
8. Permitir revisão e atualização dos resultados, invalidando a conclusão corrente quando um insumo relevante mudar.
9. Cada verificação deve tratar uma afirmação atômica. Falas com várias proposições têm resultados independentes, agrupados na UI.
10. Preservar citação literal e contexto. Normalização não pode acrescentar permanência, exclusividade, autoria ou causalidade não demonstradas na fala.
11. A ausência de evidência não comprova falsidade. Uma pesquisa tecnicamente concluída pode resultar em Inconclusiva; indisponibilidade que inviabiliza a pesquisa é Falha técnica.
12. Conclusões, contradições, aspectos sustentados e mecanismos apontam para trechos documentais inspecionados. Snippet, URL, título ou resposta de IA não bastam.
13. Não forçar contradição em Sustentada, nem classificar opinião como Inconclusiva. `NOT_FACT_CHECKABLE` é triagem.
14. Confiança do transcritor, confiança da autoria e suficiência documental são dimensões separadas. Zod valida estrutura e referências; coerência factual requer avaliação e revisão independentes.

## 7. Estados do sistema

### Estados da sessão

`IDLE → CONNECTING → LISTENING ⇄ PAUSED → ENDING → ENDED`

Estados excepcionais: `RECONNECTING`, `ERROR`. Reconexão não representa retomada da captura sem permissão. `ENDING` finaliza o último trecho e drena pesquisas aceitas até o timeout configurado; o usuário também pode cancelar imediatamente.

### Estados da investigação

`DETECTED → QUEUED → RESEARCHING → EVALUATING → COMPLETED`

Alternativos: `BLOCKED`, `FAILED`, `CANCELLED`, `DEFERRED` (sem capacidade/cota). `BLOCKED` pede correção ou confirmação de transcrição/contexto essencial; `DEFERRED` continua visível e exige agendamento explícito para sair desse estado.

**Veredito** é outro campo: `SUPPORTED`, `FALSE`, `MISLEADING`, `INCONCLUSIVE`. Somente `COMPLETED` possui resultado corrente. Revisão é um número, nunca um estado terminal `REVISED`; uma nova tentativa torna o resultado anterior histórico/superado até concluir novamente.

## 8. Comunicação e contratos

`shared` é a autoridade única para tipos e schemas de wire. Unificar a versão de Zod e os contratos duplicados, com migração explícita do modo Texto. Validar em tempo de execução todas as entradas e saídas Socket.IO.

| Direção | Eventos previstos |
|---|---|
| Cliente → servidor | `START_LIVE_SESSION`, `AUDIO_CHUNK`, `PAUSE_LIVE_SESSION`, `RESUME_LIVE_SESSION`, `END_LIVE_SESSION`, `CANCEL_LIVE_SESSION` |
| Cliente → servidor | `RESUME_SESSION`, `UPDATE_SPEAKER_MAPPING`, `CORRECT_TRANSCRIPT`, `RETRY_VERIFICATION`, `EXPORT_SESSION`, `DELETE_SESSION` |
| Servidor → cliente | `LIVE_SESSION_STARTED`, `LIVE_SESSION_STATE`, `TRANSCRIPT_PARTIAL`, `TRANSCRIPT_FINAL`, `TRANSCRIPT_REVISED`, `SPEAKER_MAPPING_UPDATED` |
| Servidor → cliente | `CLAIM_DETECTED`, `CLAIM_STATUS_UPDATED`, `VERIFICATION_RESULT`, `VERIFICATION_INVALIDATED`, `SESSION_SNAPSHOT`, `LIVE_METRICS`, `LIVE_GAP`, `LIVE_SESSION_ENDED` |

Envelope: `protocolVersion`, `eventId`, `sessionId`, `eventSeq`, `emittedAt`; segmento/claim/revisão quando aplicáveis. Áudio binário inclui `chunkSeq`, formato/endianness, canais, taxa, quantidade de amostras, `startSample` e época de captura. O contrato separa timestamp de mídia, horário de parede e atraso de processamento.

ACK confirma **aceite do bloco**, não conclusão da transcrição. Retentativas limitadas reutilizam o mesmo ID; o servidor deduplica. Tamanho, taxa e janela de blocos pendentes são limitados. Saturação ou perda produz `LIVE_GAP`/pausa explícita, nunca descarte silencioso.

Socket.IO não fornece replay completo por padrão. `RESUME_SESSION` envia cursor e autorização; a mesma instância retorna eventos retidos ou snapshot consistente com revisão. Eventos duplicados/antigos não sobrescrevem estado novo. Novo processo ou retenção expirada resulta em sessão indisponível, sem prometer recuperação durável P0.

Correções usam revisão esperada, rejeitam escrita concorrente e invalidam todas as claims dependentes da fala, contexto ou mapeamento corrigido. A resposta de pesquisa em trânsito só é aceita se a revisão dos insumos ainda coincidir. Ver especificação §10.

## 9. Requisitos não funcionais

### Performance

- Transcrição independente das pesquisas.
- Fila com limite de concorrência, capacidade, orçamento e tempo de espera; política de saturação observável.
- Controle de fluxo dos blocos de áudio.
- Monitoramento de latência por etapa.
- Resultados progressivos, com atraso e status por etapa.

### Metas provisórias de qualificação

As metas abaixo são hipóteses de aceite, **não desempenho medido**. LIVE-000 registra hardware, navegador, SO, player, modelo, versão, corpus e orçamento. Ajustes precisam de justificativa e publicação antes do gate; não reduzir o padrão silenciosamente para aprovar.

| Medição | Meta proposta |
|---|---|
| Fim da fala → trecho consolidado | p95 ≤ 10 s |
| Trecho consolidado → claim detectada | p95 ≤ 5 s |
| Claim aceita → conclusão, incluindo espera | p95 ≤ 90 s para claims investigáveis na carga qualificada |
| Qualificação inicial de áudio | 10 min contínuos, sem perda silenciosa |
| Ensaio de liberação do piloto | ≥ 2 h representativas, incluindo falhas e saturação |
| Qualidade factual no conjunto revisado | Nenhuma conclusão definitiva sem apoio documental; casos ambíguos ficam explicitamente bloqueados/inconclusivos |

Publicar tamanho da amostra, cobertura, erros observados e critérios de precisão/recall/atribuição aprovados no LIVE-000. Zero erros observados não representa garantia universal. A latência é medida em relação à reprodução capturada; atrasos da transmissão original são informados quando conhecidos.

### Segurança

- Validar mensagens Socket.IO com Zod.
- Restringir origens permitidas.
- Remover chaves de API de logs.
- Evitar persistir credenciais em texto puro.
- Implementar limites de uso.
- Definir retenção e exclusão de áudio e transcrições; áudio permanece somente em buffer temporário limitado, descartado após processamento/cancelamento.
- Credenciais são recebidas no setup existente, mantidas apenas no escopo necessário e nunca incluídas em logs, snapshots, replay ou exportação. Não editar `.env`/`.env.local` para migrar as chaves do usuário.
- Isolar sessões e controles por autorização; restringir bind/origens no piloto local. CORS não substitui autorização.
- Tratar transcrições/documentos como dados não confiáveis; instruções contidas neles não alteram políticas ou ferramentas. Validar URLs e bloquear destinos internos quando houver fetch direto.
- Limitar cotas por sessão e chamadas/minuto conforme limites efetivos da conta. Não ativar cobrança automaticamente.

### Confiabilidade

- Tratar ausência de evidências.
- Registrar fontes e datas.
- Permitir vereditos inconclusivos.
- Preservar histórico de revisões.
- Detectar erros de transcrição e identificação.
- Impedir que falhas de pesquisa produzam conclusões aparentemente definitivas.

---

# 10. Plano de implementação detalhado

As cinco fases organizam responsabilidades, não cinco entregas isoladas em sequência. A execução começa por LIVE-000, contratos LIVE-001/LIVE-016 e correções críticas LIVE-017/LIVE-038. Depois entrega uma fatia completa áudio → claim → documento → cartão, antes de ampliar diarização, UX e histórico.

A especificação de verificações rege o comportamento editorial e os invariantes do resultado. A fila LIVE-023, sincronização LIVE-028 e revisão LIVE-040 entram nessa primeira integração.

Cada fase possui critérios próprios de conclusão. A fase seguinte não deve depender de funcionalidades futuras ainda não entregues.

## FASE 1 — Audio to Text

**Objetivo:** transformar o Veritas em uma aplicação capaz de captar e transcrever áudio continuamente.

### Escopo técnico

**1.1. Audio Capture**

Criar `frontend/src/lib/audio/tabCapture.ts`.

Responsabilidades:

- Solicitar permissão com `getDisplayMedia()`.
- Capturar áudio da aba selecionada.
- Confirmar presença de trilha de áudio.
- Detectar interrupção do compartilhamento.
- Encerrar trilhas quando a sessão terminar.
- Tratar navegadores incompatíveis.

**1.2. Audio Streaming**

Criar `frontend/src/lib/audio/audioStream.ts`.

Responsabilidades:

- Extrair dados de áudio usando Web Audio API.
- Converter para mono e formato compatível com o transcritor.
- Controlar taxa de amostragem.
- Produzir pequenos blocos de áudio.
- Enviar blocos para o backend.
- Implementar controle de fluxo para evitar acúmulo ilimitado de áudio.

**1.3. Local Transcription**

Criar `backend/src/live/transcription.ts`.

Responsabilidades:

- Integrar um processo local Whisper.cpp.
- Receber blocos de áudio.
- Processar transcrição incremental.
- Diferenciar texto parcial de texto consolidado.
- Tratar pausas e sobreposição entre blocos.
- Associar timestamps aos trechos.
- Recuperar falhas do transcritor com timeout/restart limitado, sem esconder lacunas.
- Qualificar versão/modelo e processo persistente ou sua alternativa; não carregar o modelo novamente a cada bloco sem medir o impacto.
- Diferenciar finalização da hipótese de certeza semântica. Número, negação ou sujeito incerto bloqueia o veredito até revisão.

**1.4. Live Session Management**

Criar `backend/src/live/liveSession.ts`.

Responsabilidades:

- Criar uma sessão única.
- Gerenciar início, pausa, retomada e encerramento.
- Preservar o estado da sessão.
- Controlar interrupções e reconexões na mesma instância com ACK, cursor e snapshot; restart sem persistência encerra a continuidade e exige nova sessão.
- Liberar recursos.
- Propagar atualizações por Socket.IO.

**1.5. Interface de escuta**

Adicionar modo Áudio ao vivo em `verification/page.tsx`.

Componentes:

- Seletor Texto / Áudio.
- Botão Iniciar escuta.
- Indicador de captura ativa.
- Controle de pausa e encerramento.
- Área de transcrição.
- Estados de erro e recuperação.

### Entregáveis

- Captura real de áudio.
- Transcrição contínua.
- Interface funcional de escuta.
- Sessão gerenciada pelo backend.
- Testes de captura, interrupção e reconexão.

### Critérios de aceite

- [ ] A aba pode ser selecionada com permissão do usuário.
- [ ] O áudio é capturado e convertido corretamente.
- [ ] A transcrição aparece progressivamente.
- [ ] Os trechos definitivos não apresentam duplicações por sobreposição.
- [ ] Os timestamps são preservados.
- [ ] O usuário consegue pausar e encerrar.
- [ ] As trilhas e processos são liberados no encerramento.
- [ ] Uma gravação de 10 minutos pode ser processada continuamente no ambiente de referência.
- [ ] A verificação por texto existente continua funcional.

### Dependências

- Ambiente Node.js existente.
- Instalação e configuração do Whisper.cpp.
- Navegador com suporte à captura de áudio da aba.
- Máquina com recursos suficientes para a transcrição local.

**Resultado esperado:** Veritas escuta e transcreve, mas ainda não verifica automaticamente o conteúdo.

---

## FASE 2 — Live Claims

**Objetivo:** interpretar a transcrição e identificar automaticamente afirmações verificáveis e seus participantes.

### Escopo técnico

**2.1. Speech Segmentation**

Criar `backend/src/live/speechSegments.ts`.

Responsabilidades:

- Receber texto consolidado.
- Detectar limites entre frases.
- Considerar pausas e mudanças de locutor.
- Manter uma janela de contexto.
- Evitar claims extraídas de frases incompletas.
- Registrar início e fim dos segmentos.

**2.2. Speaker Identification**

Criar `backend/src/live/speakerIdentification.ts`.

Responsabilidades:

- Diferenciar locutores.
- Atribuir IDs persistentes durante a sessão.
- Permitir associação inicial entre voz e participante.
- Preservar níveis de confiança.
- Suportar participante desconhecido.
- Corrigir associações previamente incorretas.

No MVP completo, a diarização acústica local e a manutenção de IDs entre blocos são obrigatórias. O usuário confirma inicialmente o mapeamento das vozes aos nomes; isso não elimina o trabalho de reconhecer as mesmas vozes posteriormente.

Nomes inferidos pelo conteúdo, ordem de fala ou alternância de turnos não são autoria confirmada. Trechos com mediador, plateia, sobreposição ou evidência insuficiente permanecem desconhecidos. Descobrir nomes sem associação inicial é P1. O piloto pode operar com autoria desconhecida, mas será descrito como parcial.

**2.3. Claim Detection**

Refatorar `backend/src/analysis/basicAnalysis.ts`.

Responsabilidades:

- Separar extração de claims de julgamento factual.
- Receber transcrição com contexto.
- Identificar afirmações verificáveis.
- Preservar o texto original.
- Registrar participante e timestamp.
- Ignorar conteúdo puramente opinativo.
- Consolidar claims que atravessam diferentes segmentos.

**2.4. Claim Deduplication**

Criar um mecanismo de deduplicação.

Responsabilidades:

- Detectar repetições textuais.
- Identificar paráfrases equivalentes.
- Reutilizar investigação factual equivalente, preservando ocorrências e autoria separadas. A chave inclui sujeito, negação, período, unidade e universo; só o texto parecido não autoriza mesclar.
- Preservar novas ocorrências para referência.
- Permitir reanálise quando uma afirmação for modificada substancialmente.

**2.5. Context Management**

Criar gerenciamento contextual independente.

O contexto deve incluir:

- Falas imediatamente anteriores com IDs, revisões e locutores; contexto pode conter o adversário sem atribuir sua fala ao autor da claim.
- Participante.
- Assunto em discussão.
- Período mencionado.
- Referências pronominais.
- Informações necessárias para interpretar a afirmação.

Não depender exclusivamente da memória conversacional atual do LangChain.

### Entregáveis

- Transcrição estruturada por segmentos.
- Identificação de participantes com fallback.
- Extração automática de claims.
- Deduplicação.
- Contexto associado a cada claim.

### Critérios de aceite

- [ ] Afirmações verificáveis são detectadas automaticamente.
- [ ] Claims preservam texto, participante e timestamp.
- [ ] Afirmações incompletas não são enviadas prematuramente.
- [ ] Claims duplicadas não geram pesquisas duplicadas.
- [ ] Segmentos sem afirmações verificáveis são ignorados.
- [ ] Falas de participantes diferentes não são misturadas.
- [ ] Identificações incertas são sinalizadas.
- [ ] Correções de identificação atualizam os segmentos vinculados.

### Testes necessários

- Diálogo com dois candidatos e mediador.
- Interrupções de fala.
- Repetição de afirmações.
- Frases longas.
- Pronunciamentos sem afirmações verificáveis.
- Erros e ambiguidades de transcrição.

**Resultado esperado:** Veritas transcreve, identifica participantes e produz uma lista confiável de claims para investigação.

---

## FASE 3 — Evidence Engine

**Objetivo:** substituir o julgamento simplificado atual por um processo de investigação com contradições e evidências demonstráveis.

Esta é a fase central de qualidade do produto.

### Escopo técnico

**3.1. Fact Checking Service**

Refatorar `backend/src/service/factCheckService.ts`.

Responsabilidades:

- Aceitar claims individuais.
- Preservar verificação manual de textos.
- Separar extração de investigação.
- Eliminar `reasoningConfidence` como decisão de pesquisar; toda conclusão definitiva exige evidência inspecionada.
- Permitir que a investigação revise integralmente veredito/flags, além da redação. Não preservar a classificação preliminar como autoridade.
- Impedir que exceção de busca seja convertida em texto para um LLM produzir conclusão aparentemente válida.
- Gerenciar o ciclo de vida das verificações.
- Suportar cancelamento e reprocessamento.

**3.2. Evidence Retrieval**

Evoluir `backend/src/analysis/deepResearch.ts`.

Responsabilidades:

- Criar consultas específicas para cada claim.
- Buscar múltiplas fontes.
- Priorizar documentos e dados primários.
- Verificar datas e períodos.
- Evitar duplicação de fontes.
- Identificar documentos contraditórios.
- Guardar trechos relevantes, localização, conteúdo inspecionado ou referência recuperável, hash/versão e data de coleta.
- Vincular conclusão, aspectos sustentados, contradição e mecanismo às evidências específicas.
- Registrar consultas, documentos inacessíveis e limitações, sem credenciais. URLs que não foram recuperadas não podem aparecer como fontes da conclusão.

As fontes deverão passar por validação de acessibilidade e pertinência.

**3.3. Evidence Evaluation**

Criar `backend/src/analysis/evidenceEvaluation.ts`.

Responsabilidades:

- Comparar a claim com as evidências recuperadas.
- Distinguir apoio, contradição e contexto.
- Verificar compatibilidade temporal.
- Identificar comparações inadequadas.
- Avaliar atribuições de autoria e responsabilidade.
- Separar fatos observáveis de inferências.

**3.4. Contradiction Detection**

Criar `backend/src/analysis/contradictionDetection.ts`.

Responsabilidades:

- Identificar exatamente o ponto da contradição.
- Determinar quais fatos entram em conflito.
- Explicar o conflito em linguagem acessível.
- Vincular cada contradição às fontes correspondentes.
- Evitar conclusões sem evidências suficientes.

**3.5. Misleading Mechanism**

Criar `backend/src/analysis/misleadingMechanism.ts`.

Categorias iniciais:

- Falsa atribuição de autoria.
- Omissão de contexto decisivo.
- Dado real aplicado ao universo errado.
- Comparação incompatível.
- Causalidade não demonstrada.
- Uso de período inadequado.
- Generalização indevida.
- Seleção parcial de dados.

A classificação deve ser fundamentada na evidência e não presumir intenção deliberada.

**3.6. Verdict Generation**

Criar `backend/src/analysis/verdictGeneration.ts`.

Responsabilidades:

- Gerar conclusão curta.
- Produzir veredito estruturado.
- Explicar contradição, quando existente.
- Descrever o mecanismo relevante.
- Indicar contexto e limitações.
- Referenciar as evidências utilizadas.
- Retornar inconclusivo quando necessário.

**3.7. Research Queue**

Criar `backend/src/live/claimQueue.ts`.

Responsabilidades:

- Receber claims continuamente.
- Limitar concorrência.
- Priorizar verificabilidade/relevância com critérios públicos e independentes do candidato ou veredito esperado; medir cobertura por participante sem impor cotas artificiais de falsidade.
- Executar investigações independentes.
- Implementar cache limitado por sessão, escopo, versão dos insumos e validade temporal; reutilização não apaga ocorrências individuais.
- Implementar timeout e retry.
- Cancelar quando solicitado; encerramento normal drena apenas tarefas já aceitas até timeout, distinguindo captura encerrada de investigação concluída.
- Evitar que pesquisas bloqueiem a transcrição.

**3.8. Contratos**

Atualizar `shared/types/api.ts` e os schemas Zod associados.

Novos campos:

- Identificador da claim.
- Participante.
- Timestamp.
- Veredito.
- Conclusão.
- Contradição.
- Mecanismo identificado.
- Contexto.
- Evidências estruturadas.
- Limitações.
- Estado de investigação.
- Revisão do resultado.

### Entregáveis

- Motor de verificação contextualizada.
- Investigação assíncrona.
- Evidências rastreáveis.
- Detecção de contradições.
- Identificação de mecanismos enganosos.
- Vereditos estruturados.
- Testes de regressão e consistência.

### Critérios de aceite

- [ ] Uma afirmação falsa recebe explicação da contradição.
- [ ] Uma afirmação enganosa identifica qual informação altera sua interpretação.
- [ ] Cada conclusão factual apresenta evidências pertinentes.
- [ ] Fontes inacessíveis são sinalizadas.
- [ ] Pesquisas sem evidências suficientes geram resultado inconclusivo.
- [ ] O mesmo critério é aplicado a diferentes participantes.
- [ ] Falhas de uma investigação não bloqueiam outras.
- [ ] A transcrição permanece ativa durante a pesquisa.
- [ ] A verificação manual continua funcionando.
- [ ] Testes utilizam casos reais com referências previamente estabelecidas.

### Casos de referência

- Origem do Pix: atribuição de autoria.
- Auxílio Brasil de R$ 600: contexto temporal e institucional.
- Despesas de viagens federais: atribuição incorreta de dados agregados.

Esses casos devem integrar uma suíte de avaliação, com documentos e critérios independentes dos resultados gerados pelo modelo.

**Resultado esperado:** Veritas produz verificações fundamentadas e contextualizadas, com evidências e contradições explícitas.

---

## FASE 4 — Live Experience

**Objetivo:** integrar as funcionalidades técnicas à experiência visual desenvolvida no protótipo Veritas Live.

### Escopo técnico

**4.1. Entrada de conteúdo**

Atualizar `verification/page.tsx`.

Implementar:

- Seletor Texto / Áudio ao vivo.
- Configuração de captura.
- Controle de início e encerramento.
- Estados de permissão.
- Feedback de captura ativa.
- Mensagens de indisponibilidade.

**4.2. Live Transcript**

Criar componentes de transcrição.

Requisitos:

- Exibição progressiva.
- Participante identificado.
- Timestamps.
- Destaque de claims.
- Navegação entre falas e resultados.
- Feedback de trechos provisórios.
- Tratamento de correções de transcrição.

**4.3. Verification Timeline**

Atualizar `results/ResultsPage.tsx`.

Requisitos:

- Lista cronológica de verificações.
- Atualização progressiva.
- Visualização de investigações ativas.
- Ordenação temporal.
- Seleção de claims.
- Sincronização com transcrição.
- Estados vazios e de erro.

**4.4. Verification Result Card**

Atualizar `results/ResultsPanel.tsx` e criar componentes específicos.

Estrutura:

1. Afirmação original.
2. Veredito.
3. Conclusão curta.
4. Onde está a contradição? (em Falsa; confronto pertinente nos demais casos)
5. Como a afirmação induz ao erro? (somente com mecanismo demonstrado)
6. Evidências.
7. Contexto e limitações.

Utilizar progressive disclosure para manter a interface simples.

**4.5. Responsive & Mobile — P1; desktop funcional é P0**

Desktop:

- Transcrição à esquerda.
- Resultados à direita.
- Navegação sincronizada.

Mobile:

- Abas de transcrição e verificações.
- Controles acessíveis.
- Cards adaptados.
- Navegação por toque.
- Sem necessidade de capturar áudio diretamente no celular.

**4.6. Revisões e persistência**

P0: tentativas/revisões rastreáveis durante a sessão, snapshot/replay limitado e exportação sanitizada. Publicar limites de memória, duração e retenção; delete/cancelamento libera recursos e apaga credenciais. Áudio não é exportado por padrão.

P1: adicionar SQLite para histórico durável. A ausência de SQLite não dispensa as revisões P0.

Armazenar:

- Sessões.
- Participantes.
- Segmentos de transcrição.
- Claims.
- Evidências e verificações.
- Estados e revisões.

Definir uma política de retenção.

**4.7. Sessões compartilhadas — P1**

Permitir que uma sessão iniciada no desktop seja acompanhada no celular.

Requisitos:

- Identificador de sessão.
- Controle de acesso.
- Sincronização.
- Reconexão.
- Visualização sem acesso à captura original.

### Entregáveis

- Interface integrada ao backend.
- Timeline funcional.
- Novo card de verificação.
- Navegação responsiva.
- Histórico persistente (P1).
- Fluxo completo desktop → mobile (P1).

### Critérios de aceite

- [ ] O fluxo de captura pode ser iniciado pela interface.
- [ ] A transcrição aparece continuamente.
- [ ] As claims são exibidas sem duplicação.
- [ ] Os resultados atualizam sem recarregar a página.
- [ ] A contradição aparece destacada.
- [ ] As evidências podem ser abertas.
- [ ] Os estados de pesquisa são distinguíveis.
- [ ] A interface desktop funciona; avaliação mobile é P1.
- [ ] Revisões da sessão atual podem ser inspecionadas/exportadas; consulta após reinício é P1.
- [ ] Acompanhamento em outro dispositivo autorizado é avaliado no P1, sem bloquear o MVP desktop.

**Resultado esperado:** experiência funcional e integrada, alinhada ao protótipo de referência e à especificação revisada.

---

## FASE 5 — Quality, Reliability & Optimization

**Objetivo:** avaliar e estabilizar o sistema para operar durante transmissões contínuas, sem comprometer a confiabilidade das verificações.

### Escopo técnico

**5.1. Testes de transcrição**

Avaliar:

- Precisão em português brasileiro.
- Ruído de transmissão.
- Interrupções.
- Sobreposição de falas.
- Nomes próprios.
- Números, percentuais e datas.
- Latência.

**5.2. Testes de participantes**

Avaliar:

- Atribuição correta das falas.
- Mudança de locutor.
- Participantes desconhecidos.
- Falas simultâneas.
- Correção de atribuições.

**5.3. Testes de claims**

Avaliar:

- Precisão de extração.
- Claims incompletas.
- Duplicatas.
- Perda de contexto.
- Falsos positivos.
- Afirmações relevantes não detectadas.

**5.4. Testes de verificação**

Avaliar:

- Qualidade de fontes.
- Precisão dos vereditos.
- Capacidade de demonstrar contradições.
- Coerência entre evidências e conclusões.
- Identificação de mecanismos enganosos.
- Taxa de resultados inconclusivos.
- Consistência entre participantes.

**5.5. Performance**

Medir:

- Latência de captura.
- Latência de transcrição.
- Tempo de extração de claims.
- Tempo de pesquisa.
- Tempo total até conclusão.
- Consumo de memória e CPU.
- Profundidade da fila.
- Consumo das cotas gratuitas.

**5.6. Resiliência**

Testar:

- Perda de conexão.
- Interrupção de captura.
- Falha do transcritor.
- Indisponibilidade da busca.
- Esgotamento de cota.
- Encerramento durante investigação.
- Retomada de sessão.
- Eventos duplicados.
- Atualizações fora de ordem.

**5.7. Segurança**

Verificar:

- Validação de mensagens.
- Proteção das credenciais.
- Restrições CORS.
- Controle de acesso a sessões.
- Sanitização de logs.
- Limites de consumo.
- Exclusão de dados.

### Entregáveis

- Suíte de testes automatizados.
- Base de avaliação com exemplos reais.
- Relatório de qualidade de transcrição.
- Relatório de qualidade de verificações.
- Métricas de performance.
- Correções de confiabilidade.
- Documentação operacional.

### Critérios de aceite

- [ ] O sistema executa um teste contínuo com gravação de debate.
- [ ] Não apresenta perda silenciosa de trechos.
- [ ] Não apresenta duplicações relevantes de claims.
- [ ] Falhas de API não produzem conclusões inventadas.
- [ ] Atribuições incertas não aparecem como confirmadas.
- [ ] Vereditos são justificáveis por evidências.
- [ ] Recursos são liberados após o encerramento.
- [ ] Limites gratuitos e consumo de hardware estão documentados.
- [ ] O sistema continua utilizável quando uma investigação falha.
- [ ] Todas as regressões críticas da verificação manual foram testadas.

### Métricas de referência

Metas e corpus são definidos no LIVE-000; medições calibram os limites antes da liberação. Registrar:

- Word Error Rate da transcrição.
- Precisão de identificação de locutores.
- Precisão e recall da extração de claims.
- Taxa de duplicatas.
- Percentual de verificações com evidências válidas.
- Taxa de correções de veredito.
- Tempo mediano e p95 de verificação.
- Estabilidade de sessões contínuas.
- Custo de processamento por hora.

**Resultado esperado:** MVP validado, com limites conhecidos e confiabilidade mensurada.

---

## 11. Dependências entre fases

| Fase | Depende de | Entrega principal |
|---|---|---|
| 1. Audio to Text | LIVE-000 e contrato de áudio | Transcrição contínua qualificada |
| 2. Live Claims | Fase 1 | Claims estruturadas |
| 3. Evidence Engine | LIVE-016, sem depender de áudio pronto | Verificações documentadas avaliadas |
| 4. Live Experience | Fases 1–3 | Produto integrado |
| 5. Quality & Optimization | Começa nos contratos; gates no fluxo integrado | Piloto/MVP qualificados separadamente |

Os componentes da Fase 3 que não dependem de áudio poderão ser desenvolvidos e testados em paralelo usando claims textuais.

Os testes de qualidade devem começar desde a Fase 1; a Fase 5 concentra os testes integrados e a validação final.

## 12. Estratégia de implementação

### Princípios

- Reutilizar o codebase existente.
- Evitar reescritas desnecessárias.
- Preservar compatibilidade com o modo Texto.
- Implementar contratos tipados antes das integrações.
- Entregar módulos testáveis independentemente.
- Utilizar mocks e gravações reproduzíveis.
- Priorizar segurança, evidências verificáveis, revisão de insumos e métricas desde o primeiro ciclo.
- Não depender de serviços pagos para iniciar o MVP.

### Estratégia de testes

Cada fase deverá conter:

- Testes unitários dos novos módulos.
- Testes de integração.
- Testes de falhas.
- Testes de regressão.
- Demonstração funcional.
- Critérios de aceite documentados.

Não considerar uma fase concluída apenas porque a interface funciona com dados simulados.

## 13. Principais riscos

| Risco | Mitigação |
|---|---|
| Transcrição incorreta | Validação de trechos e sinalização de incerteza |
| Identificação incorreta | Associação confirmada e fallback |
| Alucinação de evidências | Verificação documental |
| Afirmação fora de contexto | Janela contextual |
| Latência elevada | Fila e paralelismo |
| Limites gratuitos | Cache e adaptadores locais |
| Captura incompatível | Detecção de suporte |
| Interrupções de transmissão | Recuperação de sessão |
| Exposição de credenciais | Segurança e sanitização |
| Restrições de direitos autorais | Não retransmitir conteúdo e avaliar permissões |

## 14. Gates de entrega e definição de sucesso do MVP

### Gate A — Qualificação e motor documental

- Captura/transcrição demonstradas com fonte real no ambiente de referência (LIVE-000/008).
- Contratos compartilhados, logs sanitizados e isolamento de sessão validados.
- Casos de referência revisados por proposição, incluindo sustentados, falsos, enganosos condicionais, inconclusivos e falhas reais de provedor.
- Nenhuma conclusão definitiva baseada apenas em snippet, confiança de IA ou interpretação não demonstrada.

### Gate B — Piloto experimental integrado

LIVE-041 demonstra captura → transcrição → extração → fila → documento → cartão com serviços reais, correção/reprocessamento, reconexão e ensaio ≥ 2 h. Sem benchmark completo ou com autoria desconhecida, publicar precisamente a limitação; não declarar o MVP completo pronto.

### Gate C — MVP completo

Além do Gate B: diarização contínua e associação inicial qualificadas, métricas/cobertura revistas e critérios P0 das cinco iniciativas atendidos. Persistência durável e mobile permanecem P1.

### Definição funcional

O Veritas Live será considerado funcional quando conseguir:

1. Capturar áudio de uma fonte autorizada.
2. Transcrever uma transmissão continuamente.
3. Identificar e organizar afirmações por participante.
4. Investigar afirmações sem interromper a captura.
5. Apresentar contradições e evidências verificáveis.
6. Diferenciar conclusões sustentadas de resultados inconclusivos.
7. Oferecer uma experiência responsiva e compreensível.
8. Operar de maneira estável dentro dos limites documentados.

**Prioridade do produto:** transparência, confiabilidade factual e clareza para o usuário.

O sucesso não deve ser medido apenas pela quantidade de afirmações verificadas, mas pela qualidade das evidências e pela capacidade de explicar por que uma conclusão é sustentada.


## 15. Referências técnicas e registro da revisão

- [Captura de tela/aba e limitações de áudio](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia).
- [Whisper.cpp: exemplo de streaming](https://raw.githubusercontent.com/ggml-org/whisper.cpp/master/examples/stream/README.md) e [servidor local](https://raw.githubusercontent.com/ggml-org/whisper.cpp/master/examples/server/README.md).
- [Diarização local pyannote Community-1: instalação, condições e limites](https://huggingface.co/pyannote/speaker-diarization-community-1). Motor e dependências são propostas sujeitas ao LIVE-000; disponibilidade de token/modelo não é presumida.
- [Socket.IO: entrega, ACK e replay](https://socket.io/docs/v4/delivery-guarantees/).
- [Tavily: créditos](https://docs.tavily.com/documentation/api-credits) e [inspeção por Extract](https://docs.tavily.com/documentation/api-reference/endpoint/extract).
- [Gemini: limites efetivos e capacidade variável](https://ai.google.dev/gemini-api/docs/rate-limits).

Em 23/10/2026, a revisão do código encontrou julgamento preliminar antes da busca, pesquisa condicionada à confiança, flags não revistas pela pesquisa, fallback textual em falhas, logs com requisição contendo chaves e contratos duplicados. São problemas a corrigir nas tarefas; esta revisão documental **não os corrige no código**. Três testes existentes com mocks e typechecks sem diagnósticos não qualificam operação ao vivo nem precisão factual.
