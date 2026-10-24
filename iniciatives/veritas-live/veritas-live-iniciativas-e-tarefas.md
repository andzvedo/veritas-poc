# Veritas Live — Plano de Iniciativas e Tarefas

- **Versão:** 1.1
- **Origem:** PRD Veritas Live v1.2 e Especificação de verificações v1.1
- **Repositório:** https://github.com/andzvedo/veritas-poc
- **Status:** Implementação parcial no código; aceite das tarefas continua pendente de evidência

---

## 1. Objetivo

Transformar o Veritas em uma plataforma capaz de:

1. Capturar áudio de uma aba do navegador.
2. Transcrever continuamente em português.
3. Identificar participantes e afirmações verificáveis.
4. Pesquisar evidências automaticamente.
5. Explicar contradições, omissões e distorções.
6. Exibir resultados progressivos no desktop e mobile.

A implementação deve preservar o modo de verificação manual existente.

## 2. Regras de implementação

### Restrições obrigatórias

- Priorizar tecnologias gratuitas e open-source.
- Não exigir assinatura paga.
- Permitir troca de fornecedores de IA e pesquisa.
- Não retransmitir áudio ou vídeo de terceiros.
- Preservar proveniência das afirmações e evidências.
- Não gerar vereditos definitivos sem evidências suficientes.
- Não bloquear a transcrição durante pesquisas.
- Evitar grandes reescritas do código existente.

### Convenção de tarefas

Os IDs `LIVE-001` a `LIVE-039` são preservados. Esta revisão acrescenta `LIVE-000` (qualificação), `LIVE-040` (revisões) e `LIVE-041` (gate do piloto), totalizando 42 tarefas. O código cobre partes das tarefas; nenhuma é marcada como concluída sem cumprir os critérios de aceite e registrar evidências.

Documentos normativos: [PRD v1.2](veritas-live-prd.md) e [Especificação de verificações v1.1](veritas-live-especificacao-de-verificacoes.md). Os nomes dos arquivos são mantidos para preservar links.

Prioridades:

- **P0:** obrigatório para o MVP funcional.
- **P1:** necessário para a experiência completa, mas pode ser entregue depois do primeiro piloto.

### Estado da implementação observado

O commit `8b01ec5d18eef0bad0644aa07888566b3f507e7a` acrescenta adaptadores intercambiáveis, controles de orçamento e um harness/corpus factual offline ao percurso existente de áudio → transcrição → claim → pesquisa → card. A suíte automatizada usa mocks em parte do fluxo e o corpus local é um ponto de partida; isso não comprova captura real, qualidade de fala/autoria, precisão factual geral, latência-alvo nem ensaio de duas horas.

Esta rodada conecta a interface ao fluxo de áudio e corrige entrada de socket, autoria apresentada, sincronização de revisão, citação literal, falhas de recuperação documental e encerramento. Os checkboxes abaixo continuam sendo critérios, não uma declaração automática de aceite. O sistema não retoma sessão em socket novo: por segurança, a interface encerra a captura e orienta iniciar outra sessão quando a conexão cai.

Na branch desta PR, passaram 333 testes do backend, 69 do frontend, avaliação factual offline (10/10), lint, typechecks e builds de backend/frontend. Esses resultados cobrem contratos e fixtures; não substituem captura real, provedores externos ou validação independente.

Permanecem gates explícitos: qualificação de navegador/player/modelos e validação do orçamento (LIVE-000), diarização contínua avaliada (LIVE-010/034), benchmark documental independente com referências revisadas (LIVE-024/035), medição de custo/latência e ensaio prolongado (LIVE-036/041), prova reproduzível de conteúdo-fonte e revisão de segurança/privacidade (LIVE-038). Histórico persistente e mobile seguem P1 (LIVE-029/030/031).

### Definition of Done geral

Uma tarefa só pode ser considerada concluída quando:

- O código está implementado.
- Seus critérios de aceite foram verificados.
- Existem testes proporcionais ao risco da alteração.
- Não há regressões conhecidas na funcionalidade atual.
- O contrato público foi documentado, quando aplicável.
- Os resultados de validação estão registrados.
- Uma revisão independente aprovou as alterações.

---

# LIVE-000 — Qualificar ambiente, fonte, modelos e metas

**Prioridade:** P0; primeira tarefa.

**Implementar**

Demonstrar captura da transmissão escolhida e transcrição local com português, modelo e hardware de referência. Qualificar um caminho acústico para locutores antes de prometer autoria automática. Definir corpus anotado, orçamento de provedores e limites do piloto.

**Aceite**

- [ ] Registra SO, navegador, player, CPU/GPU/RAM, versões, modelo, processo e formato de áudio.
- [ ] Captura áudio real com consentimento e não envia vídeo.
- [ ] Processa trecho representativo de 10 min, incluindo números, negações, mediador e interrupções.
- [ ] Define metas de precisão/recall/atribuição com denominadores e critérios de bloqueio, antes de validar o conjunto reservado.
- [ ] Verifica disponibilidade/licença/acesso dos modelos, sem presumir token, GPU ou assinatura.
- [ ] Mede viabilidade de diarização contínua separadamente da associação de nomes.
- [ ] Documenta cotas efetivas e estimativa de chamadas/créditos por hora; não ativa cobrança.
- [ ] Registra decisão: caminho qualificado, fallback experimental ou impedimento; não marca pronto apenas pelo design do adaptador.

---

# INIT-01 — Audio to Text

**Prioridade:** P0  
**Objetivo:** criar captura e transcrição contínuas de áudio.

**Dependências:** LIVE-000 e contrato compartilhado de áudio. LIVE-016/017/038 começam no mesmo ciclo; áudio não precisa estar pronto para validar o motor factual.

## LIVE-001 — Contratos de sessão e áudio

**Implementar**

- Definir IDs de sessão e blocos de áudio.
- Definir estados da captura.
- Criar schemas Zod dos eventos.
- Estabelecer timestamps e numeração sequencial.

**Arquivos**

- `shared/types/api.ts`
- `backend/src/ws/types.ts`

**Aceite**

- [ ] Eventos de áudio possuem contratos validados.
- [ ] Cada bloco possui sessão, sequência e timestamp.
- [ ] Payloads inválidos são rejeitados.
- [ ] Eventos repetidos podem ser identificados.

**Complementos obrigatórios desta revisão**

- [ ] `shared` é autoridade única; backend e frontend importam os mesmos schemas, com versão de Zod compatível.
- [ ] Envelope inclui versão do protocolo, ID/seq de evento e sessão; revisões de segmento/claim quando aplicáveis.
- [ ] Formato PCM, endianness, canais, taxa de amostragem, amostras por bloco e `startSample` são explícitos.
- [ ] ACK confirma aceite; ID repetido não reprocessa bloco, e sequência ausente produz lacuna sinalizada.
- [ ] Entradas e saídas são validadas em runtime; contratos do modo Texto possuem migração explícita.


## LIVE-002 — Captura de áudio da aba

> **Atualização 2026-10-23 (decisão do usuário):** a captura passou a ser pelo **microfone** (`getUserMedia`, `frontend/src/lib/audio/micCapture.ts`, `source: 'MIC'`), porque o compartilhamento de aba não funcionou no piloto. O caminho `getDisplayMedia`/`tabCapture.ts` foi removido.

**Implementar**

`frontend/src/lib/audio/tabCapture.ts`

Utilizar `getDisplayMedia()` para solicitar compartilhamento de aba e áudio. A implementação deve lidar com a trilha de vídeo exigida pela API sem transmiti-la ao backend.

**Aceite**

- [ ] Solicita permissão após clique do usuário.
- [ ] Permite selecionar uma aba.
- [ ] Confirma que existe áudio disponível.
- [ ] Detecta encerramento do compartilhamento.
- [ ] Libera as trilhas capturadas.
- [ ] Explica erros de permissão e incompatibilidade.

**Complementos obrigatórios desta revisão**

- [ ] Testa o player e a combinação navegador/SO qualificados, além de permissões negadas e stream sem trilha de áudio.
- [ ] Mantém a trilha de vídeo necessária à captura sem enviar seus dados; valida que sua liberação não interrompe áudio prematuramente.
- [ ] Reconexão que exige nova autorização solicita clique; nunca promete recaptura automática fora das permissões do navegador.


## LIVE-003 — Processamento e transmissão de áudio

**Implementar**

`frontend/src/lib/audio/audioStream.ts`

Usar Web Audio API e AudioWorklet para converter o áudio capturado em blocos compatíveis com o transcritor.

**Aceite**

- [ ] Suporta conversão para áudio mono.
- [ ] Suporta reamostragem quando necessário.
- [ ] Envia blocos sequenciais por transporte binário.
- [ ] Preserva referências temporais.
- [ ] Implementa controle de fluxo para evitar crescimento ilimitado da fila.
- [ ] Não envia vídeo ao backend.

**Complementos obrigatórios desta revisão**

- [ ] Limita tamanho/frequência dos blocos e quantidade em trânsito, com ACK/timeout/retentativas idempotentes.
- [ ] Usa relógio de amostras; pausa/retomada não compacta silenciosamente o tempo da transmissão.
- [ ] Saturação rejeita/pausa ou registra lacuna explícita; não acumula áudio ilimitado nem o descarta silenciosamente.
- [ ] Encerramento envia/finaliza o último bloco válido; cancelamento elimina buffers temporários.


## LIVE-004 — Adaptador local de transcrição

**Implementar**

`backend/src/live/transcription.ts`

Integrar Whisper.cpp por um adaptador que encapsule o processo de transcrição.

**Aceite**

- [ ] Transcreve áudio em português brasileiro.
- [ ] Executa localmente sem cobrança por transcrição.
- [ ] Aceita blocos sucessivos.
- [ ] Retorna texto e timestamps.
- [ ] Trata falhas e reinicialização do processo.
- [ ] Permite substituir o motor posteriormente.

**Complementos obrigatórios desta revisão**

- [ ] Modelo multilíngue, versão, dependências e aceleração são qualificados no LIVE-000; instalação não é presumida.
- [ ] Mede custo de carregamento e uso de processo persistente versus invocações por bloco.
- [ ] Trecho finalizado não significa fala fiel garantida: sinais de dúvida em número, negação ou sujeito bloqueiam conclusão.
- [ ] Falha/restart do transcritor tem timeout/retry limitado e registra eventuais lacunas.


## LIVE-005 — Consolidação da transcrição

**Implementar**

`backend/src/live/speechSegments.ts`

Consolidar hipóteses parciais e texto definitivo, utilizando detecção de atividade de voz e tratamento de sobreposições.

**Aceite**

- [ ] Suporta transcrições parciais.
- [ ] Gera trechos definitivos.
- [ ] Evita repetição de palavras entre blocos.
- [ ] Preserva a ordem temporal.
- [ ] Não perde trechos silenciosamente.
- [ ] Diferencia texto provisório de confirmado.

**Complementos obrigatórios desta revisão**

- [ ] Cada segmento possui ID e revisão; hipóteses parciais atualizam o mesmo trecho e não disparam veredito.
- [ ] Janela sobreposta é reconciliada por tempo/texto, sem cortar negação, unidade ou palavra na fronteira.
- [ ] Dúvidas críticas geram `BLOCKED`; existe caminho de correção sem reescrever a citação histórica.
- [ ] Fornece áudio/timestamps à identificação acústica e finaliza o último trecho ao encerrar normalmente.


## LIVE-006 — Gerenciador de sessão

**Implementar**

`backend/src/live/liveSession.ts`

Gerenciar:

- Iniciar.
- Pausar.
- Retomar.
- Encerrar.
- Reconectar.
- Liberar recursos.

**Aceite**

- [ ] Cada captura possui uma sessão única.
- [ ] Pausar interrompe o envio/processamento de novos blocos.
- [ ] Retomar preserva a sequência lógica.
- [ ] Encerrar libera os recursos.
- [ ] Reconexões não duplicam blocos confirmados.
- [ ] Falhas apresentam estados recuperáveis.

**Complementos obrigatórios desta revisão**

- [ ] Define `ENDING`: parar captura, finalizar trecho e drenar apenas tarefas aceitas até timeout; `CANCEL` aborta imediatamente.
- [ ] Separa estado da captura, da transcrição e das investigações.
- [ ] Retoma conexão na mesma instância por cursor/replay limitado ou snapshot; restart sem armazenamento durável informa sessão indisponível.
- [ ] Sessões são isoladas por autorização, com limites de memória/duração, expiração e exclusão de credenciais/buffers.
- [ ] Exportação sanitizada das revisões correntes é P0, mesmo sem histórico SQLite.


## LIVE-007 — Interface inicial de áudio

**Implementar**

- Seleção Texto / Áudio ao vivo.
- Iniciar escuta.
- Pausar e encerrar.
- Status da captura.
- Transcrição básica.

**Arquivos principais**

- `frontend/src/app/verification/page.tsx`
- Novo `LiveAudioControls.tsx`
- Novo `LiveTranscript.tsx`

**Aceite**

- [ ] O usuário consegue iniciar a escuta.
- [ ] A transcrição aparece progressivamente.
- [ ] Os controles refletem o estado real.
- [ ] Erros são compreensíveis.
- [ ] O modo Texto permanece funcional.

**Complementos obrigatórios desta revisão**

- [ ] UI inicial já suporta um fluxo real até um cartão; a UI definitiva não é pré-condição para validar o motor.
- [ ] Captura ativa, áudio ausente, transcrição atrasada e pesquisa saturada têm feedback separado.
- [ ] Autoria desconhecida é visível e não recebe automaticamente nome de candidato.


## LIVE-008 — Validação integrada da Fase 1

**Implementar**

Testes automatizados e uma demonstração reproduzível com gravação de debate.

**Aceite**

- [ ] Captura e transcrição funcionam de ponta a ponta.
- [ ] Uma gravação de 10 minutos é processada continuamente.
- [ ] Pausa, retomada e encerramento são testados.
- [ ] Não há duplicações relevantes decorrentes de sobreposição.
- [ ] Timestamps são preservados.
- [ ] O fluxo manual existente continua funcionando.

**Complementos obrigatórios desta revisão**

- [ ] Dez minutos qualificam apenas a etapa de áudio; liberação do piloto exige o ensaio integrado ≥ 2 h de LIVE-041.
- [ ] Registra modelo/hardware/navegador/player, latência, CPU/memória e todas as lacunas.
- [ ] Inclui perda de conexão, silêncio, ruído, número/negação e fronteiras de blocos com áudio real.


**Definition of Done — INIT-01**

O Veritas consegue capturar e transcrever áudio continuamente após uma única autorização inicial.

---

# INIT-02 — Live Claims

**Prioridade:** P0  
**Objetivo:** transformar transcrições em afirmações verificáveis atribuídas aos participantes.

**Dependência:** INIT-01.

## LIVE-009 — Segmentação semântica

**Implementar**

Evoluir `speechSegments.ts` para agrupar frases completas considerando pausas, pontuação e continuidade do discurso.

**Aceite**

- [ ] Frases incompletas não são enviadas prematuramente.
- [ ] Segmentos preservam início e fim.
- [ ] Falas longas podem atravessar múltiplos blocos.
- [ ] A mudança de locutor é respeitada quando identificada.

**Complementos obrigatórios desta revisão**

- [ ] Contexto e segmento possuem referências versionadas, incluindo autores das falas adjacentes.
- [ ] Testa correção de pronome/resposta do adversário sem atribuir sua afirmação ao candidato atual.
- [ ] Discordância de locutor ou sobreposição pode bloquear a autoria sem impedir pesquisa factual de conteúdo íntegro.


## LIVE-010 — Diferenciação de locutores

**Implementar**

`backend/src/live/speakerIdentification.ts`

Integrar um adaptador de diarização acústica local qualificado em LIVE-000, com continuidade entre blocos e fallback para locutor desconhecido. Pyannote é uma opção sujeita a dependências, acesso ao modelo e benchmark.

**Aceite**

- [ ] Identifica diferentes locutores quando o modelo fornece evidência suficiente.
- [ ] Preserva IDs estáveis.
- [ ] Suporta participantes desconhecidos.
- [ ] Não transforma identificação incerta em autoria confirmada.
- [ ] Trata falas simultâneas como situação de incerteza.

**Complementos obrigatórios desta revisão**

- [ ] No MVP completo há inferência acústica e continuidade de IDs entre janelas, não apenas interface vazia ou IDs reiniciados por bloco.
- [ ] Identifica também mediador/vozes adicionais sem forçar exatamente dois locutores.
- [ ] Não infere identidade pelo conteúdo político ou alternância presumida de turnos.
- [ ] Retém apenas o buffer/representações necessários, com política de exclusão; calibra limiares no corpus de referência.
- [ ] Piloto com autoria desconhecida é permitido e declarado parcial; não aprova o requisito de autoria do MVP.


## LIVE-011 — Associação dos participantes

**Implementar**

Permitir associar IDs de locutores a nomes e corrigir atribuições.

**Aceite**

- [ ] Usuário consegue confirmar o mapeamento inicial.
- [ ] A associação vale para segmentos relacionados.
- [ ] Alterações atualizam as referências vinculadas.
- [ ] Falas sem identificação continuam processáveis.

**Complementos obrigatórios desta revisão**

- [ ] O mapeamento inicial exige confirmação; nome confirmado não transforma uma associação acústica incerta em certeza.
- [ ] Correções possuem revisão esperada e invalidam resultados/contextos dependentes via LIVE-040.
- [ ] Nome editorial fornecido manualmente e identidade atribuída por reconhecimento são distinguíveis na auditoria.


## LIVE-012 — Gerenciamento contextual

**Implementar**

`backend/src/live/contextManager.ts`

Manter uma janela contextual de transcrição, considerando falas anteriores, assunto, participantes e referências temporais.

**Aceite**

- [ ] Claims preservam contexto suficiente para interpretação.
- [ ] Pronomes e referências anteriores não são ignorados automaticamente.
- [ ] O contexto preserva os autores distintos das falas, inclusive quando usa a resposta do adversário.
- [ ] O sistema não depende apenas da memória conversacional atual do LangChain.

**Complementos obrigatórios desta revisão**

- [ ] A janela mantém locutor por fala e pode conter falas de candidatos diferentes sem fundi-las.
- [ ] Referências usadas no contexto integram o conjunto de dependências da investigação para invalidação.
- [ ] Não amplia a fala com permanência, exclusividade, responsabilidade ou intenção não demonstradas.


## LIVE-013 — Extração de claims

**Implementar**

Refatorar `backend/src/analysis/basicAnalysis.ts` para separar extração de afirmações e verificação factual.

**Aceite**

- [ ] Identifica afirmações factuais verificáveis.
- [ ] Ignora opiniões sem conteúdo factual verificável.
- [ ] Preserva o texto original da fala.
- [ ] Produz ID, participante, timestamps e contexto.
- [ ] Não emite vereditos durante a extração.
- [ ] Processa afirmações que atravessam segmentos.

**Complementos obrigatórios desta revisão**

- [ ] Faz triagem `NOT_FACT_CHECKABLE` separada de veredito; perguntas/opiniões não viram Inconclusiva.
- [ ] Cada proposição atômica tem verificação própria; a UI agrupa resultados sob a citação original.
- [ ] `originalQuote` é literal; `normalizedClaim` preserva sujeito, negação, período, quantidade, unidade e universo.
- [ ] Registra plano de prova antes da busca. Inferência de proposição implícita exige contexto e justificativa inspecionáveis.
- [ ] Não introduz rótulo preliminar que limite o veredito posterior.


## LIVE-014 — Deduplicação de claims

**Implementar**

`backend/src/live/claimDeduplication.ts`

Detectar repetições literais e paráfrases semanticamente equivalentes.

**Aceite**

- [ ] Repetições não geram pesquisas idênticas.
- [ ] Novas ocorrências continuam registradas.
- [ ] Afirmações substancialmente diferentes não são combinadas.
- [ ] O algoritmo possui testes para falsos positivos e falsos negativos.

**Complementos obrigatórios desta revisão**

- [ ] Reutiliza investigação equivalente, mas mantém ocorrências e autores individualizados.
- [ ] Mudança de data, quantia, unidade, universo, sujeito ou negação impede reúso indevido.
- [ ] Cache tem limites, validade e chave de revisão/contexto; paráfrase aproximada não basta para aprovar equivalência.


## LIVE-015 — Testes de identificação e extração

**Implementar**

Conjunto de fixtures com diálogos, interrupções, repetições e claims de diferentes complexidades.

**Aceite**

- [ ] Testa dois participantes e um mediador.
- [ ] Testa falas simultâneas.
- [ ] Testa afirmações incompletas.
- [ ] Testa claims repetidas.
- [ ] Testa trechos sem claims verificáveis.
- [ ] Verifica preservação de contexto e autoria.

**Complementos obrigatórios desta revisão**

- [ ] Testa erro em “não”, número e unidade; autoria desconhecida e correção de contexto.
- [ ] Testa o mesmo fato dito por autores diferentes, preservando ocorrências distintas.
- [ ] Avalia precisão/recall com corpus anotado, sem considerar fixtures puramente textuais como qualidade de diarização.


**Definition of Done — INIT-02**

O Veritas identifica claims relevantes, mantém sua relação com as falas originais e evita investigações duplicadas.

---

# INIT-03 — Evidence Engine

**Prioridade:** P0  
**Objetivo:** implementar verificação fundamentada, com contradições e evidências demonstráveis.

**Dependência:** contrato compartilhado antecipado em LIVE-001/LIVE-016, sem aguardar a INIT-02 completa.

Pode começar com entrada de texto e fixtures documentais revisadas. Mocks validam contratos e falhas, mas não aprovam qualidade factual nem disponibilidade dos provedores.

## LIVE-016 — Contrato estruturado de verificação

**Implementar**

Unificar os contratos do backend e do pacote `shared`, eliminando divergências entre schemas Zod.

Adicionar:

- Veredito.
- Conclusão.
- Contradição.
- Mecanismo enganoso.
- Contexto.
- Evidências.
- Limitações.
- Versão do resultado.

**Aceite**

- [ ] Backend e frontend usam contratos compatíveis.
- [ ] Todos os campos obrigatórios são validados.
- [ ] Verificação sem fontes pode ser representada como inconclusiva.
- [ ] Resultados possuem IDs e versões estáveis.
- [ ] Contratos anteriores continuam compatíveis ou possuem migração explícita.

**Complementos obrigatórios desta revisão**

- [ ] Adota o contrato normativo da especificação §10: uma afirmação atômica por verificação e resultados/revisões separados do estado operacional.
- [ ] `COMPLETED` admite quatro vereditos; `INCONCLUSIVE` nunca é estado operacional e `REVISED` é substituído por número/histórico de revisão.
- [ ] Valida evidências existentes, trechos inspecionados, referências e pré-condições de cada veredito.
- [ ] Snapshot/exportação/replay não contêm chaves, tokens ou áudio bruto.
- [ ] Validação estrutural não é apresentada como prova de que o raciocínio factual está correto.


## LIVE-017 — Refatorar Fact Checking Service

**Implementar**

`backend/src/service/factCheckService.ts`

Separar processamento de texto, extração de claims e investigação.

Corrigir a dependência atual do `reasoningConfidence > threshold` como gatilho de pesquisa.

**Aceite**

- [ ] Aceita claims individualmente.
- [ ] Preserva o fluxo manual.
- [ ] A investigação não depende apenas da autoconfiança do modelo.
- [ ] Suporta cancelamento.
- [ ] Erros não produzem resultados definitivos artificiais.

**Complementos obrigatórios desta revisão**

- [ ] Toda conclusão definitiva depende de documentos inspecionados; não basta inverter o comparador de confiança.
- [ ] Pesquisa pode revisar integralmente veredito/flags; a classificação preliminar não é preservada como autoridade.
- [ ] Falha técnica não vira texto “search unavailable” para gerar conclusão; erro, cota e falta de evidência são distintos.
- [ ] O modo Texto usa o mesmo motor e não interpreta ausência de `MISLEADING` como sustentação.
- [ ] Abort/timeout propagam até provedor; resultado de insumo supersedido é descartado.


## LIVE-018 — Adaptadores de IA e pesquisa

**Implementar**

Adaptadores para:

- Gemini, dentro das cotas gratuitas.
- LLM local compatível com API OpenAI (P1).
- Tavily no piloto; alternativas configuráveis no P1.

Adicionar monitoramento e limitação de consumo.

**Aceite**

- [ ] Provedores podem ser substituídos sem alterar o motor central.
- [ ] Limites de uso são respeitados.
- [ ] Cotas esgotadas geram estado explícito.
- [ ] É possível executar testes com mocks sem consumir APIs.
- [ ] Nenhum fluxo exige ativação automática de cobrança.

**Complementos obrigatórios desta revisão**

- [ ] Primeiro adaptador usa Gemini/Tavily já disponíveis; LLM local e outros buscadores são P1, sem bloquear piloto.
- [ ] Limites efetivos, estimativa de créditos por sessão e contadores de chamadas/retentativas são visíveis.
- [ ] Define orçamento máximo e comportamento `DEFERRED`/cota esgotada, sem cobrança automática.
- [ ] Conteúdo externo é dado não confiável e não pode alterar prompts do sistema, autorização ou ferramentas.


## LIVE-019 — Busca e normalização de evidências

**Implementar**

Evoluir `backend/src/analysis/deepResearch.ts`.

**Aceite**

- [ ] Recupera fontes relevantes.
- [ ] Prioriza dados e documentos primários quando disponíveis.
- [ ] Registra URL, título, datas e trecho relevante.
- [ ] Diferencia fonte acessível de fonte não verificada.
- [ ] Elimina fontes duplicadas.
- [ ] Preserva referências necessárias para auditoria.

**Complementos obrigatórios desta revisão**

- [ ] Snippet, título, URL e resposta de IA não são evidência documental suficiente.
- [ ] Inspeciona corpo relevante; guarda hash/versão ou snapshot permitido, coleta, localização e falhas por fonte.
- [ ] Não inventa publicação ausente; diferencia data de acesso, publicação e período do dado.
- [ ] Fontes partidárias/posicionadas são identificadas; não contam como autoridade única de intenção.
- [ ] Fontes reproduzidas não contam como confirmação independente; inferências do Veritas são separadas do texto do documento.


## LIVE-020 — Avaliação das evidências

**Implementar**

`backend/src/analysis/evidenceEvaluation.ts`

**Aceite**

- [ ] Classifica evidências como apoio, contradição ou contexto.
- [ ] Verifica período e universo de comparação.
- [ ] Identifica fontes incompatíveis.
- [ ] Diferencia fato documentado de inferência.
- [ ] Não considera uma URL, isoladamente, como prova suficiente.
- [ ] Registra limitações encontradas.

**Complementos obrigatórios desta revisão**

- [ ] Cada avaliação vincula uma evidência a uma afirmação atômica e contém explicação localizada.
- [ ] Conclusão, aspectos sustentados, contradição e mecanismo possuem referências próprias.
- [ ] Documentos divergentes não são resolvidos por maioria simples de URLs.
- [ ] Detecta extrapolação da fala (ex.: presumir piso permanente a partir de aumento temporal) e bloqueia interpretação não demonstrada.


## LIVE-021 — Contradições e mecanismos enganosos

**Implementar**

- `contradictionDetection.ts`
- `misleadingMechanism.ts`

Mecanismos iniciais:

- Falsa atribuição de autoria.
- Omissão relevante.
- Dado real atribuído ao universo errado.
- Comparação incompatível.
- Causalidade não demonstrada.
- Período inadequado.
- Generalização indevida.
- Seleção parcial de dados.

**Aceite**

- [ ] Contradições identificam precisamente o conflito factual.
- [ ] Cada conflito aponta para evidências específicas.
- [ ] Mecanismos enganosos possuem justificativa.
- [ ] Não presume intenção deliberada de mentir.
- [ ] Permite múltiplos mecanismos quando sustentados.

**Complementos obrigatórios desta revisão**

- [ ] Usa os códigos da especificação §8, incluindo `PROGRAM_CONFLATION` e `MISATTRIBUTED_AGGREGATE`.
- [ ] Mecanismos são opcionais fora de Enganosa e não precisam ser todos implementados por pipelines independentes.
- [ ] Contradição não é inventada em Sustentada; mesma regra vale para qualquer candidato.


## LIVE-022 — Geração de vereditos

**Implementar**

`backend/src/analysis/verdictGeneration.ts`

Vereditos:

- Sustentada.
- Falsa.
- Enganosa.
- Inconclusiva.

**Aceite**

- [ ] Veredito falso exige contradição fundamentada.
- [ ] Veredito enganoso exige demonstração da distorção relevante.
- [ ] Veredito sustentado delimita escopo e período.
- [ ] Evidências insuficientes resultam em inconclusivo.
- [ ] Explicação é curta e compreensível.
- [ ] Referências permanecem vinculadas à conclusão.

**Complementos obrigatórios desta revisão**

- [ ] `FALSE` exige proposição decisiva e evidência `REFUTES`; `SUPPORTED` exige prova direta no escopo da fala.
- [ ] `MISLEADING` exige parte verdadeira e distorção material demonstrada no contexto, sem inserir alegação implícita arbitrária.
- [ ] Inconclusiva representa insuficiência após investigação válida; dúvida crítica de fala/contexto é `BLOCKED`, falha operacional é `FAILED`.
- [ ] Não emite percentual de verdade nem converte confiança do LLM em certeza factual.


## LIVE-023 — Fila assíncrona de verificações

**Implementar**

`backend/src/live/claimQueue.ts`

**Aceite**

- [ ] Múltiplas claims podem ser investigadas.
- [ ] Existe limite configurável de concorrência.
- [ ] Pesquisas não bloqueiam transcrição.
- [ ] Cache evita trabalho repetido.
- [ ] Implementa timeout e retry limitado.
- [ ] Cancelar a sessão aborta tarefas pendentes e propaga cancelamento às ativas; respostas tardias são descartadas.
- [ ] Falha individual não interrompe a fila inteira.

**Complementos obrigatórios desta revisão**

- [ ] Limita concorrência, profundidade, espera e orçamento por sessão; mede p95 incluindo espera.
- [ ] Prioriza verificabilidade/relevância por critérios documentados, sem favorecer participante ou provável veredito.
- [ ] Excesso fica visível como `DEFERRED`, com razão e política de reentrada; nenhuma claim desaparece.
- [ ] Distingue erro transitório, quota, timeout e cancelamento; usa backoff/retry limitado apenas quando apropriado.
- [ ] Encerramento normal pode drenar trabalhos aceitos; cancelamento interrompe pendentes e ativos.
- [ ] Testa chegada de claims acima da capacidade e mantém captura/transcrição utilizáveis.


## LIVE-024 — Suíte de avaliação factual

**Implementar**

Fixtures com afirmações reais e documentação de referência.

Casos iniciais:

- Origem do Pix.
- Auxílio Brasil de R$ 600.
- Despesas de viagens federais.

Incluir também casos sustentados, inconclusivos e afirmações semelhantes feitas por diferentes participantes.

**Aceite**

- [ ] Cada caso possui referências independentes.
- [ ] Contradições esperadas estão documentadas.
- [ ] Testes verificam coerência entre fontes e conclusões.
- [ ] Os mesmos critérios são aplicados a todos os participantes.
- [ ] Erros de pesquisa não geram vereditos inventados.
- [ ] A verificação manual passa nos testes de regressão.

**Complementos obrigatórios desta revisão**

- [ ] Separa reprodução do corpus documental congelado de busca ao vivo; ambos têm relatórios próprios.
- [ ] Inclui Sustentada sem ressalva artificial, Inconclusiva documental, `FAILED`, `BLOCKED`, documento divergente e múltiplas proposições.
- [ ] O caso R$ 600 possui variantes literal/temporária/permanente e não impõe Enganosa sem demonstrar a interpretação.
- [ ] O caso viagens preserva texto literal e separa a anotação editorial “[Lula]” da citação.
- [ ] Rótulos editoriais dos exemplos são hipóteses revisáveis, não respostas que o modelo deva memorizar.
- [ ] Fontes indiretas e consultas oficiais ainda não reproduzidas são marcadas; não promover leitura de checagem secundária a auditoria da base primária.


**Definition of Done — INIT-03**

O Veritas consegue produzir resultados contextualizados, com contradições demonstráveis e evidências rastreáveis.

---

# INIT-04 — Live Experience

**Prioridade:** P0 para UI desktop, revisões e exportação da sessão corrente; P1 para mobile, histórico durável e acompanhamento em outro dispositivo.

**Objetivo:** integrar o novo motor à experiência do Veritas Live.

**Dependências:** contratos LIVE-001/LIVE-016 para construir a UI; integração real depende das partes pertinentes de INIT-01/02/03, sem exigir que todas estejam completas.

## LIVE-025 — Entrada e controles definitivos

**Implementar**

Integrar o protótipo de referência ao Design System existente, aplicando as regras editoriais revisadas.

**Aceite**

- [ ] Modos Texto e Áudio disponíveis.
- [ ] Captura pode ser iniciada e encerrada pela interface.
- [ ] Estados são claros.
- [ ] Erros e permissões possuem feedback.
- [ ] Não há regressão no modo Texto.

**Complementos obrigatórios desta revisão**

- [ ] Protótipo é referência visual, não comprovação funcional nem aprovação editorial dos rótulos.
- [ ] Usa os componentes iniciais de LIVE-007; não exige reescrever a experiência inteira antes da fatia integrada.
- [ ] Microfone e captura mobile ficam fora do piloto; não mostrar opção funcional sem suporte implementado e qualificado.
  - **Atualização 2026-10-23:** substituído por decisão do usuário — a entrada usa o microfone (seletor de dispositivo + consentimento); captura de aba removida. Mobile segue fora do piloto.


## LIVE-026 — Painel de transcrição

**Implementar**

Transcrição contínua com participantes, timestamps e destaques de claims.

**Aceite**

- [ ] Exibe texto parcial e definitivo.
- [ ] Mostra participante quando identificado.
- [ ] Destaca claims detectadas.
- [ ] Permite navegar até a verificação correspondente.
- [ ] Correções de transcrição atualizam o trecho existente.

**Complementos obrigatórios desta revisão**

- [ ] Mostra hipóteses, autoria/estado de atribuição e referências de tempo sem confundir horário de fala e processamento.
- [ ] Corrigir fala abre revisão; conflito de versão é sinalizado e não sobrescreve correção concorrente.
- [ ] Lacunas, dúvidas críticas e transcrição bloqueada são visíveis.


## LIVE-027 — Timeline e cards de verificação

**Implementar**

Atualizar `ResultsPage.tsx` e `ResultsPanel.tsx`.

Estrutura dos cards:

1. Afirmação.
2. Veredito.
3. Conclusão.
4. Onde está a contradição?
5. Como induz ao erro?
6. Evidências.
7. Contexto e limitações.

**Aceite**

- [ ] Resultados aparecem progressivamente.
- [ ] A contradição tem destaque visual em Falsa; os demais vereditos exibem o confronto pertinente sem forçar contradição.
- [ ] Fontes podem ser consultadas.
- [ ] Informações adicionais podem ser expandidas.
- [ ] Claims em investigação não parecem concluídas.
- [ ] A interface mantém a identidade do Veritas.

**Complementos obrigatórios desta revisão**

- [ ] Implementa as três camadas da especificação: resumo, explicação e auditoria documental.
- [ ] Falsa destaca conflito; Enganosa destaca fato verdadeiro + distorção; Sustentada não força contradição; Inconclusiva diz o que faltou.
- [ ] Uma fala com proposições distintas mostra vereditos individuais, sem agregar um rótulo único indevido.
- [ ] Cards antigos ficam explicitamente superados após correção; conclusão corrente só reaparece ao concluir a nova tentativa.
- [ ] Fontes mostram trechos, localização, período, acesso e limites; nenhum percentual de verdade é exibido.


## LIVE-028 — Estado reativo e sincronização

**Implementar**

Atualizar:

- `factCheckStore.ts`
- `factCheckService.ts`
- Eventos Socket.IO.

**Aceite**

- [ ] Resultados são atualizados por ID.
- [ ] Eventos repetidos não criam cards duplicados.
- [ ] Revisões antigas não sobrescrevem resultados mais recentes.
- [ ] Navegação não reinicia automaticamente a verificação.
- [ ] Reconexões não duplicam o processamento.

**Complementos obrigatórios desta revisão**

- [ ] Faz upsert por ID/revisão, nunca append cego; ignora evento antigo, duplicado ou de outra sessão.
- [ ] Recupera por snapshot/cursor dentro da mesma instância, inclusive eventos de invalidação.
- [ ] Distingue `ENDING`/drenagem de pesquisa de captura encerrada; navegação não encerra ou reinicia trabalho silenciosamente.
- [ ] Não infere veredito por flags ausentes e aplica a mesma regra ao modo Texto.


## LIVE-029 — Persistência e histórico

**Prioridade:** P1

**Implementar**

SQLite para sessões, participantes, segmentos, claims e resultados.

**Aceite**

- [ ] Sessões podem ser consultadas posteriormente.
- [ ] Claims preservam referência às falas.
- [ ] Evidências permanecem associadas ao resultado.
- [ ] Revisões são rastreáveis.
- [ ] Existe política de retenção e exclusão.
- [ ] Áudio não é armazenado permanentemente por padrão.

**Complementos obrigatórios desta revisão**

- [ ] Esta tarefa trata histórico durável P1; revisões da sessão corrente/exportação P0 pertencem a LIVE-006/028/040.
- [ ] Retomada após restart só é anunciada quando persistência de sessão, replay e tarefas realmente suportarem isso; SQLite isoladamente não garante execução durável.


## LIVE-030 — Experiência mobile

**Implementar**

Layout responsivo para transcrição e verificações.

**Aceite**

- [ ] Interface funciona em telas pequenas.
- [ ] Transcrição e verificações possuem navegação por abas.
- [ ] Controles são acessíveis por toque.
- [ ] Cards não exigem rolagem horizontal.
- [ ] Informações expandidas permanecem legíveis.

**Complementos obrigatórios desta revisão**

**Prioridade específica:** P1 para adaptação mobile completa; desktop acessível continua P0.


## LIVE-031 — Acompanhamento entre dispositivos

**Prioridade:** P1

**Implementar**

Permitir acompanhar no celular uma sessão iniciada no desktop.

**Aceite**

- [ ] Sessão possui identificador compartilhável.
- [ ] Acesso é protegido por autorização.
- [ ] O celular recebe atualizações ao vivo.
- [ ] Reconexões recuperam o estado atual.
- [ ] Visualizadores não recebem permissões de controle indevidas.

**Complementos obrigatórios desta revisão**

- [ ] Fica fora do gate do piloto/MVP desktop; exige autorização e replay próprios antes da entrega P1.


## LIVE-032 — Testes de experiência

**Implementar**

Testes de integração e acessibilidade.

**Aceite**

- [ ] Jornada completa de captura e verificação funciona.
- [ ] Navegação claim ↔ transcrição funciona.
- [ ] Estados vazios, erros e carregamento são testados.
- [ ] Desktop e mobile são verificados.
- [ ] Navegação por teclado e anúncios acessíveis são testados.
- [ ] O modo de texto não apresenta regressões.

**Complementos obrigatórios desta revisão**

- [ ] Desktop, teclado, leitores de tela, revisão, autoria desconhecida e erro de fonte são P0; mobile completo é P1.
- [ ] Resultados e revisões são navegáveis sem depender apenas de cor; anúncios ao vivo não leem novamente a transcrição inteira a cada bloco.


**Definition of Done — INIT-04**

O fluxo desktop funciona na interface e apresenta resultados e revisões conforme a especificação. Navegação mobile completa é P1.

---

# INIT-05 — Quality, Reliability & Optimization

**Prioridade:** P0 para validação e segurança do MVP.

**Objetivo:** demonstrar confiabilidade e estabilidade antes de uso público.

**Dependência:** contratos e primeiros componentes; testes de cada etapa começam imediatamente e o fluxo integrado é exigido nos gates finais.

Os testes de cada componente devem começar nas fases anteriores.

## LIVE-033 — Avaliação da transcrição

**Implementar**

Corpus de áudio de referência e ferramentas de medição.

**Aceite**

- [ ] Mede Word Error Rate.
- [ ] Avalia nomes próprios, números, datas e percentuais.
- [ ] Testa ruídos e interrupções.
- [ ] Mede latência de transcrição.
- [ ] Registra limitações do modelo e hardware.

**Complementos obrigatórios desta revisão**

- [ ] Metas/corpus aprovados no LIVE-000; mede erros críticos além do WER global.
- [ ] Registra referências de mídia, janela, modelo/hardware e duração; não confunde áudio sintético com debate real.


## LIVE-034 — Avaliação de locutores e claims

**Implementar**

Testes de diarização, associação e extração.

**Aceite**

- [ ] Mede erros de atribuição de participantes.
- [ ] Mede precisão e recall da extração.
- [ ] Mede taxa de claims duplicadas.
- [ ] Avalia perda de contexto.
- [ ] Inclui interrupções e falas simultâneas.

**Complementos obrigatórios desta revisão**

- [ ] Mede cobertura de autoria confirmada, desconhecida e erro entre vozes atribuídas, com denominadores/amostras.
- [ ] Separa diarização, associação aos nomes e extração de claims.
- [ ] Desempenho abaixo do gate impede declarar autoria automática pronta; fallback desconhecido não conta como acerto.


## LIVE-035 — Avaliação de evidências e vereditos

**Implementar**

Suíte de avaliação factual, com revisão humana dos resultados amostrados.

**Aceite**

- [ ] Mede percentual de evidências pertinentes.
- [ ] Mede conclusões sem suporte suficiente.
- [ ] Registra correções de vereditos.
- [ ] Avalia contradições e mecanismos enganosos.
- [ ] Testa casos políticos de diferentes participantes com critérios equivalentes.
- [ ] Separa erro factual de divergência interpretativa.

**Complementos obrigatórios desta revisão**

- [ ] Avalia pertinência, fidelidade do trecho, suficiência e coerência conclusão → prova com revisão independente.
- [ ] Reporta resultados por participante, tipo de proposição e veredito, com cobertura e tamanho da amostra.
- [ ] Alterar o nome do autor não deve alterar a avaliação de um fato idêntico; não impor paridade artificial de falsos/verdadeiros.
- [ ] Nenhum teste com resposta fixa do LLM é apresentado como avaliação factual real.


## LIVE-036 — Performance e consumo

**Implementar**

Instrumentação e teste contínuo de carga.

**Aceite**

- [ ] Mede latência de cada etapa.
- [ ] Mede tempo mediano e p95 das verificações.
- [ ] Mede uso de CPU e memória.
- [ ] Monitora profundidade da fila.
- [ ] Registra consumo das cotas gratuitas.
- [ ] Executa teste contínuo representativo.
- [ ] Documenta os limites do ambiente.

**Complementos obrigatórios desta revisão**

- [ ] Usa metas provisórias do PRD e registra p50/p95 por etapa, profundidade/espera da fila e créditos/calls.
- [ ] Calcula capacidade sustentável conforme duração por claim e concorrência; simula chegada acima dessa capacidade.
- [ ] Ensaio ≥ 2 h tem relatório de lacunas, erros, consumo e crescimento de memória; cumpre LIVE-041.


## LIVE-037 — Resiliência e recuperação

**Implementar**

Testes de falhas e recuperação de processos.

**Aceite**

- [ ] Queda de conexão é tratada.
- [ ] Interrupção da captura é sinalizada.
- [ ] Falha do transcritor não gera perda silenciosa.
- [ ] Falha de pesquisa não bloqueia outras claims.
- [ ] Esgotamento de cota é tratado.
- [ ] Cancelamentos liberam recursos.
- [ ] Eventos duplicados e fora de ordem não corrompem o estado.

**Complementos obrigatórios desta revisão**

- [ ] Testa revisão de insumo durante pesquisa, conflito de edição, replay de invalidação e resultado tardio descartado.
- [ ] Testa desconexão na mesma instância separadamente de restart/expiração; não promete continuidade impossível.
- [ ] Testa encerramento com drenagem versus cancelamento imediato e última frase ainda parcial.


## LIVE-038 — Segurança e privacidade

**Implementar**

Revisão e correções de segurança no frontend e backend.

**Aceite**

- [ ] API keys não aparecem em logs.
- [ ] Mensagens Socket.IO são validadas.
- [ ] Origens permitidas são restritas.
- [ ] Sessões compartilhadas exigem autorização.
- [ ] Existem limites de requisições e consumo.
- [ ] Credenciais não são persistidas desnecessariamente em texto puro.
- [ ] Retenção e exclusão de dados são documentadas.
- [ ] O tratamento de dados capturados respeita as permissões aplicáveis.

**Complementos obrigatórios desta revisão**

- [ ] Inicia antes da primeira integração: remove log de requisição que inclui API keys e impede vazamento em erros.
- [ ] Aplica parse runtime, limites binários, autorização de sessão e origens permitidas; CORS não é autorização.
- [ ] Snapshots, revisões, exportações e métricas são sanitizados.
- [ ] Áudio não é persistido por padrão; retenção de representações de voz também é explícita.
- [ ] Não altera `.env`/`.env.local` do usuário para implementar o setup.
- [ ] Documento/transcrição não pode injetar comandos; fetch direto aplica política de URL/destino e limites.


## LIVE-039 — Validação final e documentação

**Implementar**

Checklist de release, documentação operacional e relatório dos resultados.

**Aceite**

- [ ] Testes críticos estão aprovados.
- [ ] Critérios das cinco iniciativas foram verificados.
- [ ] Regressões da verificação manual foram avaliadas.
- [ ] Limites de precisão são documentados.
- [ ] Limites de hardware e serviços gratuitos estão documentados.
- [ ] Problemas conhecidos e riscos residuais são registrados.
- [ ] A release possui evidências de revisão independente.

**Complementos obrigatórios desta revisão**

- [ ] Relatório distingue gates do piloto, autoria automática do MVP e P1; itens P1 pendentes não invalidam o MVP desktop.
- [ ] Mantém pendentes os critérios sem evidência, registrando responsável, comando/corpus, data e resultado.
- [ ] Aprovação independente não é substituída por testes verdes, mocks, autoconfiança do modelo ou edição destes documentos.


**Definition of Done — INIT-05**

O Veritas Live possui resultados de qualidade mensurados, comportamento seguro diante de falhas e limites operacionais conhecidos.

---

# LIVE-040 — Revisões, invalidação e auditoria da sessão corrente

**Prioridade:** P0. **Dependências:** LIVE-001/016; integra LIVE-005/011/012/017/028. Histórico SQLite não é pré-requisito.

**Implementar**

Tentativas de investigação e resultados imutáveis referenciam revisões dos segmentos, contexto, afirmação atômica e associação de autoria. Correções produzem revisão e invalidam conclusões dependentes. Reter e exportar histórico sanitizado durante a sessão dentro dos limites publicados.

**Aceite**

- [ ] Edição compara revisão esperada e rejeita conflito.
- [ ] Mudança de número/negação/sujeito, autoria ou contexto invalida todo resultado dependente; correção puramente tipográfica tem decisão documentada.
- [ ] Cancela/reinicia investigação quando necessário; resultado tardio de versão antiga não se torna corrente.
- [ ] Exibe motivo, horário e diferença entre tentativas, mantendo a fala original histórica.
- [ ] Revisão humana e checagem automática são registros distintos.
- [ ] Replay/snapshot incluem invalidação e versão corrente, sem ressuscitar veredito antigo.
- [ ] Exportação vincula fala → claim → documento/trecho → conclusão, sem áudio/credenciais por padrão.
- [ ] Retenção/expiração e indisponibilidade após restart estão documentadas e testadas.

---

# LIVE-041 — Gate do piloto integrado e ensaio prolongado

**Prioridade:** P0. **Dependências:** qualificação LIVE-000 e subconjunto P0 integrado descrito na seção 13.

**Implementar**

Ensaio real de captura → transcrição → claim → fila → inspeção de documentos → resultado em três camadas, incluindo correção e falhas. Consolidar o relatório que habilita ou impede o piloto experimental. Não confundir aprovação deste piloto com autoria automática ou MVP completo.

**Aceite**

- [ ] Executa ≥ 2 h de gravação de debate representativa no ritmo real da reprodução.
- [ ] Realiza ao menos uma verificação completa com provedores reais; resultados mockados têm relatório separado.
- [ ] Mede p50/p95 e capacidade sustentável incluindo espera de fila, consumo e memória.
- [ ] Testa fonte indisponível, cota, transcrição crítica, sobreposição, saturação, queda de conexão e correção durante pesquisa.
- [ ] Mantém autoria desconhecida visível se não qualificada; isso não aprova LIVE-010/034.
- [ ] Demonstra o último trecho e pesquisas em andamento ao encerrar/drenar/cancelar.
- [ ] Evidências e resultado amostrados passam por revisão independente.
- [ ] Publica GO/NO-GO fundamentado, limitações e pendências; prazo do debate não altera o gate.

---

# 11. Dependências e execução paralela

## Caminho de execução

1. LIVE-000 qualifica os caminhos técnicos; LIVE-001/LIVE-016 estabelecem os contratos únicos; LIVE-038 começa pelas falhas críticas existentes.
2. LIVE-017/019/020/022/024 validam o motor compartilhado com texto e documentos reais/fixtures independentes.
3. LIVE-002–009/012/013, LIVE-023 e LIVE-025–028 integram o primeiro percurso completo. LIVE-040 acompanha desde os primeiros insumos versionados.
4. LIVE-010/011/014/015 e LIVE-033–037 consolidam autoria, extração, qualidade e capacidade.
5. LIVE-041 libera ou bloqueia o piloto; LIVE-039 registra separadamente o aceite do MVP completo.
6. LIVE-029/030/031 e provedores adicionais de LIVE-018 são P1.

Áudio, motor documental e UI podem ser desenvolvidos em trilhas independentes após os contratos. 

## Pontos de integração obrigatórios

| Marco | Componentes | Evidência exigida |
|---|---|---|
| M0 | Fonte → áudio/transcrição local | Qualificação no ambiente real |
| M1 | Texto → claim → documento → resultado | Contratos + inspeção de documento + avaliação |
| M2 | Captura → transcrição → claim | Áudio real, autoria preservada/desconhecida explícita |
| M3 | Claim → fila → documento → cartão | Percurso real integrado, sem bloqueio da captura |
| M4 | Correção → invalidação → nova conclusão | Revisões, cancelamento e resultado tardio |
| M5 | Ensaio ≥ 2 h → piloto | Métricas, falhas e revisão independente |
| M6 | Diarização contínua → nomes confirmados → MVP | Corpus com erro/cobertura de autoria mensurados |
| M7 | Histórico durável e outro dispositivo | P1: autorização, persistência e replay comprovados |

Mocks permitem construir/testar componentes, mas nenhum marco de capacidade real é aprovado só com dados mockados.

---

# 12. Rastreabilidade dos critérios do PRD

| Requisito original | Tarefas responsáveis |
|---|---|
| Captura de áudio autorizada | LIVE-002, 003, 008 |
| Transcrição contínua e timestamps | LIVE-004, 005, 008 |
| Início, pausa, retomada e encerramento | LIVE-006, 007 |
| Participantes identificados ou sinalizados como desconhecidos | LIVE-010, 011, 034 |
| Extração de afirmações verificáveis | LIVE-009, 012, 013 |
| Ausência de claims duplicadas | LIVE-014, 015, 028 |
| Pesquisa independente da transcrição | LIVE-017, 023 |
| Evidências verificáveis | LIVE-019, 020, 035 |
| Contradições explícitas | LIVE-021, 022 |
| Vereditos sem evidências inventadas | LIVE-020, 022, 024 |
| Resultados progressivos e nova interface | LIVE-026, 027, 028 |
| Preservar o modo Texto | LIVE-007, 017, 025, 032 |
| Histórico persistente | LIVE-029 |
| Interface mobile | LIVE-030 |
| Acompanhamento entre dispositivos | LIVE-031 |
| Estabilidade e performance | LIVE-033, 036, 037 |
| Segurança e privacidade | LIVE-001, 018, 031, 038 |
| Vereditos atômicos e três camadas | LIVE-013, 016, 020, 022, 027 |
| Correções e revisões de insumos | LIVE-005, 011, 012, 028, 040 |
| Qualificação inicial e gate do piloto | LIVE-000, 008, 036, 041 |
| Limites de fila, orçamento e atraso | LIVE-018, 023, 036 |
| Validação final do MVP | LIVE-034, 035, 039 |

---

# 13. Ordem recomendada de implementação

| Entrega | Tarefas/partes obrigatórias | O que permite afirmar |
|---|---|---|
| Qualificação/fundação | LIVE-000, 001, 016 e correções críticas 017/038 | Ambiente e contratos demonstrados |
| Motor por texto | LIVE-013, 017–024, 027/028, 035 e 040 pertinentes | Verificação documental compartilhada validada |
| Primeira fatia ao vivo | LIVE-002–009, 012/013, 023, 025–028 e 040 | Captura até resultado real, ainda experimental |
| Gate do piloto | Partes críticas de LIVE-015/024/032–038 + LIVE-041 | Piloto experimental dentro dos limites registrados |
| MVP completo | Demais critérios P0, incluindo LIVE-010/011/014/034 e LIVE-039 | Autoria contínua e qualidade qualificadas |
| Evoluções | LIVE-029/030/031 e múltiplos provedores de 018 | Histórico durável e uso mobile |

A tabela não marca tarefas parcialmente realizadas como concluídas: registrar quais critérios foram satisfeitos e quais permanecem pendentes. Segurança, testes, acessibilidade e instrumentação acompanham cada entrega. Funções pequenas podem compartilhar implementação; separação conceitual não exige uma chamada de LLM por módulo.

## 14. Critério de conclusão do projeto

**Piloto experimental:** LIVE-041 aprovado, captura/transcrição/extração/pesquisa automáticas, resultados documentados na UI, revisão versionada e limites de operação claros. Se a autoria depender de atribuição manual por fala, essa capacidade permanece pendente.

**MVP completo:** todos os critérios P0 aplicáveis das cinco iniciativas e LIVE-040 atendidos, com revisão independente em LIVE-039. Após permissão e mapeamento inicial de vozes, o sistema deve:

- Capturar e transcrever continuamente.
- Reconhecer locutores ao longo da sessão, sinalizando dúvida sem inventar autoria.
- Extrair proposições atômicas com citação/contexto preservados.
- Pesquisar e inspecionar documentos sem bloquear a captura.
- Explicar a conclusão e, quando demonstradas, contradição/distorção.
- Mostrar progresso, saturação, falhas, revisões e evidências auditáveis.
- Preservar o modo Texto e operar dentro de orçamento/hardware documentados.
- Tratar falhas sem conclusões artificiais; distinguir encerramento, drenagem e cancelamento.

Histórico durável, mobile e descoberta automática de nomes sem associação inicial são P1. Não há compromisso de disponibilidade no debate de 23/10/2026 sem evidências dos gates.

**Princípio de qualidade:** a validação estrutural é necessária, mas não demonstra veracidade. A confiança do produto depende do vínculo entre fala, proposição, documento, trecho e conclusão, com avaliação factual independente.
