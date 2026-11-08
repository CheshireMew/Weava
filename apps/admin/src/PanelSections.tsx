import {TabList} from './TabList.tsx';
import {useId,useRef,useState,type ReactNode} from 'react';

/** Keep visited forms mounted so switching sections cannot discard edits. */
export function PanelSections({ label, sections, initialSection, selectedSection, onSelectSection }: {
  label: string;
  sections: { id: string; label: string; content: ReactNode }[];
  initialSection?: string;
  selectedSection?: string;
  onSelectSection?: (id: string) => void;
}) {
  const prefix = useId();
  const [selected, setSelected] = useState(() => sections.find(section => section.id === initialSection)?.id ?? sections[0].id);
  const visited = useRef(new Set([selected]));
  const current = selectedSection ?? selected;
  const active = sections.some(section => section.id === current) ? current : sections[0].id;
  visited.current.add(active);
  return <>
    <TabList as="div" className="panel-sections" label={label} items={sections} selected={active} onSelect={id => { setSelected(id); onSelectSection?.(id); }} idFor={key=>prefix+'-tab-'+key} panelFor={key=>prefix+'-panel-'+key}/>
    {sections.map(section => <div key={section.id} role="tabpanel"
      id={`${prefix}-panel-${section.id}`} aria-labelledby={`${prefix}-tab-${section.id}`}
      className="panel-section" hidden={active !== section.id}>
      {visited.current.has(section.id) && section.content}
    </div>)}
  </>;
}
