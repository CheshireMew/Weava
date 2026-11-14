import type Database from 'better-sqlite3';
import {SCHEMA_VERSION} from '../../packages/core/src/schema-version.ts';

/** Restore the actual v13/v16 structure, not merely its migration ledger.
 * New migrations must extend this fixture before it can claim to represent an old database. */
export function legacyStorage(db:Database.Database,version:13|16){
  if(SCHEMA_VERSION!==17)throw new Error('Update the historical storage fixture for the new migration.');
  db.transaction(()=>{
    db.exec('DROP TABLE site_events; DROP TABLE event_consumers;');
    if(version===13){
      db.exec('DROP INDEX schedule_entry_status; DROP TABLE staged_requests; DROP TABLE archived_publication_objects; DROP TABLE publication_due; ALTER TABLE media_uploads DROP COLUMN sha256; ALTER TABLE media_uploads DROP COLUMN verified;');
      db.prepare("UPDATE entry_list SET summary=json_remove(summary,'$.cover')").run();
    }
    db.prepare('DELETE FROM schema_migrations WHERE version>?').run(version);
  }).immediate();
}
