// services/extractor/src/anthropic.model.ts
// The live half of the Model port: one Claude call per order mail. Kept behind a
// factory that returns null without a key, because spec 8.5 requires the demo to
// start for a stranger who cloned it and has no key to give it.
import Anthropic from '@anthropic-ai/sdk';
import type { Model } from './extract.service';

const MODEL = 'claude-opus-5';
const MAX_TOKENS = 2048;

class AnthropicModel implements Model {
  constructor(private readonly client: Anthropic) {}

  async complete(system: string, user: string): Promise<string> {
    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // Reading one short mail is routine work; the two checks downstream are
      // what guard correctness here, not the size of the reasoning budget.
      output_config: { effort: 'low' },
      system,
      messages: [{ role: 'user', content: user }],
    });

    if (response.stop_reason === 'refusal') {
      throw new Error('model declined to answer');
    }

    const text = response.content.find((block) => block.type === 'text');
    // An empty answer is not an error here: the schema check reports it as a
    // malformed extraction, which is exactly what the operator needs to see.
    return text ? text.text : '';
  }
}

/** Null means recorded mode. The caller must not treat that as a failure. */
export function createModel(apiKey: string | undefined): Model | null {
  if (!apiKey) return null;
  return new AnthropicModel(new Anthropic({ apiKey }));
}
