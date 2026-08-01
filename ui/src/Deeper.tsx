// ui/src/Deeper.tsx
// Everything that is not part of the sixty second walkthrough, behind tabs.
//
// These panels are the difference between a demo and a proof, but showing all of
// them at once is what made the page unreadable: a visitor could not tell what to
// do first. One tab is open at a time and none of them is open by default.
import { useState } from 'react';
import type { ReactNode } from 'react';

export type DeeperTab = 'connect';

// Three of these have gone, and each for its own reason. "Control panel" held the
// four states per system and the one-off actions; those are on the tiles now, where
// the thing they break is drawn. "Query the database" held a public SQL console: a
// real read-only role behind four layers, but the answer it gave came out of views
// we wrote, so it invited a reader to check our screen against our database. What
// asks nothing of the reader's trust is the MCP server, which the backlog names.
//
// One entry left. It stays a disclosure rather than becoming a plain section
// because the point of this strip is that none of it is part of the first sixty
// seconds.
const TABS: Array<{ id: DeeperTab; label: string; hint: string }> = [
  { id: 'connect', label: 'Your own endpoint', hint: 'Send every delivery somewhere you own' },
];

interface DeeperProps {
  connect: ReactNode;
  /**
   * Which tab is open, when somebody outside decides. The tiles offer a way out of
   * "you only have our word for this", and that way out is this section, so it has
   * to be openable from up there. Left uncontrolled it keeps its own state, which is
   * what every test of it does.
   */
  open?: DeeperTab | null;
  onOpen?: (tab: DeeperTab | null) => void;
}

export function Deeper({ connect, open: controlled, onOpen }: DeeperProps) {
  const [ownOpen, setOwnOpen] = useState<DeeperTab | null>(null);
  const open = controlled === undefined ? ownOpen : controlled;
  const setOpen = (tab: DeeperTab | null) => {
    if (controlled === undefined) setOwnOpen(tab);
    onOpen?.(tab);
  };
  const content: Record<DeeperTab, ReactNode> = { connect };

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
