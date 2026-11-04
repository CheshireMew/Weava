import { isDeepStrictEqual } from 'node:util';
import type { Release, Settings, Term } from '@weava/contracts';
import { projectSettingTerms } from './taxonomy.ts';

export function settingsPublicationState(settings: Settings, terms: Term[], published: Release | null) {
  // Stored JSON omits undefined fields. Publication also resolves legacy taxonomy IDs.
  const json = (value: unknown) => JSON.parse(JSON.stringify(value));
  const ordered = (items: Term[]) => [...items].sort((a, b) => a.id.localeCompare(b.id));
  return {
    settingsPending: !published || !isDeepStrictEqual(json(projectSettingTerms(settings, terms)), published.settings),
    termsPending: !isDeepStrictEqual(json(ordered(terms)), ordered(published?.terms ?? [])),
  };
}
