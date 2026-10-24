# Veritas Live — Especificação dos resultados de verificação

**Versão:** 1.1  
**Data:** 23 de outubro de 2026  
**Tipo:** Especificação funcional, editorial, de UX e de contratos técnicos  
**Documentos relacionados:** [PRD Veritas Live v1.2](veritas-live-prd.md) e [Plano técnico v1.1, LIVE-000–LIVE-041](veritas-live-iniciativas-e-tarefas.md)
**Status:** Contratos e pipeline parcialmente implementados; qualidade factual e aceite ainda pendentes

> **Objetivo:** estabelecer como o Veritas transforma uma afirmação capturada em áudio ou recebida como texto em um resultado claro, verificável e contextualizado. Os três estudos de caso principais usam falas reais; a redação dos cartões é uma **proposta de apresentação do Veritas**, não uma reprodução literal dos textos das agências de checagem.

---

## 1. Princípio do produto

O Veritas não deve se limitar a responder **"verdadeiro" ou "falso"**, nem amenizar uma contradição demonstrada com contexto excessivo.

O resultado deve responder, nesta ordem:

1. **O que foi afirmado?** — trecho original, autoria e momento da fala.
2. **O que a verificação concluiu?** — veredito direto, com escopo claro.
3. **Onde está a prova ou contradição?** — fato específico confrontado com a fala.
4. **Como a afirmação pode induzir ao erro?** — mecanismo demonstrável, quando houver.
5. **Como posso conferir?** — evidências, fontes, datas, métodos e limitações.

**Regra editorial:** ser conclusivo quando houver prova, cauteloso quando não houver e sempre explícito sobre a diferença entre um erro factual e intenção de enganar. Um rótulo de *falso* não significa afirmar que o autor mentiu deliberadamente.

### O que deve mudar em relação ao código atual

- `basicAnalysis.ts` deve **extrair** afirmações, sem decidir veracidade com base apenas na inferência do modelo.
- `deepResearch.ts` deve **recuperar evidências** verificáveis e registrar sua proveniência, em vez de entregar apenas uma síntese de texto e URLs.
- `factCheckService.ts` deve separar coleta, investigação, confronto documental e redação do resultado; o gatilho atual de pesquisa baseado em `reasoningConfidence > threshold` não pode determinar sozinho se uma claim recebe pesquisa.
- Os schemas compartilhados devem incluir **contradição, unidade da evidência, mecanismo, limites e revisão**.
- A interface não pode interpretar a ausência de `MISLEADING` como afirmação verificada; o estado do processamento e o veredito precisam ser campos distintos.

---

## 2. Estrutura da experiência

### 2.1 Camada 1 — Cartão resumido (visível por padrão)

O usuário deve compreender o achado principal sem abrir detalhes.

```text
[PARTICIPANTE]                       [HORÁRIO DA FALA]
“Trecho exato da afirmação…”

[FALSO]  A alegação conflita com registros anteriores à gestão citada.

ONDE ESTÁ A CONTRADIÇÃO?
O projeto já estava formalizado em 2018; o governo referido
começou em 2019.

[Ver como induz ao erro]          [Ver provas e fontes]
```

**Requisitos:** uma frase de conclusão, linguagem simples, autoria confirmada ou explicitamente desconhecida e horário. Contradição concreta é obrigatória em Falsa; em Sustentada mostrar o fato comprovado, em Enganosa o fato verdadeiro e a distorção material, e em Inconclusiva o que falta verificar. A conclusão deve ser específica: “o valor corresponde a todos os órgãos federais”, não “há falta de contexto”.

### 2.2 Camada 2 — Explicação expandida

Abrir mediante interação:

- **Fato alegado × fato documentado:** confronto direto, idealmente de duas colunas.
- **Como induz ao erro:** mecanismo com justificativa; não fazer inferências sobre a intenção psicológica do autor.
- **Linha do tempo / comparação:** apenas quando acrescentar prova relevante.
- **O que é correto na fala:** reconhecer partes sustentadas sem neutralizar a contradição.
- **O que permanece incerto:** limite explícito da investigação.

### 2.3 Camada 3 — Evidências e auditoria

Cada evidência deve ter fonte identificável, link, data de publicação quando disponível, data de acesso, trecho relevante, relação com a claim e, preferencialmente, localização exata no documento.

O usuário deve conseguir distinguir:

- O que **o documento afirma**.
- O que **o Veritas infere a partir do documento**.
- O que **a fonte não permite concluir**.

### 2.4 Comportamento de atualização em transmissão ao vivo

Antes da investigação ser concluída, nunca mostrar um veredito definitivo:

`DETECTED → QUEUED → RESEARCHING → EVALUATING → COMPLETED`

Estados operacionais alternativos: `BLOCKED` (insumo/contexto crítico incerto), `FAILED` (falha técnica), `CANCELLED` e `DEFERRED` (sem capacidade/cota). `INCONCLUSIVE` é um **veredito de investigação concluída**, não um estado operacional. Revisão é um número e histórico, não um estado `REVISED`.

Correção de fala, contexto, autoria ou evidência invalida o resultado corrente dependente. A UI conserva a versão anterior como **superada**, sem apresentá-la como conclusão vigente durante a nova tentativa. Eventos antigos, inclusive pesquisas em trânsito, não podem restaurar vereditos invalidados.

P0 retém revisões na sessão corrente e permite exportação sanitizada. Persistência durável e recuperação após reinício são P1; a reconexão P0 limita-se à mesma instância, com retenção e limites explícitos.

---

## 3. Taxonomia dos vereditos

| Veredito | Quando usar | Exigência mínima | Exemplo de redação |
|---|---|---|---|
| **SUSTENTADA** | O núcleo da afirmação é confirmado no período e escopo relevantes. | Evidências identificáveis que sustentam diretamente o núcleo. | “O valor informado confere para 2020.” |
| **FALSA** | Uma parte factual decisiva é contradita por evidências suficientes. | Identificar **qual proposição** é contrariada e por **qual prova**. | “O projeto não começou nesse governo: já estava formalizado em 2018.” |
| **ENGANOSA** | Há um fato verdadeiro, mas uma omissão, enquadramento ou comparação altera materialmente seu significado. | Demonstrar fato verdadeiro + informação omitida/trocada + consequência interpretativa. | “O aumento ocorreu, mas era temporário e não foi mantido na proposta orçamentária seguinte.” |
| **INCONCLUSIVA** | Não foi possível demonstrar apoio ou contradição em grau suficiente. | Registrar buscas feitas, insuficiências e a questão em aberto. | “Não encontramos registros públicos suficientes para confirmar a quantia atribuída.” |

**Separar de veredito:** `NOT_FACT_CHECKABLE` é uma condição de triagem (opinião, promessa futura, juízo de valor etc.) e não deve ser apresentado como “inconclusivo”, pois não houve uma verificação factual frustrada.

**Casos mistos:** uma fala pode originar várias afirmações atômicas, cada uma com investigação e veredito próprios. A interface agrupa os resultados sob a citação original e pode indicar “contém afirmações falsas”, desde que mostre qual proposição foi contrariada. O contrato não permite um único veredito para uma lista de proposições independentes.

**Interpretações implícitas:** registrar separadamente a interpretação, os trechos de contexto que a motivam e a justificativa. Não acrescentar permanência, exclusividade, causalidade ou intenção à normalização apenas porque isso facilitaria uma refutação. Se houver ambiguidade decisiva sem resolução, bloquear essa interpretação ou concluir Inconclusiva sobre a proposição investigável; não inventar uma formulação mais forte.

**Sem percentual de verdade:** não exibir notas como “72/100” nem transformar confiança do LLM em certeza factual. Registrar internamente a qualidade das evidências, o nível de cobertura e o estado da revisão.

---

## 4. Estudo de caso A — Origem do Pix

### 4.1 Afirmação documentada

> “O nosso governo, via Banco Central, teve a ideia de criar o Pix.”

**Autor:** Jair Bolsonaro. **Contexto:** entrevista ao programa do Ratinho (SBT), **13/09/2022**. A declaração e sua checagem estão registradas pela Agência Lupa [S01].

### 4.2 Resultado proposto — visão resumida

**FALSO — a concepção do projeto antecede esse governo.**

**Onde está a contradição?** O Banco Central criou seu grupo de trabalho de pagamentos instantâneos em **maio de 2018**, quando Michel Temer era presidente; requisitos fundamentais já estavam definidos em **dezembro de 2018**. Jair Bolsonaro assumiu em janeiro de 2019 [S02, S03].

**Como induz ao erro?** Confunde **o lançamento do Pix durante o mandato Bolsonaro, em novembro de 2020**, com **a origem da iniciativa**, documentada antes de seu mandato [S04].

### 4.3 Evidências específicas

| ID | Evidência | Relação | Por que é decisiva |
|---|---|---|---|
| PIX-E01 | Portaria nº 97.909, de 03/05/2018, institui o GT-Pagamentos Instantâneos; reunião inaugural em 10/05/2018. [S01, S03] | **Contradiz** autoria de origem atribuída ao governo iniciado em 2019 | Prova que o projeto institucional já existia. |
| PIX-E02 | Documento do BC de 21/12/2018 define requisitos fundamentais e próximos passos. [S02, S05] | **Contradiz** que a ideia surgiu depois | Prova que o desenho estava avançado antes da posse. |
| PIX-E03 | BC registra lançamento do Pix em 16/11/2020. [S04] | **Sustenta** parte temporal da fala | Reconhece a implementação no mandato sem confundir com autoria. |

**Responsáveis documentados:** o projeto foi conduzido institucionalmente pelo **Banco Central do Brasil**, por meio do **GT-Pagamentos Instantâneos**, com participação de aproximadamente **130 instituições**. Na reunião inaugural, **Breno Santana Lobo** consta como coordenador do GT; **Flávio Túlio Vilela** e **Carlos Eduardo Brandt** constam na direção do Deban [S02, S03]. A evidência não autoriza afirmar que uma única pessoa “inventou” o Pix.

**Explicação acessível:** o Banco Central é uma instituição pública permanente. Equipes e projetos institucionais podem atravessar governos. A independência institucional atual do BC não deve ser usada como explicação retroativa simplista sobre sua situação jurídica em 2018; **a prova fundamental são os documentos datados de 2018**, não uma suposição sobre autonomia administrativa.

**Atenção ao escopo:** “lançado no mandato” é uma proposição diferente de “a ideia surgiu no mandato”. O Veritas deve verificar ambas, mas contradizer especificamente a segunda.

### 4.4 Testes de aceite do caso

- [ ] Reconhece que a afirmação é sobre **origem/autoria**, não apenas lançamento.
- [ ] Identifica as datas **2018**, **2019** e **2020** com papéis distintos.
- [ ] Apresenta ao menos uma fonte primária do BC que antecede janeiro de 2019.
- [ ] Não atribui a invenção individualmente a Breno Lobo ou a outro servidor sem prova específica.
- [ ] Não descreve a autonomia institucional atual como prova suficiente de quem criou o projeto em 2018.
- [ ] Exibe uma contradição clara na primeira camada.

---

## 5. Estudo de caso B — Benefício de R$ 600

### 5.1 Afirmação documentada

> “Foi o presidente Bolsonaro que passou para, no mínimo, 600 reais o Bolsa Família.”

**Autor:** Flávio Bolsonaro. **Contexto:** debate da Band em **18/10/2026**. A fala é reproduzida em transcrição do Aos Fatos e analisada pela Lupa [S06, S07].

### 5.2 Resultado condicionado à proposição efetivamente afirmada

O rótulo **ENGANOSA** da proposta anterior não é um resultado obrigatório. A fala sobre elevar o valor não afirma literalmente que a medida era permanente. O sistema deve primeiro estabelecer o que está sendo verificado e como o contexto sustenta a interpretação.

| Proposição investigada | Resultado esperado, se a documentação confirmar o recorte | Condição editorial |
|---|---|---|
| O benefício chegou a R$ 600 no governo Bolsonaro em 2022 | **SUSTENTADA** para esse fato temporal, com o nome Auxílio Brasil esclarecido | Não converter o simples aumento em alegação de permanência |
| O governo Bolsonaro instituiu por si só um piso permanente correspondente ao benefício atual | **FALSA ou ENGANOSA**, conforme a proposição concreta e a prova | Somente avaliar essa proposição se a fala/contexto realmente a sustentar; não inseri-la na normalização |
| A expressão “Bolsa Família” se refere ao programa atual ou à sucessão de benefícios | Depende do contexto e das regras comparadas | Troca informal de nome não basta, sozinha, para demonstrar distorção material |
| O contexto não permite decidir qual alcance foi afirmado | **BLOCKED** para interpretação ainda não resolvida, ou **INCONCLUSIVA** após investigação delimitada | Explicar precisamente o ponto ambíguo |

**Cartão para a proposição temporal sustentada:** “O Auxílio Brasil chegou a R$ 600 em 2022, durante o governo Bolsonaro.” Prazo de vigência e continuidade posterior aparecem como contexto proporcional, sem transformar essa proposição em falsa.

**Cartão condicional para omissão material demonstrada:** “O aumento foi temporário; sua continuidade exigiu novas medidas.” Mostrar qual trecho cria a interpretação de permanência e quais documentos a contrariam. Se essa conexão não for demonstrada, omitir o mecanismo `OMITTED_TIME_LIMIT`.

A documentação deve distinguir vigência em 2022, proposta orçamentária original, intenção declarada de manter o pagamento, orçamento aprovado e base legal posterior [S08–S10, S13, S16, S17]. Ausência de dotação suficiente na proposta inicial não prova que o autor jamais propôs continuar o benefício.

### 5.3 Linha do tempo e o que cada registro comprova

| Período | Documento ou fato verificável | Interpretação admissível |
|---|---|---|
| **2020** | Auxílio **Emergencial** da pandemia teve discussão inicial de R$ 200 no Executivo e valor de R$ 600 aprovado no processo legislativo. [S07, S11] | É **outro programa**. Não fundir essa disputa com o Auxílio Brasil de 2022. |
| **2021** | Programa **Auxílio Brasil** substituiu o Bolsa Família. [S12] | Houve mudança de programa e regras. |
| **2022** | Auxílio Brasil foi ampliado a R$ 600, financiado até dezembro, com participação do Executivo e do Congresso. [S08, S09] | O pagamento de R$ 600 durante o governo Bolsonaro **é fato**. |
| **Proposta de orçamento de 2023** | A dotação original correspondia a benefício médio de cerca de R$ 405; havia intenção declarada de manter R$ 600. [S16, S17] | Diferenciar intenção anunciada, dotação proposta e garantia legal; não tratá-las como equivalentes. |
| **Orçamento aprovado de 2023** | O Congresso aprovou recursos para continuidade de R$ 600 após alterações na proposta. [S10] | Não confundir texto original do Executivo com orçamento final aprovado. |
| **2023** | Lei 14.601 instituiu o novo Bolsa Família, com complemento para assegurar R$ 600 por família. [S13] | O piso passou a ter outra base legal; não atribuir retroativamente essa lei ao governo anterior. |

### 5.4 O que não concluir

- Não escrever “Bolsonaro **nunca** pagou R$ 600”: isso seria falso.
- Não escrever “foi tudo obra exclusiva do Congresso”: o Executivo participou do processo.
- Não confundir **Auxílio Emergencial de 2020** com **Auxílio Brasil de 2022**.
- Não inferir **motivação eleitoral** como fato comprovado. O artigo do PT de 11/08/2022 [S14] é útil como cronologia e exemplo de interpretação partidária, **não como prova isolada das intenções políticas**. A decisão de aumento perto das eleições é verificável no calendário; intenção requer outra espécie de evidência.
- Evitar afirmar que “Bolsa Família” era o nome oficial do pagamento de 2022: naquele período o programa chamava-se **Auxílio Brasil**.

### 5.5 Testes de aceite do caso

- [ ] Confirma o pagamento real de R$ 600 em 2022.
- [ ] Distingue os três programas e suas datas.
- [ ] Esclarece a vigência temporária e a proposta orçamentária de 2023.
- [ ] Atribui o papel do Executivo e do Congresso com precisão.
- [ ] Apresenta fonte legal ou legislativa primária para a duração e a continuidade.
- [ ] Não atribui intenção eleitoral sem prova.
- [ ] A variante temporal sustentada não recebe Enganosa só por omitir continuidade futura.
- [ ] Enganosa exige contexto demonstrando interpretação materialmente incorreta; ausência dessa prova não pode ser suprida pelo modelo.
- [ ] Separa intenção declarada, dotação original e orçamento aprovado; não presume que ausência de dotação significa ausência de proposta/intenção.
- [ ] Os testes não obrigam um único rótulo para todas as formulações sobre R$ 600.

---

## 6. Estudo de caso C — R$ 7 bilhões em viagens

### 6.1 Afirmação documentada

> “de 7 bilhões de reais que você gastou com a Janja.”

**Autor:** Flávio Bolsonaro. **Contexto:** debate da Band em **18/10/2026**, dirigindo-se a Lula; o trecho anterior menciona viagens. O excerto acima preserva a redação da transcrição publicada pelo Aos Fatos [S07]. A referência “Lula” pertence à anotação de contexto e à normalização, **não deve ser inserida dentro de `originalQuote`** como se tivesse sido pronunciada. A pontuação editorial deve ser distinguida de correção lexical.

As checagens [S06, S07] são fontes secundárias dos valores e consultas relatados. A página inicial do Portal da Transparência [S15] é um ponto de entrada, **não prova de que a consulta foi reproduzida**. Para formar o conjunto de referência primária, registrar filtros, período, categorias, data de acesso e exportação/resultado consultado.

### 6.2 Resultado proposto — visão resumida

**FALSO — o número foi atribuído às pessoas erradas.**

**Onde está a contradição?** Os aproximadamente **R$ 7,14 bilhões** são despesas com viagens da **estrutura do governo federal** no período **2023–2025**, com passagens e diárias de servidores e autoridades de diversos órgãos. **Não são gastos exclusivamente realizados por Lula e Janja** [S06, S07].

**Como induz ao erro?** Usa um **número agregado real** para sustentar uma acusação **sobre um universo muito menor**. É a troca indevida do sujeito da estatística: “todos os órgãos federais” vira “duas pessoas”.

### 6.3 Comparação correta

| Dado apresentado | A quem o dado realmente se refere | O que podemos concluir |
|---|---|---|
| **≈ R$ 7,14 bilhões (2023–2025)** | Viagens e deslocamentos de diferentes órgãos e servidores do Executivo federal, conforme consultas relatadas pela Lupa e pelo Aos Fatos ao Portal da Transparência. [S06, S07, S15] | Não pode ser atribuído ao casal presidencial. |
| **≈ R$ 150,5 milhões (2023–2025)** | Despesas da **Presidência da República** no mesmo período, segundo consulta relatada pelo Aos Fatos. [S07] | Também **não representa** o gasto exclusivo do presidente e da primeira-dama. |
| **Gastos exclusivos de Lula e Janja** | Exigiriam recorte documental próprio, de acordo com a natureza de cada despesa. | **Não inferir um total preciso a partir dos dois agregados acima.** |

**Importante:** até 18/10/2026, a Lupa também registra gastos federais adicionais em 2026 [S06]. O Veritas não pode misturar o recorte **2023–2025** com um acumulado que inclua **2026**, nem utilizar o acumulado mais recente para validar retroativamente a frase de R$ 7 bilhões sem especificar o período.

### 6.4 Estrutura do confronto

- **Afirmação atômica:** “Lula e Janja gastaram R$ 7 bilhões em viagens.”
- **Fato verificável:** “O valor de cerca de R$ 7,14 bilhões corresponde às despesas de viagens da estrutura federal de 2023 a 2025.”
- **Incompatibilidade:** o agregado cobre população e órgãos muito mais amplos que o casal.
- **Mecanismo:** `MISATTRIBUTED_AGGREGATE` — atribuição indevida de dado agregado.
- **Limite:** os agregados disponíveis não determinam, por si, o valor exato de viagens do casal.

### 6.5 Testes de aceite do caso

- [ ] Identifica a população/universo representado pelo valor.
- [ ] Compara o mesmo período em todas as cifras apresentadas.
- [ ] Aponta a **troca do sujeito da estatística** como contradição.
- [ ] Explica que a cifra da Presidência também não equivale a gastos do casal.
- [ ] Não fabrica valor exclusivo de Lula e Janja.
- [ ] Usa fonte oficial de dados ou checagem rastreável, distinguindo consulta primária reproduzida de relato secundário.
- [ ] `originalQuote` preserva o excerto literal; “[Lula]” aparece apenas no contexto/normalização.
- [ ] Referência à página inicial do Portal não é apresentada como consulta já executada.
- [ ] A primeira camada pode ser compreendida sem o usuário conhecer previamente o Portal da Transparência.

---

## 7. Caso de controle — afirmação sustentada

Para evitar que o sistema procure contradições artificiais, os testes devem incluir **declarações efetivamente sustentadas**.

**Exemplo documentado:** em entrevista de 13/09/2022, Jair Bolsonaro disse que o governo havia pago o Auxílio Emergencial a **68 milhões de pessoas em 2020**. A checagem da Lupa identificou aproximadamente **68,2 milhões de beneficiários** no Portal da Transparência [S11].

**Resultado resumido proposto:** **SUSTENTADA — cerca de 68,2 milhões de pessoas receberam Auxílio Emergencial em 2020.**

**Contexto proporcional:** é necessário indicar **o ano e o programa**; não é necessário introduzir uma ressalva política sem relevância para a afirmação. Informações de 2021 só devem aparecer se a declaração fizer uma comparação entre anos ou se o usuário expandir uma série histórica pertinente.

**Aceite:** o sistema não inventa uma contradição; informa o número, período e fonte e encerra a verificação.

---

## 8. Taxonomia dos mecanismos

Mecanismos representam **o modo como a formulação se distancia do que as evidências sustentam**. Não são diagnósticos de intenção.

| Código | Mecanismo | Pergunta operacional |
|---|---|---|
| `FALSE_ORIGIN_ATTRIBUTION` | Falsa atribuição de origem/autoria | O evento ou iniciativa antecede a pessoa/gestão indicada? |
| `MISATTRIBUTED_AGGREGATE` | Dado agregado atribuído a subconjunto | O número cobre outra população, órgão, local ou categoria? |
| `OMITTED_TIME_LIMIT` | Omissão de duração | Algo temporário foi apresentado como permanente? |
| `PROGRAM_CONFLATION` | Confusão entre programas/instituições | A fala mistura objetos com regras, nomes ou períodos distintos? |
| `INCOMPATIBLE_COMPARISON` | Comparação de métricas incompatíveis | O denominador, a metodologia ou a unidade mudou? |
| `UNSUPPORTED_CAUSALITY` | Causalidade não demonstrada | Correlação foi descrita como causa sem suporte? |
| `SELECTIVE_PERIOD` | Recorte temporal seletivo | O período omitido altera materialmente a interpretação? |
| `OVERGENERALIZATION` | Generalização indevida | Um caso isolado foi apresentado como regra geral? |
| `SELECTIVE_EVIDENCE` | Seleção parcial de evidências | Foram omitidos dados diretamente pertinentes e divergentes? |

**Validação:** um mecanismo só pode aparecer quando houver um `evidenceId` associado que demonstre a distorção. Sem mecanismo demonstrável, omitir a seção *Como induz ao erro?*.

---

## 9. Pipeline obrigatório da verificação

### Etapa 0 — Integridade da fala

- Confirmar que a hipótese está **finalizada** e avaliar sua integridade. Texto finalizado pelo ASR não prova, sozinho, correspondência perfeita ao áudio.
- Preservar ID/revisão de segmento, locutor (ou desconhecido), tempo de mídia e contexto com autores distintos. Separar o horário da fala do horário da pesquisa.
- Se houver dúvidas sobre palavras fundamentais (números, negações, sujeitos), **não concluir** sem revisão ou confirmação da transcrição.

### Etapa 1 — Decomposição factual

- Isolar cada **proposição atômica verificável**, com investigação e resultado independentes; classificar `NOT_FACT_CHECKABLE` antes da pesquisa quando aplicável.
- Preservar `originalQuote` sem alterá-lo; criar `normalizedClaim` apenas como forma de consulta.
- Identificar sujeito, ação, objeto, período, universo, quantia e unidade.
- Registrar contexto indispensável para resolver pronomes e referências.

### Etapa 2 — Plano de prova

Antes de buscar, o sistema deve registrar: “**Que registro confirmaria ou refutaria esta proposição?**”

Exemplos:

- Origem do Pix → atos e atas anteriores ao início do mandato mencionado.
- Auxílio de R$ 600 → legislação de criação, prazos e proposta orçamentária subsequente.
- Viagens → escopo, órgão, período e beneficiários do dado divulgado.

### Etapa 3 — Recuperação de fontes

- Priorizar documentos originais: leis, diários oficiais, dados estatísticos, portarias, relatórios e transcrições primárias.
- Usar agências de checagem independentes como apoio e como ponte para documentos.
- Tratar conteúdos partidários ou materiais de campanha como **fontes posicionadas**, úteis para localizar argumentos, nunca como autoridade única.
- Guardar data de publicação somente quando identificada, data de acesso, data-base do dado e versão/arquivo/hash quando permitido.
- O adaptador registra conteúdo recuperado/inspecionado e gera os IDs; o modelo não pode declarar unilateralmente que inspecionou uma URL.
- Distinguir fonte indisponível, acesso parcial e documento inspecionado. Recuperar/armazenar somente o necessário, dentro de tamanho e retenção definidos.
- Não aceitar título, snippet ou link sem inspecionar conteúdo relevante como única sustentação.

### Etapa 4 — Confronto documento × claim

Para cada proposição, classificar evidências como `SUPPORTS`, `REFUTES`, `CONTEXTUALIZES` ou `IRRELEVANT`, associando justificativa localizada.

Checar explicitamente:

- **Quem?** Pessoa, órgão, instituição.
- **O quê?** Programa, indicador, benefício, despesa.
- **Quando?** Ano, governo, recorte de dados.
- **Quanto?** Valor, unidade, universo e denominador.
- **Como?** Causa, autoria, autorização, execução, continuidade.

### Etapa 5 — Determinação do veredito

- `FALSE` exige que a proposição atômica desta verificação seja contrariada em um ponto decisivo por evidência apropriada.
- `MISLEADING` exige núcleo verdadeiro + distorção material demonstrada.
- `SUPPORTED` exige núcleo diretamente comprovado no escopo especificado.
- `INCONCLUSIVE` é obrigatório se uma investigação tecnicamente válida não reunir apoio/contradição suficientes ou houver divergência documental sem resolução.
- Erro crítico de transcrição/contexto produz `BLOCKED`, sem veredito corrente; falha de provedor que inviabilize investigar produz `FAILED`. Indisponibilidade pontual de uma fonte pode ser limitação de resultado válido se outras provas forem suficientes.
- Nenhum estado incompleto/falhado recebe rótulo factual definitivo. Ausência de prova não prova falsidade.
- Divergência entre documentos deve permanecer visível; não votar por maioria simples de URLs.

### Etapa 6 — Redação em linguagem comum

Produzir três campos distintos:

1. `conclusion`: uma frase que responda à alegação.
2. `contradiction`: a incompatibilidade específica, quando demonstrada.
3. `mechanisms[].explanation`: explica cada distorção demonstrada, quando aplicável.

As três frases não devem apenas repetir a mesma ideia. Evitar jargão não explicado como “universo amostral”, “Deban” ou “subutilização”.

### Etapa 7 — Auditoria automática e revisão

- Verificar se cada afirmação factual escrita está ligada a ao menos uma evidência relevante.
- Validar se URL, trecho, data e entidades coincidem.
- Bloquear conclusão corrente quando a investigação for inviabilizada por erro de pesquisa ou transcrição crítica.
- Validar mecanicamente referências, revisão de insumos e fidelidade do trecho ao conteúdo recuperado; essa validação não prova que a evidência implica semanticamente a conclusão.
- Conferir suficiência e coerência em avaliação factual independente, com corpus e revisão humana amostrada.
- Registrar histórico de versões, motivo da revisão e evidências adicionadas/removidas.
- Marcar revisões humanas nos casos de alto impacto ou contestação.

---

## 10. Contrato de dados normativo para o planejamento

A implementação futura deverá manter o contrato no pacote `shared`, com tipos e validação runtime compartilhados entre frontend/backend. Os tipos abaixo descrevem as entidades e invariantes; **não constituem código implementado**. A versão de Zod e a migração dos contratos legados precisam ser unificadas em LIVE-001/LIVE-016.

### 10.1 Entidades e separação de responsabilidades

- **Quote:** registro literal da fala/entrada de texto e suas revisões, com autoria/contexto separados de anotações editoriais.
- **AtomicClaim:** uma proposição verificável derivada da quote; outras proposições têm outros IDs.
- **VerificationAttempt:** tentativa de investigar uma única `AtomicClaim`, com revisões dos insumos e estado operacional.
- **VerificationResult:** resultado imutável de tentativa concluída, com um veredito e vínculos documentais.
- **Source/SourceContent:** identidade do documento, coleta, versão e conteúdo efetivamente recuperado/inspecionado pelo adaptador.
- **Evidence:** trecho localizado em um `SourceContent`.
- **EvidenceAssessment:** relação daquele trecho com a afirmação atômica, incluindo a justificativa. Um mesmo documento pode apoiar uma proposição e refutar outra.

```ts
type Verdict = 'SUPPORTED' | 'FALSE' | 'MISLEADING' | 'INCONCLUSIVE';
type CheckStatus =
  | 'DETECTED' | 'QUEUED' | 'RESEARCHING' | 'EVALUATING'
  | 'COMPLETED' | 'BLOCKED' | 'FAILED' | 'CANCELLED' | 'DEFERRED';
type EvidenceRelation = 'SUPPORTS' | 'REFUTES' | 'CONTEXTUALIZES' | 'IRRELEVANT';
type SourceType = 'PRIMARY' | 'SECONDARY' | 'PARTISAN' | 'OTHER';
type Ref = { id: string; revision: number };
type CitedStatement = {
  text: string;
  kind: 'DOCUMENTED' | 'INFERENCE';
  assessmentIds: string[];
};

type Quote = {
  id: string; revision: number;
  origin: 'TEXT' | 'AUDIO';
  originalQuote: string;
  segmentRefs: Ref[]; // vazio no Texto; entrada de texto possui sua própria referência
  inputTextRef?: Ref;
  timestampMs?: { start: number; end: number }; // tempo de mídia, não tempo de pesquisa
  attribution: {
    speakerId?: string;
    status: 'UNKNOWN' | 'VOICE_MATCH' | 'MANUAL';
    mappingRevision?: number;
  };
  integrity: 'FINALIZED' | 'NEEDS_REVIEW';
};

type AtomicClaim = {
  id: string; revision: number; quoteRef: Ref;
  normalizedClaim: string;
  subject?: string; predicate?: string;
  period?: { start?: string; end?: string };
  populationOrScope?: string;
  quantity?: { value: string; unit: string; denominator?: string };
  contextRefs: Ref[];
  interpretation?: { explanation: string; contextRefs: Ref[] };
  proofPlan: string;
};

type Source = {
  id: string; title: string; publisher: string; url: string;
  type: SourceType;
  publishedAt?: string; // ausente quando desconhecida; não inferir pela data de acesso
};
type SourceContent = {
  id: string; sourceId: string;
  retrievedAt: string;
  retrievalStatus: 'FETCHED' | 'PARTIAL' | 'UNAVAILABLE';
  inspected: boolean; // gerado pelo adaptador, não pela autodeclaração do LLM
  contentHash?: string;
  contentRef?: string; // conteúdo/trecho retido ou snapshot permitido, recuperável no período declarado
  dataPeriod?: { start?: string; end?: string };
  queryParameters?: Record<string, string>;
  failure?: string; // sanitizado; sem tokens/credenciais
};
type Evidence = {
  id: string; sourceContentId: string;
  excerpt: string;
  location?: string; // página, seção, tabela, campo, offset
};
type EvidenceAssessment = {
  id: string; evidenceId: string; claimRef: Ref;
  relation: EvidenceRelation;
  explanation: string;
};
type Mechanism = {
  code:
    | 'FALSE_ORIGIN_ATTRIBUTION' | 'MISATTRIBUTED_AGGREGATE'
    | 'OMITTED_TIME_LIMIT' | 'PROGRAM_CONFLATION'
    | 'INCOMPATIBLE_COMPARISON' | 'UNSUPPORTED_CAUSALITY'
    | 'SELECTIVE_PERIOD' | 'OVERGENERALIZATION' | 'SELECTIVE_EVIDENCE';
  explanation: CitedStatement;
};
type VerificationAttempt = {
  id: string; sessionId?: string; revision: number;
  claimRef: Ref; quoteRef: Ref;
  segmentRefs: Ref[]; contextRefs: Ref[];
  speakerMappingRevision?: number;
  status: CheckStatus;
  searches: { query: string; executedAt: string; status: 'OK' | 'FAILED'; limitation?: string }[];
  resultId?: string; // apenas quando COMPLETED e os insumos permanecem vigentes
  reason?: string;
  createdAt: string; updatedAt: string;
};
type VerificationResult = {
  id: string; attemptId: string; revision: number;
  verdict: Verdict;
  conclusion: CitedStatement;
  contradiction?: CitedStatement;
  mechanisms: Mechanism[];
  supportedAspects: CitedStatement[];
  limitations: string[];
  createdAt: string;
  review: { type: 'AUTOMATED' | 'HUMAN'; at: string; note?: string }[];
  supersedesResultId?: string;
};
```

Sessões referenciam essas entidades; o snapshot/exportação transporta o conjunto necessário para conferir as ligações. Um resultado não contém uma lista de claims independentes com um rótulo compartilhado. `NOT_FACT_CHECKABLE` é decisão de triagem anterior à tentativa, registrada separadamente.

### 10.2 Invariantes estruturais e de proveniência

1. Somente tentativa `COMPLETED`, com resultado válido e insumos vigentes, publica veredito corrente. `INCONCLUSIVE` também exige tentativa concluída.
2. Tentativa e resultado referem-se a **uma** afirmação atômica e suas revisões. Proposições diferentes recebem tentativas distintas.
3. Cada afirmação factual em `conclusion`, `contradiction`, `supportedAspects` ou mecanismo possui `assessmentIds` existentes e pertinentes à mesma claim. Limites e ausência de evidência são descritos como limitações, sem inventar provas.
4. Cada assessment aponta para evidência existente; cada evidência aponta para conteúdo/documento existente. O trecho deve corresponder ao conteúdo inspecionado, com regra documentada de normalização de espaços/OCR. `IRRELEVANT` não sustenta conclusão.
5. `FALSE` exige contradição clara e pelo menos uma avaliação `REFUTES` apropriada à proposição. `SUPPORTED` exige avaliação `SUPPORTS` direta; não deve conter contradição artificial da mesma proposição.
6. `MISLEADING` exige aspecto verdadeiro documentado e ao menos um mecanismo comprovado. Interpretação implícita requer justificativa ligada a contexto; o schema não supre essa análise semântica.
7. `INCONCLUSIVE` exige limitações e registro da investigação realizada. Não pode mascarar falha operacional nem funcionar como rótulo de opinião.
8. Conteúdo indisponível ou não inspecionado não sustenta veredito definitivo. Conteúdo parcial só pode fundamentar proposição delimitada que esteja efetivamente coberta pelo trecho, com limitação explícita.
9. IDs/revisões são únicos e crescentes por entidade; timestamps têm formato validado; intervalo final não precede o início; referências não podem apontar para revisão inexistente.
10. Quote de áudio exige segmentos/timestamps; texto exige entrada de texto referenciada. `originalQuote` não inclui interpretações editoriais como se fossem palavras pronunciadas.
11. Histórico conserva revisões anteriores e sua autoria. `AUTOMATED` não equivale a revisão humana.
12. Credenciais e áudio bruto não pertencem ao payload de resultado, snapshot, replay ou exportação padrão.

Esses invariantes são necessários, mas **não garantem correção factual**: uma citação real pode ser interpretada incorretamente. A validação estrutural/proveniência é acompanhada de avaliação de suficiência, testes adversariais e revisão independente em LIVE-024/035.

### 10.3 Correção e invalidação

1. A edição informa `expectedRevision`; conflito é rejeitado, sem sobrescrever silenciosamente.
2. Correção cria uma revisão da fala, autoria, contexto ou evidência. Não altera retroativamente o registro literal histórico.
3. Um índice de dependências encontra tentativas/resultados ligados aos insumos afetados, inclusive contexto e mapeamento de locutor.
4. O resultado antigo passa a superado; a investigação é cancelada/reagendada quando necessário e a UI deixa de mostrá-lo como vigente.
5. Resposta tardia de provedor é descartada se o conjunto de revisões usado na tentativa não coincidir com o atual.
6. Publica `VERIFICATION_INVALIDATED`; snapshot/replay preserva essa informação e nunca ressuscita resultado antigo.
7. Reter histórico durante a sessão é P0 em LIVE-040. Histórico após reinício/SQLite é P1 e não pode ser prometido sem implementação correspondente.

### 10.4 Exemplo de apresentação, não payload completo

No caso de viagens, a quote literal é a do §6.1; a proposição normalizada explicita o referente “Lula”, com contexto preservado. A tentativa de uma única proposição retorna Falsa **se** os documentos efetivamente inspecionados demonstrarem a atribuição indevida do agregado. A conclusão e o mecanismo apontam para assessments desses trechos, mantendo a limitação sobre o gasto individual.

Não há fixture de integração válida com apenas strings como `VIAGENS-E01` sem as evidências/documentos correspondentes. Fixtures futuras precisam de todos os objetos referenciados, fonte congelada e revisão humana do resultado esperado.

---

## 11. Regras editoriais de UX

### Linguagem

**Preferir:** “O projeto já tinha requisitos aprovados em 2018, antes da posse em 2019.”  
**Evitar:** “A veracidade da afirmação carece de contextualização institucional.”

**Preferir:** “Os R$ 7 bilhões são despesas de diferentes órgãos, não do casal.”  
**Evitar:** “Existem algumas nuances no uso do dado.”

### Hierarquia e cor

- O **veredito** aparece com texto e ícone; cor nunca é a única informação.
- A **contradição** aparece no primeiro nível em resultados `FALSE`.
- Em `MISLEADING`, evidenciar **o que é real e o que foi omitido**.
- Em `SUPPORTED`, não adicionar uma seção de “contradição” artificial.
- Em `INCONCLUSIVE`, indicar objetivamente **o que faltou verificar**.
- Evidências ficam acessíveis sem exigir login adicional quando a fonte for pública.

### Acessibilidade

- Evitar dependência de vermelho/verde.
- Links com nomes de fontes inteligíveis.
- Títulos curtos e acionáveis nas áreas expansíveis.
- Textos selecionáveis e copiáveis, com referência ao horário e à fonte.
- Revisões visíveis: “Atualizado após correção da transcrição”, com data.

---

## 12. Casos de exceção e comportamento esperado

| Situação | Comportamento obrigatório |
|---|---|
| Erro na palavra “não”, número ou sujeito da transcrição | `BLOCKED`, sem resultado corrente; corrigir/revisar a fala e reprocessar. |
| Locutor não identificado | Manter a claim sem autoria confirmada; não inventar nome. |
| Site de fonte indisponível | Registrar limitação por fonte; continuar se houver prova suficiente. Se o erro inviabiliza a investigação, `FAILED`; se uma investigação válida não encontra prova, `COMPLETED` + `INCONCLUSIVE`. |
| Uma única notícia repete várias outras | Não contar as reproduções como fontes independentes. |
| Fontes divergem quanto à série ou método | Especificar diferenças; inconclusivo se não for possível resolver. |
| A claim mistura fato e opinião | Verificar somente proposições factuais, preservando a citação original. |
| O fato muda com o tempo | Registrar data-base e permitir revisão. |
| Alegação baseada em dado real com público errado | Aplicar `MISATTRIBUTED_AGGREGATE` e expor os dois universos. |
| LLM produz justificativa sem citação verificável | Rejeitar veredito definitivo. |
| Usuário contesta evidência | Permitir inspeção e revisão versionada com histórico, sem marcar revisão humana inexistente. |
| Saturação/cota insuficiente | `DEFERRED` ou falha explícita conforme a causa; manter a ocorrência visível e não inventar resultado. |
| Correção chega enquanto a pesquisa está ativa | Invalidar, propagar cancelamento e descartar resposta baseada na revisão antiga. |
| Reconexão após perder eventos | Replay limitado ou snapshot na mesma instância; restart/expiração sem persistência informa indisponibilidade. |

---

## 13. Critérios de aceite transversais

### Qualidade factual

- [ ] Toda conclusão factual tem vínculo explícito a avaliações de evidências recuperadas e inspecionadas; limitações não são convertidas em afirmações documentadas.
- [ ] `FALSE` especifica ao menos uma contradição decisiva.
- [ ] `MISLEADING` distingue componente verdadeiro de distorção demonstrada.
- [ ] `SUPPORTED` é possível sem forçar uma “nuance” ou contradição.
- [ ] `INCONCLUSIVE` não é apresentado como confirmação ou negação.
- [ ] Datas, participantes, valores, unidades e universos são conferidos.
- [ ] Fontes posicionadas são identificadas como tais; não servem como prova isolada de intenção.
- [ ] Testes usam casos favoráveis, desfavoráveis e inconclusivos com o mesmo padrão de evidência.

### Rastreabilidade

- [ ] Cada quote original está vinculado ao segmento ou entrada de texto.
- [ ] Há ligação fala/entrada → claim atômica → assessment → evidência → conteúdo/documento → conclusão, com revisões verificáveis.
- [ ] Links e metadados permitem rechecagem humana.
- [ ] Alterações em transcrição, contexto, autoria, fonte ou veredito criam revisão e invalidam conclusões dependentes, inclusive respostas em trânsito.

### Experiência

- [ ] A contradição é compreensível sem conhecimento especializado.
- [ ] O cartão resumido responde à pergunta principal em uma leitura curta.
- [ ] O usuário consegue abrir provas e limitações.
- [ ] Processamento incompleto não é confundido com veredito.
- [ ] A interface funciona tanto com claims do modo Texto quanto do Veritas Live.

### Testes automatizados

- [ ] Fixtures cobrindo Pix, R$ 600 e viagens.
- [ ] Fixture de afirmação sustentada (Auxílio Emergencial de 2020).
- [ ] Fixture inconclusiva por insuficiência documental após pesquisa válida.
- [ ] Fixtures distintas para quota, timeout, cancelamento, falha de busca e fonte pontualmente inacessível.
- [ ] Variantes do caso R$ 600 sem impor permanência a uma alegação temporal.
- [ ] Teste de citação literal e anotação editorial separadas.
- [ ] Fixture de erro de transcrição em valor ou negação.
- [ ] Fixture com uma fala e várias claims atômicas, cada uma com resultado independente.
- [ ] Validação Zod de tipos, referências, intervalos, revisões e condições de veredito/evidência.
- [ ] Avaliação semântica independente demonstra suficiência/coerência, além dos schemas.
- [ ] Correção em trânsito, conflito de revisão e replay de invalidação são cobertos.
- [ ] Teste de frontend para atualizações em tempo real e revisão sem duplicação.

---

## 14. Relação com as tarefas técnicas

| Parte desta especificação | Implementação prevista |
|---|---|
| Integridade do áudio, locutor e citação | `LIVE-004–LIVE-015` |
| Contrato de dados e estados | `LIVE-001`, `LIVE-016`, `LIVE-028` |
| Pesquisa, fontes e comparação factual | `LIVE-017–LIVE-020` |
| Contradições e mecanismos | `LIVE-021` |
| Vereditos e redação | `LIVE-022` |
| Fila, revisões e atualização | `LIVE-023`, `LIVE-028`, `LIVE-040`; histórico durável P1 em `LIVE-029` |
| Casos de teste e revisão factual | `LIVE-024`, `LIVE-035` |
| Cards de resultado e mobile | `LIVE-027`, `LIVE-030–LIVE-032` |
| Qualificação, segurança, auditoria e gates | `LIVE-000`, `LIVE-035–LIVE-041` |

**Ordem de execução quando autorizada:** qualificar ambiente/captura/modelos (LIVE-000), estabelecer contratos (001/016) e corrigir riscos críticos (017/038); validar o motor factual por texto com exemplos revisáveis; entregar uma fatia integrada com áudio e UI; consolidar autoria e qualidade; executar gates de piloto e MVP separadamente. Não aguardar todas as funcionalidades de áudio para iniciar o motor, nem adiar revisões/testes/segurança até a última fase.

A taxonomia editorial pode compartilhar uma implementação de avaliação/redação. Arquivos separados não obrigam múltiplas chamadas de LLM, evitando custo e latência desnecessários.

---

## 15. Fontes documentais dos exemplos

A lista registra as referências da proposta e as referências complementares desta revisão de **23/10/2026**. Esta edição não declara todas as consultas oficiais reproduzidas nem os casos transformados em fixtures executáveis. Fontes e recortes devem ser inspecionados, congelados quando permitido e anotados antes de aprovar o conjunto de referência. Rótulos/resumos são propostas editoriais condicionadas ao enunciado e à prova, não respostas obrigatórias para o modelo.

- **[S01]** Agência Lupa (14/09/2022), checagem da entrevista de Jair Bolsonaro no Ratinho: https://www.agencialupa.org/jornalismo/2022/09/14/ratinho-bolsonaro-violencia-mulher-pix-auxilios/
- **[S02]** Banco Central, GT-Pagamentos Instantâneos: https://www.bcb.gov.br/estabilidadefinanceira/gtpagamentos
- **[S03]** Banco Central, reuniões do GT (inclui reunião inaugural de 10/05/2018): https://www.bcb.gov.br/estabilidadefinanceira/gtpaginst_reunioes
- **[S04]** Banco Central, trajetória do Pix: https://www.bcb.gov.br/estabilidadefinanceira/pix/sobre
- **[S05]** Banco Central, requisitos fundamentais, versão final (21/12/2018): https://www.bcb.gov.br/content/estabilidadefinanceira/gt_pagamentos_instantaneos/Requisitos%20fundamentais%20-%20vers%C3%A3o%20final.pdf
- **[S06]** Agência Lupa (18–19/10/2026), checagem do debate da Band: https://www.agencialupa.org/checagem/2026/10/18/ao-vivo-checagem-do-debate-entre-lula-e-flavio-bolsonaro-na-band/
- **[S07]** Aos Fatos (18/10/2026), debate da Band, transcrição e análise: https://www.aosfatos.org/noticias/checamos-lula-flavio-bolsonaro-debate-band/
- **[S08]** Senado (09/11/2022), pagamento do Auxílio Brasil de R$ 600 até dezembro: https://www12.senado.leg.br/institucional/presidencia/noticia/rodrigo-pacheco/senado-garante-o-pagamento-do-auxilio-brasil-de-r-600-ate-dezembro-de-2022
- **[S09]** Senado (17/11/2022), Lei 14.469/2022 e financiamento do benefício: https://www12.senado.leg.br/noticias/noticias/materias/2022/11/17/promulgada-lei-que-garante-auxilio-brasil-ate-dezembro-de-2022
- **[S10]** Senado (22/12/2022), proposta original de orçamento para 2023 não contemplava manutenção dos R$ 600: https://www12.senado.leg.br/noticias/materias/2022/12/22/orcamento-e-aprovado-com-dinheiro-extra-para-programas-sociais-e-infraestrutura
- **[S11]** Folha/Lupa (22/09/2022), checagem da cifra de beneficiários do Auxílio Emergencial em 2020: https://www1.folha.uol.com.br/poder/2022/09/lupa-bolsonaro-erra-sobre-pix-e-lula-sobre-ferrovia-em-entrevistas-a-ratinho.shtml
- **[S12]** Lei 14.284/2021, criação do Auxílio Brasil: https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2021/lei/l14284.htm
- **[S13]** Lei 14.601/2023, Bolsa Família e benefício complementar de R$ 600: https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2023/lei/l14601.htm
- **[S14]** Partido dos Trabalhadores (11/08/2022), cronologia **partidária**, útil como referência de alegações a confrontar com documentos: https://pt.org.br/linha-do-tempo-bolsonaro-so-ficou-a-favor-dos-r-600-perto-das-eleicoes/
- **[S15]** Portal da Transparência, ponto de entrada para consultas; a página inicial não substitui a consulta parametrizada nem comprova sua execução: https://portaldatransparencia.gov.br/
- **[S16]** Câmara dos Deputados, proposta original do Orçamento de 2023 e intenção declarada de ampliar o Auxílio Brasil (31/08/2022): https://www.camara.leg.br/noticias/906580-projeto-do-orcamento-de-2023-preve-salario-minimo-de-r-1-302/
- **[S17]** Senado, análise das consultorias sobre a proposta e intenção expressa na mensagem presidencial (02/09/2022): https://www12.senado.leg.br/noticias/materias/2022/09/02/consultorias-do-senado-e-da-camara-lancam-informativo-sobre-orcamento-de-2023

---

## 16. Definição de pronto desta especificação

Esta especificação estará implementada quando o motor compartilhado e a UI atenderem aos invariantes, os casos documentais revisados forem reproduzíveis e toda conclusão factual puder ser auditada a partir da fala original e das evidências. Schemas devem impedir referências inválidas e publicação indevida de resultados; suficiência e coerência da prova exigem avaliação factual independente.

A prontidão operacional depende dos gates do PRD/LIVE-041: captura real, provedores reais, correções em trânsito, limites e ensaio prolongado. O MVP completo exige também diarização contínua qualificada; piloto com autoria desconhecida não comprova esse requisito. Histórico durável e mobile são P1.

Esta revisão é exclusivamente documental. Não atribuir status de implementado, validado ou pronto para o debate com base na atualização destes arquivos.

**O Veritas deve demonstrar, não apenas declarar.**
