import { ParsingError } from '#/utils/errors.js';
import { parseLLMJsonResponse, sanitizeJsonForTemplate } from '#/utils/llm.js';
import {
  FACT_CHECK_RESULT_DATA_SCHEMA,
  FACT_CHECK_RESULT_SCHEMA,
  FactCheckRequest,
} from '#/ws/types.js';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { RunnableSequence } from '@langchain/core/runnables';
import { BaseChatMemory } from 'langchain/memory';
import z from 'zod';
import { REASONING_CONFIDENCE_INPUT } from './constants.js';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';

type ChainInput = {
  input: string;
};
type ChainVars = ChainInput & {
  context?: string;
};

/** Legacy LLM shape only — excludes the migrated `verification` payload. */
const INITIAL_ANALYSIS_SCHEMA = z.array(
  FACT_CHECK_RESULT_DATA_SCHEMA.pick({
    extractedClaim: true,
    reasoningConfidence: true,
    reasoning: true,
    flags: true,
  }),
);

const SYSTEM_PROMPT = `You are an expert fact-checker and debunking expert analyzing political statements.

Your task is to process the input text and return structured JSON according to the schema provided. Follow these rules:
- Evaluate the veracity of the statement(s) in the input.
- Provide clear reasoning for each claim. Each reasoning must not be empty.
- You might face more than one speaker. In this case, make sure you're not mixing context between speakers.
- Extract zero, one, or more claims. Each extracted claim must be an item in the returned array.
- Only extract claims that are prone to fact-checking. So keep the results array as small as possible.
- Include additional flags only if applicable: ${FACT_CHECK_RESULT_SCHEMA.shape.data.shape.flags.unwrap().unwrap().options.join(', ')}.
- Preserve the original language of the user's input provided by the INPUT block.
- Respond in the same language as the user's input for all explanatory fields in the JSON (e.g., reasoning). Do not translate quoted passages or the user's original text. Keep sources and URLs unchanged.
- Provide a reasoningConfidence value varying between 0-1 (float) for each claim. Follow the REASONING CONFIDENCE CRITERIA bellow.
- Consider the PREVIOUS CONTEXT provided for more accurate assessment.
- Return only valid JSON. No markdown, No code blocks, or explanatory text. Start directly with {{ and end with }}.
- Follow strictly the JSON structure defined in JSON SCHEMA block bellow.

REASONING CONFIDENCE CRITERIA:
${REASONING_CONFIDENCE_INPUT}

JSON SCHEMA:
\`\`\`json
${sanitizeJsonForTemplate(z.toJSONSchema(INITIAL_ANALYSIS_SCHEMA))}
\`\`\`

PREVIOUS CONTEXT:
{context}

INPUT:
{input}
`;

const PROMPT_TEMPLATE = ChatPromptTemplate.fromTemplate(SYSTEM_PROMPT);

export type BasicAnalysisArgs = {
  factCheckReq: FactCheckRequest;
  memory: BaseChatMemory;
  chunks: string[];
  llm: BaseChatModel;
};

export async function* basicAnalysis({
  factCheckReq,
  chunks,
  memory,
  llm
}: BasicAnalysisArgs) {
  const chain = RunnableSequence.from([
    {
      input: (i: ChainInput) => i.input,
      context: async () => {
        const mem = (await memory.loadMemoryVariables({})) as
          | ChainVars
          | undefined;
        return mem?.context ?? '';
      },
    },
    PROMPT_TEMPLATE,
    llm,
  ]);

  for (let i = 0, currSeq = 0; i < chunks.length; i++) {
    const response = await chain.invoke({ input: chunks[i] });

    const initialAnalysisArr = parseLLMJsonResponse(INITIAL_ANALYSIS_SCHEMA, response.text);

    if (!initialAnalysisArr) {
      throw new ParsingError(
        `Falha ao parsear JSON do chunk ${i.toString()}: ${response.text}`,
      );
    }

    for (const data of initialAnalysisArr) {
      yield FACT_CHECK_RESULT_SCHEMA.parse({
        data,
        meta: {
          fingerprint: factCheckReq.fingerprint,
          chunk: i,
          seq: currSeq++,
        },
      });
    }
  }
}
