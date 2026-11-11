import Database from 'better-sqlite3';
import {analyticsIndex} from '../../packages/core/src/analytics-index.ts';
import {analyticsFacts} from '../../packages/core/src/analytics-facts.ts';
import {analyticsArchiveSchema} from '../../packages/core/src/analytics-archive.ts';

export function analyticsDatabase() {
  const db=new Database(':memory:');
  db.exec(`
    CREATE TABLE events(id TEXT PRIMARY KEY,kind TEXT,ts TEXT,path TEXT,visitor TEXT,session TEXT,url TEXT,label TEXT,zone TEXT,referrer TEXT,release_id TEXT);
    CREATE TABLE event_context(event_id TEXT PRIMARY KEY,country TEXT,browser TEXT,os TEXT,device TEXT,model TEXT,language TEXT,channel TEXT,engine TEXT,source TEXT,medium TEXT,campaign TEXT,version INTEGER);
    CREATE TABLE page_activity(view_id TEXT PRIMARY KEY,last_seen TEXT,active_ms INTEGER,scroll INTEGER,closed INTEGER);
    CREATE TABLE legacy_sources(id TEXT PRIMARY KEY,path TEXT,data TEXT);
    CREATE TABLE historical_views(entry_id TEXT PRIMARY KEY,source_id TEXT,path TEXT,views INTEGER,captured_at TEXT);
    CREATE TABLE view_counts(path TEXT PRIMARY KEY,views INTEGER);
    CREATE TRIGGER count_view_insert AFTER INSERT ON events WHEN NEW.kind='view' BEGIN
      INSERT INTO view_counts VALUES(NEW.path,1) ON CONFLICT(path) DO UPDATE SET views=views+1; END;
    CREATE TRIGGER count_view_delete AFTER DELETE ON events WHEN OLD.kind='view' BEGIN
      UPDATE view_counts SET views=views-1 WHERE path=OLD.path; END;
    CREATE TRIGGER count_view_update AFTER UPDATE ON events BEGIN
      UPDATE view_counts SET views=views-1 WHERE path=OLD.path AND OLD.kind='view';
      INSERT INTO view_counts SELECT NEW.path,1 WHERE NEW.kind='view' ON CONFLICT(path) DO UPDATE SET views=views+1; END;
    CREATE TABLE crawler_requests(id TEXT PRIMARY KEY,ts TEXT,path TEXT,agent TEXT,status INTEGER);
    CREATE INDEX event_date ON events(ts,path);
  `);
  analyticsIndex(db);analyticsFacts(db);analyticsArchiveSchema(db);
  return db;
}
