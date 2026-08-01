// ui/src/Deeper.tsx
// Everything that is not part of the sixty second walkthrough, behind tabs.
//
// These panels are the difference between a demo and a proof, but showing all of
// them at once is what made the page unreadable: a visitor could not tell what to
// do first. One tab is open at a time and none of them is open by default.
import { useState } from 'react';
import type { ReactNode } from 'react';

export type DeeperTab = 'connect' | 'sql';

// "Control panel" used to be the first of these, holding the four states per system
// and the three one-off actions. Those are on the tiles now, where the thing they
// break is drawn, so the drawer no longer has a copy of them to fall out of date.
const TABS: Array<{ id: DeeperTab; label: string; hint: string }> = [
  { id: 'connect', label: 'Your own systems', hint: 'Send the record somewhere you own' },
  { id: 'sql', label: 'Query the database', hint: 'Read-only. Do not trust my screen' },
];

interface DeeperProps {
  connect: ReactNode;
  sql: ReactNode;
  /**
   * Which tab is open, when somebody outside decides. The tiles offer a way out of
   * "you only have our word for this", and that way out is this section, so it has
   * to be openable from up there. Left uncontrolled it keeps its own state, which is
   * what every test of it does.
   */
  open?: DeeperTab | null;
  onOpen?: (tab: DeeperTab | null) => void;
}

export function Deeper({ connect, sql, open: controlled, onOpen }: DeeperProps) {
  const [ownOpen, setOwnOpen] = useState<DeeperTab | null>(null);
  const open = controlled === undefined ? ownOpen : controlled;
  const setOpen = (tab: DeeperTab | null) => {
    if (controlled === undefined) setOwnOpen(tab);
    onOpen?.(tab);
  };
  const content: Record<DeeperTab, ReactNode> = { connect, sql };

  return (
    <section className="deeper" data-testid="deeper">
      <h2>Go further</h2>
      <div className="deeper-tabs" role="tablist" aria-label="Further tools">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={open === tab.id}
            aria-controls={`panel-${tab.id}`}
            className={open === tab.id ? 'open' : undefined}
            onClick={() => setOpen(open === tab.id ? null : tab.id)}
            data-testid={`deeper-tab-${tab.id}`}
          >
            <span className="deeper-label">{tab.label}</span>
            <span className="deeper-hint">{tab.hint}</span>
          </button>
        ))}
      </div>

      {open && (
        <div
          role="tabpanel"
          id={`panel-${open}`}
          aria-labelledby={`tab-${open}`}
          data-testid={`deeper-panel-${open}`}
        >
          {content[open]}
        </div>
      )}
    </section>
  );
}
