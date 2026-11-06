import { useId, type ReactNode } from 'react';

export function TabList<Key extends string>({
  label,
  items,
  selected,
  onSelect,
  className,
  idFor,
  panelFor,
  as: Element = 'nav',
}: {
  label: string;
  items: readonly { id: Key; label: ReactNode }[];
  selected: Key;
  onSelect: (key: Key) => void;
  className?: string;
  idFor?: (key: Key) => string;
  panelFor: (key: Key) => string;
  as?: 'nav' | 'div';
}) {
  const prefix = useId(),
    tabId = idFor ?? ((key: Key) => prefix + '-' + key);
  return (
    <Element className={className} role="tablist" aria-label={label}>
      {items.map((item, index) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          id={tabId(item.id)}
          aria-controls={panelFor(item.id)}
          aria-selected={selected === item.id}
          tabIndex={selected === item.id ? 0 : -1}
          onClick={() => onSelect(item.id)}
          onKeyDown={(event) => {
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? items.length - 1
                  : event.key === 'ArrowRight'
                    ? (index + 1) % items.length
                    : event.key === 'ArrowLeft'
                      ? (index + items.length - 1) % items.length
                      : -1;
            if (next < 0) return;
            event.preventDefault();
            onSelect(items[next].id);
            document.getElementById(tabId(items[next].id))?.focus();
          }}
        >
          {item.label}
        </button>
      ))}
    </Element>
  );
}
