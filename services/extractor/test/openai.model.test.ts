// services/extractor/test/openai.model.test.ts
// Holds the live half of the Model port to the one request it is allowed to make.
//
// There was no test here while this was the Anthropic SDK, because the SDK owned the
// request and there was nothing of ours left to assert. Plain fetch hands that back,
// so the body is ours to get wrong and worth pinning: the model id the spec names,
// the tier the account is billed at, and the two messages in the order the prompt
// was written for.
//
// The assertion that matters most is the one about response_format. This API can be
// told to guarantee the answer matches the schema, and taking that offer would quietly
// end the demonstration the whole service exists for (spec 8.3), leaving the schema
// check with nothing to catch. It is pinned here as an absence, so that nobody
// adds it later as an obvious improvement.
//
// No key means recorded mode, not a broken service (spec 8.5), so the null cases are
// here too rather than left to the extract service's own suite.
import { describe, it, expect } from 'vitest';
import type { Model } from '../src/extract.service';
import { createModel, type Fetch } from '../src/openai.model';

interface Call { url: string; init: RequestInit | undefined }

class FakeOpenAi {
  calls: Call[] = [];

  constructor(
    private readonly body: unknown,
    private readonly status = 200,
  ) {}

  fetch: Fetch = async (url, init) => {
    this.calls.push({ url, init });
    return new Response(JSON.stringify(this.body), {
      status: this.status, headers: { 'content-type': 'application/json' },
    });
  };
}

/** The key is present in every case below, so a null here is the test failing early. */
function modelWith(fetcher: Fetch, key = 'sk-test'): Model {
  const model = createModel(key, fetcher);
  if (!model) throw new Error('createModel returned null despite a key');
  return model;
}

function said(text: string | null, refusal?: string): unknown {
  return { choices: [{ message: { role: 'assistant', content: text, refusal } }] };
}

function sentBody(call: Call): Record<string, unknown> {
  return JSON.parse(String(call.init?.body));
}

const ORDER = '{"customer":{"name":"M. Berger","email":"m@example.com"},'
  + '"items":[{"sku":"MUG-BLUE","qty":3}],"notes":null}';

describe('createModel', () => {
  it('returns null without a key, because that is recorded mode and not a failure', () => {
    expect(createModel(undefined)).toBeNull();
  });

  it('treats an empty key the same as an absent one', () => {
    expect(createModel('')).toBeNull();
  });

  it('returns a model once there is a key to use', () => {
    expect(createModel('sk-test')).not.toBeNull();
  });
});

describe('OpenAiModel', () => {
  it('posts once to the chat completions endpoint with the key as a bearer token', async () => {
    const api = new FakeOpenAi(said(ORDER));
    await modelWith(api.fetch).complete('system', 'user');

    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].url).toBe('https://api.openai.com/v1/chat/completions');
    expect(api.calls[0].init?.method).toBe('POST');
    expect(api.calls[0].init?.headers).toMatchObject({ authorization: 'Bearer sk-test' });
  });

  it('names the model the spec pins and the tier the account is billed at', async () => {
    const api = new FakeOpenAi(said(ORDER));
    await modelWith(api.fetch).complete('system', 'user');

    const body = sentBody(api.calls[0]);
    expect(body.model).toBe('gpt-5.4-nano');
    expect(body.service_tier).toBe('flex');
  });

  it('sends the prompt as system and the mail as user, in that order', async () => {
    const api = new FakeOpenAi(said(ORDER));
    await modelWith(api.fetch).complete('the prompt', 'the mail');

    expect(sentBody(api.calls[0]).messages).toEqual([
      { role: 'system', content: 'the prompt' },
      { role: 'user', content: 'the mail' },
    ]);
  });

  it('does not ask the api to guarantee the shape, or the schema check has no work', async () => {
    // Structured outputs would make a malformed answer impossible, and a malformed
    // answer being caught is the demonstration this service was built for. The shape
    // is asked for in the prompt and proven afterwards, on purpose.
    const api = new FakeOpenAi(said(ORDER));
    await modelWith(api.fetch).complete('system', 'user');

    expect(sentBody(api.calls[0])).not.toHaveProperty('response_format');
  });

  it('hands the answer back verbatim, so the checks see what the model said', async () => {
    const api = new FakeOpenAi(said(ORDER));

    expect(await modelWith(api.fetch).complete('system', 'user')).toBe(ORDER);
  });

  it('returns an empty answer rather than throwing on it', async () => {
    // Not an oversight. An empty answer fails the schema check with the raw text
    // beside it, which is the screen the operator needs (spec 8.4). Thrown, it would
    // be a 500 from the extractor and the visitor would learn nothing.
    const api = new FakeOpenAi(said(''));

    expect(await modelWith(api.fetch).complete('system', 'user')).toBe('');
  });

  it('returns an empty answer when the body is not the shape it should be', async () => {
    const api = new FakeOpenAi({ choices: [] });

    expect(await modelWith(api.fetch).complete('system', 'user')).toBe('');
  });

  it('throws when the model declines to answer', async () => {
    const api = new FakeOpenAi(said(null, 'I cannot help with that'));

    await expect(modelWith(api.fetch).complete('system', 'user'))
      .rejects.toThrow(/declined/);
  });

  it('carries the status into the error, because 401 and 429 want opposite fixes', async () => {
    const api = new FakeOpenAi({ error: { message: 'Incorrect API key provided' } }, 401);

    await expect(modelWith(api.fetch).complete('system', 'user'))
      .rejects.toThrow(/401/);
  });

  it('lets a cut line surface as itself rather than as an empty answer', async () => {
    const cut: Fetch = async () => { throw new TypeError('fetch failed'); };

    await expect(modelWith(cut).complete('system', 'user'))
      .rejects.toThrow(/fetch failed/);
  });
});
