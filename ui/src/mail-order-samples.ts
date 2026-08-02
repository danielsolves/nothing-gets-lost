// ui/src/mail-order-samples.ts
// Three mails to press, and the reason each one is worded the way it is.
//
// They are here rather than in the panel because their wording is load-bearing and
// has a test on it. The public site holds no model key, so the extractor replays
// `fixtures/extractions.json` and picks the answer by looking for a substring of the
// mail. A sample that is reworded into missing its answer still looks fine, still
// gets a reply, and quietly stops showing the thing its button promises.
//
// What was rejected was letting the panel open with an empty field. An empty field
// asks a visitor to imagine what a customer mail looks like before they can find out
// what the page does, and the two mails that matter here are the ones a visitor would
// never think to write: the one that names an article we do not sell, and the one
// that names nothing at all.

/** The three ways this can go, which is also the order they are offered in. */
export type SampleId = 'ordinary' | 'invented' | 'nothing';

export interface SampleMail {
  id: SampleId;
  /** What the button says. It describes the mail, never the outcome: with a real
   *  key the model may read any of these differently, and a button promising a
   *  refusal that does not arrive would be the page contradicting itself. */
  label: string;
  text: string;
}

export const SAMPLE_MAILS: readonly SampleMail[] = [
  {
    id: 'ordinary',
    label: 'An ordinary order',
    text: [
      'Hello,',
      '',
      'please send 3 blue mugs and 2 oak coasters to the Berlin office.',
      'Invoice to head office as usual.',
      '',
      'Best regards, M. Berger (m@example.com)',
    ].join('\n'),
  },
  {
    id: 'invented',
    label: 'An article we do not sell',
    text: [
      'Hi,',
      '',
      'we need 4 azure mugs for the new meeting room, same address as last time.',
      '',
      'Thanks, M. Berger (m@example.com)',
    ].join('\n'),
  },
  {
    id: 'nothing',
    // The mail the chaos button has always sent, which until recently was answered
    // with a tidy three-mug order because nothing matched and the file fell back to
    // its first entry.
    label: 'Nothing a catalogue can match',
    text: 'Hi, send me the blue ones. 12,00 for each I think. Thanks',
  },
];

/** By name, because indexing the list gives something that may not be there. */
export function sampleMail(id: SampleId): SampleMail {
  const found = SAMPLE_MAILS.find((mail) => mail.id === id);
  if (found === undefined) throw new Error(`no sample mail called ${id}`);
  return found;
}
