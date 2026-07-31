// ui/src/SystemMark.tsx
// The mark that says which system a tile is about before the label is read.
//
// The published outline of the real mark, filled with that brand's colour: the
// Stripe S, the HubSpot sprocket, the Slack hash. Recognisable shape, one colour.
//
// Deliberately not the full-colour logos. Slack's mark alone is four colours, and
// dropping three foreign palettes into a page built on a single accent would fight
// everything else on it. The shape is what carries the recognition; the colour is
// ours to keep consistent. See brand-marks.ts for provenance and licences.
//
// Our own invoice service and mailer have no mark to be faithful to, so they take a
// function glyph from Phosphor rather than something invented for them. The two
// sources on the left are ours in the same way.
import {
  EnvelopeOpen, EnvelopeSimple, Receipt, Storefront, type Icon,
} from '@phosphor-icons/react';
import type { SwitchableTarget } from '@ngl/contracts';
import type { SourceNode } from './machine';
import { BRAND_MARKS } from './brand-marks';

interface Look {
  /** The brand's published colour, or one of ours for our own services. */
  tint: string;
  /** Only for the systems that have no mark of their own. */
  glyph?: Icon;
}

/** Everything the drawing can put a mark on: the five targets and the two sources. */
export type MarkId = SwitchableTarget | SourceNode['id'];

export const SYSTEM_LOOK: Record<MarkId, Look> = {
  stripe: { tint: '#635BFF' },
  hubspot: { tint: '#FF7A59' },
  slack: { tint: '#611F69' },
  ledger: { tint: '#3FB984', glyph: Receipt },
  mailer: { tint: '#5B8DEF', glyph: EnvelopeSimple },
  shop: { tint: '#A78BFA', glyph: Storefront },
  mail: { tint: '#EFB366', glyph: EnvelopeOpen },
};

export function SystemMark({ target }: { target: MarkId }) {
  const look = SYSTEM_LOOK[target];
  const brand = BRAND_MARKS[target];
  const Glyph = look.glyph;

  return (
    <span
      className="system-mark"
      data-testid={`mark-${target}`}
      aria-hidden="true"
      style={{ ['--mark-tint' as string]: look.tint }}
    >
      {brand ? (
        <svg viewBox={brand.viewBox} width="20" height="20" fill="currentColor">
          {brand.paths.map((d) => <path key={d.slice(0, 24)} d={d} />)}
        </svg>
      ) : (
        Glyph && <Glyph size={20} weight="duotone" />
      )}
    </span>
  );
}
