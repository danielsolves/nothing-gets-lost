// ui/test/mail-order-samples.test.ts
// The three mails the panel offers, checked against the answers the demo actually
// has for them.
//
// This reads the extractor's fixture file, which is an odd thing for a browser test
// to do and is the whole point of it. The public site holds no model key, so every
// answer there comes from that file, and a sample mail is matched to it by a
// substring. Change a word in a sample and the mail that was meant to show an
// invented article number quietly starts producing a tidy order instead, and nothing
// fails: the page just stops demonstrating what it says it demonstrates. That has
// happened here once already, which is why the check is worth its oddity.
import { describe, it, expect } from 'vitest';
import { MAX_ORDER_TEXT } from '@ngl/contracts';
import { SAMPLE_MAILS, sampleMail } from '../src/mail-order-samples';
import fixtures from '../../fixtures/extractions.json';

interface Recorded { match: string; answer: { items: Array<{ sku: string }> } }

function recordedFor(text: string): Recorded | undefined {
  const lower = text.toLowerCase();
  return fixtures.recorded.find((entry) => lower.includes(entry.match.toLowerCase()));
}

describe('the sample mails', () => {
  it('offers three, and each one is a different thing to watch', () => {
    expect(SAMPLE_MAILS.map((mail) => mail.id))
      .toEqual(['ordinary', 'invented', 'nothing']);
  });

  it('gives every one of them a name to press', () => {
    for (const mail of SAMPLE_MAILS) expect(mail.label.length).toBeGreaterThan(0);
  });

  it('keeps them inside the length the endpoint accepts', () => {
    for (const mail of SAMPLE_MAILS) {
      expect(mail.text.length).toBeLessThanOrEqual(MAX_ORDER_TEXT);
      expect(mail.text.trim().length).toBeGreaterThan(0);
    }
  });

  it('writes the ordinary one so the recorded answer is an order', () => {
    const recorded = recordedFor(sampleMail('ordinary').text);
    expect(recorded).toBeDefined();
    expect(recorded?.answer.items.length).toBeGreaterThan(0);
  });

  it('writes the second one so the answer names an article nobody sells', () => {
    // The catalogue check is the demonstration. Without an answer that invents
    // something, there is nothing for it to catch on a site with no model key.
    const recorded = recordedFor(sampleMail('invented').text);
    expect(recorded?.answer.items.map((item) => item.sku)).toContain('MUG-AZURE');
  });

  it('writes the third one so it matches no recorded answer at all', () => {
    // It has to fall through to `unmatched`, which is an empty basket and fails the
    // schema. A mail meant to be unreadable that happens to contain the word
    // "teapot" is answered with a tidy one-line order.
    expect(recordedFor(sampleMail('nothing').text)).toBeUndefined();
  });

  it('can be asked for one by name, so nothing has to index the list', () => {
    // The panel opens on the ordinary one and has to name it. Reaching into the
    // array for it gives something that may not be there, and a field that starts
    // out undefined is a worse first impression than no examples at all.
    expect(sampleMail('ordinary')).toBe(SAMPLE_MAILS[0]);
    expect(sampleMail('nothing').id).toBe('nothing');
  });
});
