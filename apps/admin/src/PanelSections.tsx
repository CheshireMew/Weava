import { useId, useRef, useState, type ReactNode } from 'react';

/** Keep visited forms mounted so switching sections cannot discard edits. */
export function PanelSections({ label, sections, initialSection }: {
  label: string;
  sections: { id: string; label: string; content: ReactNode }[];
  initialSection?: string;
}) {
  const prefix = useId();
  const [selected, setSelected] = useState(() => sections.find(section => section.id === initialSection)?.id ?? sections[0].id);
  const visited = useRef(new Set([selected]));
  const active = sections.some(section => section.id === selected) ? selected : sections[0].id;
  visited.current.add(active);
  return <>
    <div className="panel-sections" role="tablist" aria-label={label}>
      {sections.map((section, index) => <button key={section.id} type="button" role="tab"
        id={`${prefix}-tab-${section.id}`} aria-controls={`${prefix}-panel-${section.id}`}
        aria-selected={active === section.id} tabIndex={active === section.id ? 0 : -1}
        onClick={() => setSelected(section.id)} onKeyDown={event => {
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1
            : event.key === 'ArrowRight' ? (index + 1) % sections.length
            : event.key === 'ArrowLeft' ? (index + sections.length - 1) % sections.length : -1;
          if (next < 0) return;
          event.preventDefault(); setSelected(sections[next].id);
          document.getElementById(`${prefix}-tab-${sections[next].id}`)?.focus();
        }}>{section.label}</button>)}
    </div>
    {sections.map(section => <div key={section.id} role="tabpanel"
      id={`${prefix}-panel-${section.id}`} aria-labelledby={`${prefix}-tab-${section.id}`}
      className="panel-section" hidden={active !== section.id}>
      {visited.current.has(section.id) && section.content}
    </div>)}
  </>;
}
