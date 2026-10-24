import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';

/**
 * Deterministic LLM for unit tests and offline evals. Never contacts a network
 * provider and never consumes paid quotas (LIVE-018).
 */
export class FakeChatModel extends BaseChatModel {
  private readonly responses: string[];
  readonly calls: BaseMessage[][] = [];

  constructor(responses: readonly string[] = []) {
    super({});
    this.responses = [...responses];
  }

  _llmType(): string {
    return 'fake';
  }

  _generate(messages: BaseMessage[]): Promise<ChatResult> {
    this.calls.push(messages);
    const text = this.responses.shift() ?? '';
    return Promise.resolve({
      generations: [{ text, message: new AIMessage(text) }],
    });
  }

  /** Remaining scripted replies (empty means the next call returns ""). */
  remaining(): number {
    return this.responses.length;
  }
}

export function createFakeLLM(
  responses: readonly string[] = [],
): FakeChatModel {
  return new FakeChatModel(responses);
}
