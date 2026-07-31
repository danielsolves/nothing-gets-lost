// ui/src/NodeTile.tsx
// One tile, for every node in the drawing.
//
// It exists because there were two code paths, one for a source and one for a
// system, and two paths drift: the order mail ended up wider than Slack and read as
// a different kind of thing, which it is not. There is one tile now. A source
// differs from a system in what it can be asked (no faults, so no state and no
// activity line) and in a dashed border that says it is not somewhere we call.
// Everything else about it is identical, and identical by construction rather than
// by two people keeping two blocks in step.
//
// The one deliberate exception is the shop, which carries the button that starts the
// demo and the form folded behind it. That is passed in as `extra` rather than
// branched on here: this file should not know which node is the entry point.
import type { SwitchState } from '@ngl/contracts';
import type { Activity } from './activity';
import type { Fault, Node } from './machine';
import { SystemMark } from './SystemMark';
import { TileMenu, type MenuSection } from './TileMenu';

export function NodeTile(props: {
  node: Node;
  /** Only a system has one. A source is not somewhere we call. */
  state?: SwitchState;
  /** The fault in force, so the tile can name it in words. */
  inForce?: Fault;
  /** What this node is doing right now, or null when there is nothing to say. */
  doing?: Activity | null;
  /** Set while the order open in the queue is passing through here. */
  tracked?: 'open' | 'done';
  /** What the last one-off action reported back. */
  said?: string;
  menu?: MenuSection[];
  menuLabel?: string;
  /** Anything this one node carries that the others do not. */
  extra?: React.ReactNode;
}) {
  const { node, state } = props;

  return (
    <div
      className={node.kind === 'source' ? 'target source' : 'target'}
      data-testid={`box-${node.id}`}
      data-state={state}
      data-tracked={props.tracked}
    >
      {/* What the tile is, kept together and kept apart from what it is doing. The
          mark used to sit above a centred name with the note under it, which made
          the note the first of the report lines rather than a subtitle of the name.
          Beside the mark, the two read as one heading. */}
      <span className="target-head" data-testid={`head-${node.id}`}>
        <SystemMark target={node.id} />
        <span className="target-titles">
          <span className="name">{node.label}</span>
          <span className="note">{node.note}</span>
        </span>
      </span>

      {/* What this node is doing, always, not only when something is stuck at it.
          A tile that says nothing while the machine works looks like a tile of a
          machine that is not working. */}
      {props.doing && (
        <span className="doing" data-testid={`doing-${node.id}`} data-tone={props.doing.tone}>
          {props.doing.text}
        </span>
      )}

      {/* Silent while a system is simply working: five tiles announcing
          "Reachable" is five lines of noise saying nothing happened. */}
      {state && state !== 'up' && props.inForce && (
        <span className="fault" data-testid={`state-${node.id}`}>{props.inForce.label}</span>
      )}

      {props.said && (
        <span className="said" data-testid={`said-${node.id}`}>{props.said}</span>
      )}

      {props.extra}

      {props.menu && props.menu.length > 0 && props.menuLabel && (
        <TileMenu testId={node.id} menuLabel={props.menuLabel} sections={props.menu} />
      )}
    </div>
  );
}
