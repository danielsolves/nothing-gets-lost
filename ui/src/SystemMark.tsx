// ui/src/SystemMark.tsx
// The mark that says which system a row is about before the label is read.
//
// One treatment for all five rather than real logos where they happen to be
// available. simple-icons carries Stripe and HubSpot but not Slack, whose mark was
// removed at the trademark holder's request, and our own invoice service and mailer
// have no logo at all. Two real logos, one traced approximation and two stand-ins
// is exactly the mismatched look this is meant to fix.
//
// So: the brand's own colour, plus a glyph naming what the system does. Recognition
// without copying anyone's mark and without drawing a bad one by hand.
//
// Glyphs come from Phosphor rather than hand-rolled paths, and the brand colours are
// the published ones. Nothing here reaches a CDN at runtime, same rule the fonts
// follow: no visitor's IP goes anywhere but this server.
import {
  AddressBook, ChatCircle, CreditCard, EnvelopeSimple, Receipt,
  type Icon,
} from '@phosphor-icons/react';
import type { SwitchableTarget } from '@ngl/contracts';

interface Look {
  /** The brand's published colour, or ours for our own services. */
  tint: string;
  glyph: Icon;
}

export const SYSTEM_LOOK: Record<SwitchableTarget, Look> = {
  stripe: { tint: '#635BFF', glyph: CreditCard },
  hubspot: { tint: '#FF7A59', glyph: AddressBook },
  ledger: { tint: '#3FB984', glyph: Receipt },
  slack: { tint: '#611F69', glyph: ChatCircle },
  mailer: { tint: '#5B8DEF', glyph: EnvelopeSimple },
};

export function SystemMark({ target }: { target: SwitchableTarget }) {
  const look = SYSTEM_LOOK[target];
  const Glyph = look.glyph;

  return (
    <span
      className="system-mark"
      data-testid={`mark-${target}`}
      aria-hidden="true"
      style={{ ['--mark-tint' as string]: look.tint }}
    >
      <Glyph size={20} weight="duotone" />
    </span>
  );
}
