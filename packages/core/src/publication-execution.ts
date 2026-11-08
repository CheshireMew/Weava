import type { PublishOptions, Release } from '@weava/contracts';
import { RetryablePublicationConflict } from './publication-context.ts';
import { commitPublication, type PreparedPublication } from './publication.ts';
import type { Site } from './site.ts';

type TrackedRecord = NonNullable<ReturnType<Site['store']['get']>>;
export interface PublicationExecution {
  scope: 'publication-schedule' | 'publication-plan';
  row: TrackedRecord;
  options?: PublishOptions;
  completedAt: () => string;
  completeLabel: string;
  failureLabel: string;
  failureStatuses: string[];
  guard: () => void;
}
export function hasCompetingPublication(site: Pick<Site, 'store'>, jobId = '') {
  return !!site.store.raw
    .prepare(
      "SELECT 1 FROM jobs WHERE operation='publish' AND status IN ('queued','running') AND id<>? LIMIT 1",
    )
    .get(jobId);
}
export function failTrackedPublication(
  site: Pick<Site, 'store'>,
  execution: Pick<PublicationExecution, 'scope' | 'row' | 'failureLabel' | 'failureStatuses'>,
  error: unknown,
) {
  if (error instanceof RetryablePublicationConflict) return;
  const { scope, row, failureLabel, failureStatuses } = execution;
  site.store.raw
    .transaction(() => {
      const current = site.store.get(scope, row.id);
      if (current?.revision === row.revision && failureStatuses.includes(current.value.status))
        site.store.put(
          scope,
          row.id,
          {
            ...current.value,
            status: 'failed',
            attempts: current.value.attempts + 1,
            error: error instanceof Error ? error.message : String(error),
          },
          row.revision,
          failureLabel,
        );
    })
    .immediate();
}
export function commitTrackedPublication(
  site: Site,
  prepared: PreparedPublication,
  execution: PublicationExecution,
) {
  const { scope, row, options, completedAt, completeLabel, guard } = execution;
  return commitPublication(
    site,
    prepared,
    options,
    (release) => {
      site.store.put(
        scope,
        row.id,
        {
          ...row.value,
          status: 'complete',
          attempts: row.value.attempts + 1,
          releaseId: release.id,
          completedAt: completedAt(),
          error: undefined,
        },
        row.revision,
        completeLabel,
      );
    },
    guard,
  );
}
export async function executeTrackedPublication(
  site: Site,
  execution: PublicationExecution,
  prepare: () => PreparedPublication,
  validate: (release: Release) => Promise<void>,
) {
  try {
    const prepared = prepare();
    await validate(prepared.release);
    return commitTrackedPublication(site, prepared, execution);
  } catch (error) {
    failTrackedPublication(site, execution, error);
    throw error;
  }
}
