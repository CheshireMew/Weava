import type { Entry, Revision } from '@weava/contracts';
import { api } from './api.ts';
import { connectionFailure } from './connection-recovery.ts';
import { matchesDraft } from './local-drafts.ts';

/** Reconcile a lost acknowledgement before sending edits made during the outage. */
export function entryWriter() {
  let uncertain: Revision<Entry> | undefined;
  return async (snapshot: Revision<Entry>): Promise<Revision<Entry>> => {
    let revision = snapshot.revision || null;
    if (uncertain?.id === snapshot.id) {
      try {
        const remote = await api(`entry/${encodeURIComponent(snapshot.id)}`);
        if (matchesDraft({ record: uncertain }, remote)) {
          uncertain = undefined;
          if (matchesDraft({ record: snapshot }, remote)) return remote;
          revision = remote.revision;
        }
      } catch (error: any) {
        if (error.status !== 404 || snapshot.revision) throw error;
      }
    }
    try {
      const saved = await api('entry', { value: snapshot.value, revision });
      uncertain = undefined;
      return saved;
    } catch (error: any) {
      if (connectionFailure(error)) uncertain = { ...snapshot, revision: revision ?? 0 };
      if (error.status === 409) {
        // A timed-out request can commit between the read above and this retry.
        const remote = await api(`entry/${encodeURIComponent(snapshot.id)}`);
        if (matchesDraft({ record: snapshot }, remote)) {
          uncertain = undefined;
          return remote;
        }
      }
      throw error;
    }
  };
}
