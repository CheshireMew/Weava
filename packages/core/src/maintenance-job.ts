import type { JobContext } from './job-context.ts';
import { WeavaError } from '@weava/contracts';
export async function executeMaintenanceJob({ site, job, content }: JobContext) {
  const { operation, payload, id } = job;
  switch (operation) {
    case 'storage-scan': {
      const usage = (await import('./maintenance.ts')).storageUsage(site),
        checkedAt = new Date().toISOString();
      site.store.setState('storage-usage', JSON.stringify({ checkedAt, usage }));
      return { checkedAt };
    }
    case 'backup':
      return (await import('./backup.ts')).createBackup(
        site,
        payload.path ?? process.env.WEAVA_BACKUP_ROOT ?? 'D:/Tools/weava/backups',
        payload.label,
      );
    case 'verify': {
      const { recordBackupVerification } = await import('./backup-management.ts');
      try {
        const result = (await import('./backup.ts')).verifyBackup(payload.path);
        recordBackupVerification(site, payload.path);
        return result;
      } catch (error: any) {
        recordBackupVerification(site, payload.path, error.message);
        throw error;
      }
    }
    case 'archive-history':
      return (await import('./history-archive.ts')).archiveHistory(
        site,
        payload.options,
        payload.review,
      );
    case 'restore-history':
      return (await import('./history-archive.ts')).restoreHistoryArchive(site, payload.id);
    case 'seo-audit':
      return (await import('./seo-task.ts')).executeSeoAudit(
        site,
        (await content()).manager,
        payload,
        (message) => site.updateJob(id, { message }),
      );
    default:
      throw new WeavaError('未知维护操作：' + operation);
  }
}
