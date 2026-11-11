/** Relevant unscoped/Googlebot HTTP rules, without mistaking another bot's rule for Google's. */
export function googleRobotRules(header = '') {
  let scope = '*'; const rules: string[] = [];
  for (const part of header.split(',')) {
    const scoped = /^\s*([a-z][\w-]*):\s*(.*)$/i.exec(part);
    if (scoped && !/^max-/i.test(scoped[1])) { scope = scoped[1].toLowerCase(); if (scope === '*' || scope === 'googlebot') rules.push(scoped[2]); }
    else if (scope === '*' || scope === 'googlebot') rules.push(part);
  }
  return rules.join(',');
}
export function robotsBlocks(text: string, path: string) {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let group = { agents: [] as string[], rules: [] as { allow: boolean; path: string }[] };
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(user-agent|allow|disallow)\s*:\s*(.*?)\s*$/i.exec(line.split('#')[0]); if (!match) continue;
    const key = match[1].toLowerCase(), value = match[2];
    if (key === 'user-agent') {
      if (group.rules.length) { groups.push(group); group = { agents: [], rules: [] }; }
      group.agents.push(value.toLowerCase());
    } else if (value && group.agents.length) group.rules.push({ allow: key === 'allow', path: value });
  }
  groups.push(group);
  const google = groups.filter(group => group.agents.includes('googlebot'));
  const selected = google.length ? google : groups.filter(group => group.agents.includes('*'));
  let winner: { length: number; allow: boolean } | undefined;
  for (const rule of selected.flatMap(group => group.rules)) {
    const pattern = '^' + rule.path.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*').replace(/\\\$$/, '$');
    if (new RegExp(pattern).test(path)) {
      const length = rule.path.replace(/[*$]/g, '').length;
      if (!winner || length > winner.length || length === winner.length && rule.allow) winner = { length, allow: rule.allow };
    }
  }
  return winner?.allow === false;
}
