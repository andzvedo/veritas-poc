import { parseLLMJsonResponse, sanitizeJsonForTemplate } from '#/utils/llm.js';
import { safeErrorForLog } from '#/utils/security.js';
import { FACT_CHECK_RESULT_DATA_SCHEMA } from '#/ws/types.js';
import { StringOutputParser } from "@langchain/core/output_parsers";
import { PromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { TavilySearch, TavilySearchResponse } from '@langchain/tavily';
import { BaseChatMemory } from 'langchain/memory';
import z from 'zod';
import { REASONING_CONFIDENCE_INPUT } from './constants.js';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';

export type DeepResearchArgs = {
  query: string;
  memory?: BaseChatMemory;
  tavilyApiKey: string;
  llm: BaseChatModel;
};

type DeepResearchRunnableInput = {
  query: string;
  memory?: BaseChatMemory;
}

export const DEEP_RESEARCH_RESULT_SCHEMA = FACT_CHECK_RESULT_DATA_SCHEMA.pick({ reasoning: true, sources: true, reasoningConfidence: true });

export type DeepResearchOutput = z.infer<typeof DEEP_RESEARCH_RESULT_SCHEMA>;

// Prompt para síntese da pesquisa
const SYSTEM_PROMPT = PromptTemplate.fromTemplate(`
You are an expert fact-checker analyzing political statements.
Your task is to provide an objective, evidence-based assessment.

CLAIM TO VERIFY: "{query}"

PREVIOUS CONTEXT:
{context}

SEARCH RESULTS:
{searchResults}

REASONING CONFIDENCE CRITERIA:
${REASONING_CONFIDENCE_INPUT}

INSTRUCTIONS:
1. Analyze the claim against the provided search results
2. Consider the previous context for more accurate assessment
3. Provide a clear, objective summary (maximum 2 paragraphs)
4. Indicate the level of confidence varying between 0-1 (float)
5. Focus on credible sources and recent information
6. Note any limitations in available evidence
7. Respond in the same language as the user's input for all explanatory fields in the JSON (e.g., reasoning). Do not translate quoted passages or the user's original text. Keep sources and URLs unchanged.
8. Format your response as JSON according to the schema provided. Follow these rules:

RESPONSE JSON SCHEMA:
\`\`\`json
${sanitizeJsonForTemplate(z.toJSONSchema(DEEP_RESEARCH_RESULT_SCHEMA))}
\`\`\`
`);

export function deepResearch({ query, memory, llm, tavilyApiKey }: DeepResearchArgs) {

  // Ferramenta de busca Tavily
  const searchTool = new TavilySearch({
    tavilyApiKey,
    maxResults: 5,
    searchDepth: "advanced", // For more comprehensive results
    includeAnswer: true,     // Get AI-generated answers
    includeRawContent: false // Avoid overwhelming the LLM
  });

  const researchChain = RunnableSequence.from<DeepResearchRunnableInput, DeepResearchOutput>([
    {
      query: (input) => input.query,
      context: async (input) => {
        if (!input.memory) {
          return '';
        }
        const mem = (await input.memory.loadMemoryVariables({})) as
          | { context?: string }
          | undefined;
        return mem?.context ?? '';
      },
      searchResults: async (input) => {
        try {
          const response = await searchTool.invoke({ query: input.query }) as TavilySearchResponse;

          // Extract meaningful content from Tavily response
          const formattedResults = response.results.map((result, index) =>
            `${(index + 1).toString()}. **${result.title}**\n` +
            `   URL: ${result.url}\n` +
            `   Content: ${result.content}\n` +
            `   Score: ${result.score.toString() || 'N/A'}\n`
          ).join('\n\n') || 'No search results found.';

          return formattedResults;
        } catch (error) {
          console.error('Tavily search failed:', safeErrorForLog(error));
          return 'Search temporarily unavailable.';
        }
      },
    },
    SYSTEM_PROMPT,
    llm,
    new StringOutputParser(),
    // Parser final para extrair JSON estruturado
    (output: string) => {
      const parsed = parseLLMJsonResponse(DEEP_RESEARCH_RESULT_SCHEMA, output);
      if (!parsed) {
        throw new Error(`Failed to parse LLM JSON response: ${output}`);
      }
      return parsed;
    },
  ]);

  return researchChain.invoke({ query, memory });
}
