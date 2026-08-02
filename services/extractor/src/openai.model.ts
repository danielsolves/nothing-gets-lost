// services/extractor/src/openai.model.ts
// The live half of the Model port: one OpenAI call per order mail. Kept behind a
// factory that returns null without a key, because spec 8.5 requires the demo to
// start for a stranger who cloned it and has no key to give it.
//
// This was Claude Haiku through @anthropic-ai/sdk. Moving it is an account decision
// and not a quality one: the same OpenAI key already pays for another pipeline here,
// and one key on a public host is one thing to rotate and one bill to read instead of
// two. Reading one short mail is routine work on either model, and the two checks
// downstream are what guard correctness, not model size.
//
// Plain fetch rather than a client library. One POST to one endpoint does not earn a
// dependency, and going without took @anthropic-ai/sdk out of the manifest entirely
// rather than swapping it for the next one.
//
// Structured outputs are deliberately NOT used, though this API offers them and they
// would make the answer match orderSchema by construction. Everywhere else that would
// be the right call; here it ends the demonstration the service exists for. Spec 8.3
// is about a malformed answer being caught, and a model that cannot answer badly
// leaves the schema check with nothing to do in the one scene it was built for. The
// shape is asked for in the prompt and proven afterwards, which is the arrangement
// the page is asking to be checked on.
import type { Model } from './extract.service';

/** Injected so the tests can watch the request without reaching the network. */
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const API_URL = 'https://api.openai.com/v1/chat/completions';

/** Pinned by the spec (section 5). */
const MODEL = 'gpt-5.4-nano';

// Half the standard rate, in exchange for latency the provider does not bound. An
// extraction is one call while a visitor watches the page draw its own steps, so the
// wait is visible rather than hidden, and the saving is real on a public link anyone
// can press. This is the setting to revisit first if flex ever starts refusing on
// capacity: there is no queue behind this call to absorb that and try again later.
const SERVICE_TIER = 'flex';

// Turning a mail into JSON is transcription, not deliberation. Reasoning tokens are
// billed against the same ceiling as the answer, so effort spent thinking is budget
// not spent answering, and that arrives here as an empty completion.
const REASONING_EFFORT = 'none';

const MAX_COMPLETION_TOKENS = 2048;

// The SDK brought a timeout of its own and plain fetch brings none. Without this a
// request that never answers holds the visitor's page open for as long as the socket
// lives, which looks exactly like the extractor having hung.
const TIMEOUT_MS = 60_000;

interface ModelMessage { content: string; refusal: string }

const NOTHING: ModelMessage = { content: '', refusal: '' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Read choices[0].message out of the answer without trusting any part of it.
 *
 * A body that is not the documented shape is treated as an empty answer rather than
 * as a crash. Empty then fails the schema check with the raw text beside it, which is
 * the screen spec 8.4 promises the operator; thrown, it would be a 500 from the
 * extractor and the visitor would be told nothing at all.
 */
function firstMessage(body: unknown): ModelMessage {
  if (!isRecord(body) || !Array.isArray(body.choices)) return NOTHING;

  const first: unknown = body.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) return NOTHING;

  const { content, refusal } = first.message;
  return {
    content: typeof content === 'string' ? content : '',
    refusal: typeof refusal === 'string' ? refusal : '',
  };
}

class OpenAiModel implements Model {
  constructor(
    private readonly apiKey: string,
    private readonly doFetch: Fetch,
  ) {}

  async complete(system: string, user: string): Promise<string> {
    const response = await this.doFetch(API_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        reasoning_effort: REASONING_EFFORT,
        max_completion_tokens: MAX_COMPLETION_TOKENS,
        service_tier: SERVICE_TIER,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      // The status goes into the message on purpose. A 401 is a key nobody renewed
      // and a 429 is a busy minute, and whoever reads this line wants to do opposite
      // things about them. The body is trimmed because it can carry the request back.
      const detail = await response.text().catch(() => '');
      throw new Error(`OpenAI responded ${response.status}: ${detail.slice(0, 200)}`);
    }

    const message = firstMessage(await response.json());
    if (message.refusal) throw new Error('model declined to answer');

    // An empty answer is not an error here: the schema check reports it as a
    // malformed extraction, which is exactly what the operator needs to see.
    return message.content;
  }
}

/** Null means recorded mode. The caller must not treat that as a failure. */
export function createModel(
  apiKey: string | undefined, doFetch: Fetch = fetch,
): Model | null {
  if (!apiKey) return null;
  return new OpenAiModel(apiKey, doFetch);
}
