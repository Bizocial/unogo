export type LLMModelHint = 'fast'|'balanced'|'smart'|'vision';

export interface LLMResult {
  text: string;
  tokensIn?: number;
  tokensOut?: number;
  raw?: unknown;
}

export interface LLMProvider {
  name: 'openai'|'gemini'|'claude'|'local';
  supports: LLMModelHint[];
  chat(input: {
    system: string;
    user: string;
    tools?: any[];
    maxTokens?: number;
    temperature?: number;
  }): Promise<LLMResult>;
}
