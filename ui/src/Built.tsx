// ui/src/Built.tsx
// The foot of the page: the stack, named plainly, with the job each part does here.
//
// It was written first as prose, six paragraphs on the queue, the schema and the
// idempotency at each target. That was the right material and the wrong answer. A
// reader who has watched the machine work has one question left and it is short:
// what is this built with. Nobody should have to extract "React" and "Postgres"
// from an argument about SKIP LOCKED, and everything above this section is already
// dense text, so a wall of more text is the worst thing to end on.
//
// So it is a grid, and it is the one part of this page allowed to be a shape rather
// than a sentence. One line per entry, capped by a test, so an argument cannot start
// growing back inside a tile. The numbers that were in the prose are still here, as
// figures beside the names, where they can be read at a glance instead of found.
//
// The reasoning that was cut is not lost. It is in docs/why-no-queue-library.md and
// docs/how-it-works.md, which held it before this section existed, and the closing
// line points at the first of them in the one sentence it is allowed.
import type { ReactNode } from 'react';

interface Part {
  name: string;
  version?: string;
  /** The number or the one-word fact, set beside the name rather than in a sentence. */
  figure: string;
  role: string;
}

// Ordered the way somebody reads a stack: the language, the page, the services, the
// data, what runs it, then what proves it. Not by importance, which would need an
// argument, and an argument is what this section deliberately does not make.
const PARTS: ReadonlyArray<Part> = [
  {
    name: 'TypeScript',
    version: '5.6',
    figure: 'strict',
    role: 'Every service, the page, and the contracts between them.',
  },
  {
    name: 'React',
    version: '18',
    figure: 'no state library',
    role: 'One page, redrawn from one live stream.',
  },
  {
    name: 'Vite',
    version: '7',
    figure: 'nginx',
    role: 'Builds the page, which is then served as static files.',
  },
  {
    name: 'Server-sent events',
    figure: '1 stream',
    role: 'The page follows the machine live, without polling.',
  },
  {
    name: 'NestJS',
    version: '11',
    figure: '6 services',
    role: 'One process per job, from taking the order to delivering it.',
  },
  {
    name: 'Postgres',
    version: '16',
    figure: '16 migrations',
    role: 'Orders, deliveries and the queue in one database.',
  },
  {
    name: 'node-postgres',
    version: '8',
    figure: 'no ORM',
    role: 'Every query is written out, so every query can be read.',
  },
  {
    name: 'Docker Compose',
    figure: '10 services',
    role: 'The whole system on one command, with no key to fill in.',
  },
  {
    name: 'Vitest',
    version: '4',
    figure: '10,000 events',
    role: 'Unit, integration, and a soak run that ends on zero lost.',
  },
  {
    name: 'Testcontainers',
    figure: '9 scenarios',
    role: 'A real Postgres for the integration tests, not a fake one.',
  },
  {
    name: 'Model Context Protocol',
    version: '1.26',
    figure: 'read only',
    role: 'The backlog, served to any MCP client you point at it.',
  },
  {
    // The version is in the name here, the way it is for Docker Compose above: the
    // size is half of what identifies this model and reads wrong split off into the
    // version slot.
    name: 'GPT-5.4 nano',
    figure: 'optional',
    role: 'Reads an order out of a plain mail. No key, recorded answers.',
  },
];

function Tile(props: { part: Part }): ReactNode {
  const { name, version, figure, role } = props.part;
  return (
    <li className="built-item">
      <p className="built-head-row">
        <span className="built-name">{name}</span>
        {version === undefined ? null : <span className="built-version">{version}</span>}
      </p>
      <span className="built-figure">{figure}</span>
      <p className="built-role">{role}</p>
    </li>
  );
}

export function Built() {
  return (
    <section className="built" data-testid="built">
      <div className="built-intro">
        <h2>Built with</h2>
        <p>What each part is doing here, in one line each.</p>
      </div>

      <ul className="built-stack" data-testid="built-stack">
        {PARTS.map((part) => <Tile key={part.name} part={part} />)}
      </ul>

      {/* The one thing on this page that should not be copied, and the only sentence
          of argument left in this section. It costs a line and it is the most honest
          line here, so it stays; the reasoning behind it stays in the repository,
          where it was already written out at length. */}
      <p className="built-note" data-testid="built-note">
        The queue is the only part written by hand rather than installed, which would
        be the wrong call in most projects. It is argued both ways in{' '}
        <code>docs/why-no-queue-library.md</code>.
      </p>
    </section>
  );
}
