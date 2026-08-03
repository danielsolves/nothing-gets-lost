// ui/src/TileMenu.tsx
// The three dots in the corner of a tile, and what opens under them.
//
// It replaced a drawer at the bottom of the page called "Control panel", which is
// where the four states and the three one-off actions used to live. The distance
// between the picture of a system and the switch that broke it was the whole
// problem: a visitor had to scroll past everything, open a tab, and find the row.
//
// The button is deliberately not hover-only. Hover is a pointer, and specification
// section 1 says the typical visitor may well arrive on a phone. So it is always
// rendered and merely quiet until the tile is approached by a pointer, a keyboard
// or a finger.
import { useEffect, useRef, useState } from 'react';

export interface MenuItem {
  id: string;
  label: string;
  /** What choosing it actually does. The point of the menu, not decoration. */
  means?: string;
  /** Set on a group of mutually exclusive states; true for the one in force. */
  chosen?: boolean;
  run: () => void;
}

export interface MenuSection {
  heading?: string;
  items: MenuItem[];
}

export function TileMenu(props: {
  /** Names the button for anyone who cannot see which tile it sits on. */
  menuLabel: string;
  testId: string;
  sections: MenuSection[];
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  const wrapper = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (open) first.current?.focus();
  }, [open]);

  // Anywhere else on the page closes it. Without this the menu survives a click on
  // the next tile and two of them stand open over the drawing.
  useEffect(() => {
    if (!open) return undefined;
    const away = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  const close = (giveFocusBack: boolean) => {
    setOpen(false);
    if (giveFocusBack) button.current?.focus();
  };

  let index = 0;

  return (
    <span className="tile-menu" ref={wrapper}>
      <button
        type="button"
        ref={button}
        className="tile-menu-toggle"
        data-testid={`menu-${props.testId}`}
        aria-label={props.menuLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <span aria-hidden="true">&#8942;</span>
      </button>

      {open && (
        <div
          className="tile-menu-list"
          role="menu"
          aria-label={props.menuLabel}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              close(true);
            }
          }}
        >
          {props.sections.map((section, sectionIndex) => (
            <div className="tile-menu-section" key={section.heading ?? sectionIndex}>
              {section.heading && (
                <span className="tile-menu-heading" aria-hidden="true">{section.heading}</span>
              )}

              {section.items.map((item) => {
                const isFirst = index === 0;
                index += 1;
                return (
                  <button
                    key={item.id}
                    type="button"
                    ref={isFirst ? first : undefined}
                    role={item.chosen === undefined ? 'menuitem' : 'menuitemradio'}
                    {...(item.chosen === undefined ? {} : { 'aria-checked': item.chosen })}
                    data-testid={`menu-${props.testId}-${item.id}`}
                    className="tile-menu-item"
                    onClick={() => { item.run(); close(false); }}
                  >
                    <span className="tile-menu-label">{item.label}</span>
                    {item.means && <span className="tile-menu-means">{item.means}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
