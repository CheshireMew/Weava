import type Database from 'better-sqlite3';
/** Derived indexes cover legacy/imported raw SQL writes as well as collect(). */
export function analyticsIndex(db:Database.Database){
  db.exec('CREATE INDEX IF NOT EXISTS activity_open_seen ON page_activity(closed,last_seen DESC)');
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='analytics_generations'").get())return;
  const visitor=(row:string)=>`COALESCE(NULLIF(${row}.visitor,''),'legacy-'||${row}.id)`;
  const session=(row:string)=>`COALESCE(NULLIF(${row}.session,''),${row}.id)`;
  const metricVisitor=(row:string)=>`COALESCE(NULLIF(${row}.visitor,''),${row}.id)`;
  const add=(row:string)=>`
    INSERT INTO analytics_session_bounds VALUES(${visitor(row)},${session(row)},${row}.id,${row}.id,${row}.ts,${row}.ts,1)
    ON CONFLICT(visitor_key,session_key) DO UPDATE SET
      first_id=CASE WHEN excluded.first_ts<first_ts OR excluded.first_ts=first_ts AND excluded.first_id<first_id THEN excluded.first_id ELSE first_id END,
      first_ts=MIN(first_ts,excluded.first_ts),
      last_id=CASE WHEN excluded.last_ts>last_ts OR excluded.last_ts=last_ts AND excluded.last_id>last_id THEN excluded.last_id ELSE last_id END,
      last_ts=MAX(last_ts,excluded.last_ts),views=views+1;
    INSERT INTO analytics_visitors VALUES('',${metricVisitor(row)},1),(${row}.path,${metricVisitor(row)},1)
      ON CONFLICT(path,visitor_key) DO UPDATE SET refs=refs+1;
    INSERT INTO analytics_session_paths VALUES('',${metricVisitor(row)},${session(row)},1),(${row}.path,${metricVisitor(row)},${session(row)},1)
      ON CONFLICT(path,visitor_key,session_key) DO UPDATE SET refs=refs+1;`;
  const remove=(row:string,excluded:string)=>`
    UPDATE analytics_session_bounds SET views=views-1 WHERE visitor_key=${visitor(row)} AND session_key=${session(row)};
    DELETE FROM analytics_session_bounds WHERE visitor_key=${visitor(row)} AND session_key=${session(row)} AND views=0;
    UPDATE analytics_session_bounds SET
      first_id=(SELECT id FROM events WHERE visitor=${row}.visitor AND session=${row}.session AND kind='view' AND id<>${excluded} ORDER BY ts,id LIMIT 1),
      first_ts=(SELECT ts FROM events WHERE visitor=${row}.visitor AND session=${row}.session AND kind='view' AND id<>${excluded} ORDER BY ts,id LIMIT 1)
      WHERE visitor_key=${visitor(row)} AND session_key=${session(row)} AND first_id=${row}.id;
    UPDATE analytics_session_bounds SET
      last_id=(SELECT id FROM events WHERE visitor=${row}.visitor AND session=${row}.session AND kind='view' AND id<>${excluded} ORDER BY ts DESC,id DESC LIMIT 1),
      last_ts=(SELECT ts FROM events WHERE visitor=${row}.visitor AND session=${row}.session AND kind='view' AND id<>${excluded} ORDER BY ts DESC,id DESC LIMIT 1)
      WHERE visitor_key=${visitor(row)} AND session_key=${session(row)} AND last_id=${row}.id;
    UPDATE analytics_visitors SET refs=refs-1 WHERE path IN ('',${row}.path) AND visitor_key=${metricVisitor(row)};
    DELETE FROM analytics_visitors WHERE path IN ('',${row}.path) AND visitor_key=${metricVisitor(row)} AND refs=0;
    UPDATE analytics_session_paths SET refs=refs-1 WHERE path IN ('',${row}.path) AND visitor_key=${metricVisitor(row)} AND session_key=${session(row)};
    DELETE FROM analytics_session_paths WHERE path IN ('',${row}.path) AND visitor_key=${metricVisitor(row)} AND session_key=${session(row)} AND refs=0;`;
  db.transaction(()=>{
    // Another process may have completed the one-time migration while this connection waited.
    if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='analytics_generations'").get())return;
    db.exec(`CREATE INDEX IF NOT EXISTS event_session_order ON events(visitor,session,kind,ts,id);
      CREATE INDEX IF NOT EXISTS event_path_date ON events(path,ts);
      CREATE TABLE analytics_session_bounds(visitor_key TEXT NOT NULL,session_key TEXT NOT NULL,first_id TEXT NOT NULL,last_id TEXT NOT NULL,first_ts TEXT NOT NULL,last_ts TEXT NOT NULL,views INTEGER NOT NULL,PRIMARY KEY(visitor_key,session_key));
      CREATE TABLE analytics_visitors(path TEXT NOT NULL,visitor_key TEXT NOT NULL,refs INTEGER NOT NULL,PRIMARY KEY(path,visitor_key));
      CREATE TABLE analytics_session_paths(path TEXT NOT NULL,visitor_key TEXT NOT NULL,session_key TEXT NOT NULL,refs INTEGER NOT NULL,PRIMARY KEY(path,visitor_key,session_key));
      CREATE TABLE analytics_click_counts(path TEXT PRIMARY KEY,clicks INTEGER NOT NULL);
      CREATE TABLE analytics_generations(id INTEGER PRIMARY KEY CHECK(id=1),events INTEGER NOT NULL,activity INTEGER NOT NULL);
      INSERT INTO analytics_generations VALUES(1,0,0);
      INSERT INTO analytics_session_bounds
        WITH views AS (SELECT *,COALESCE(NULLIF(visitor,''),'legacy-'||id) visitor_key,COALESCE(NULLIF(session,''),id) session_key FROM events WHERE kind='view'),
        ordered AS (SELECT *,FIRST_VALUE(id) OVER(PARTITION BY visitor_key,session_key ORDER BY ts,id) first_id,FIRST_VALUE(id) OVER(PARTITION BY visitor_key,session_key ORDER BY ts DESC,id DESC) last_id FROM views)
        SELECT visitor_key,session_key,first_id,last_id,MIN(ts),MAX(ts),COUNT(*) FROM ordered GROUP BY visitor_key,session_key;
      INSERT INTO analytics_visitors SELECT '',COALESCE(NULLIF(visitor,''),id),COUNT(*) FROM events WHERE kind='view' GROUP BY 2;
      INSERT INTO analytics_visitors SELECT path,COALESCE(NULLIF(visitor,''),id),COUNT(*) FROM events WHERE kind='view' GROUP BY 1,2;
      INSERT INTO analytics_session_paths SELECT '',COALESCE(NULLIF(visitor,''),id),COALESCE(NULLIF(session,''),id),COUNT(*) FROM events WHERE kind='view' GROUP BY 2,3;
      INSERT INTO analytics_session_paths SELECT path,COALESCE(NULLIF(visitor,''),id),COALESCE(NULLIF(session,''),id),COUNT(*) FROM events WHERE kind='view' GROUP BY 1,2,3;
      INSERT INTO analytics_click_counts SELECT path,COUNT(*) FROM events WHERE kind='click' GROUP BY path;
      CREATE TRIGGER analytics_view_insert AFTER INSERT ON events WHEN NEW.kind='view' BEGIN ${add('NEW')} END;
      CREATE TRIGGER analytics_view_delete AFTER DELETE ON events WHEN OLD.kind='view' BEGIN ${remove('OLD','OLD.id')} END;
      CREATE TRIGGER analytics_view_remove_update BEFORE UPDATE OF id,kind,path,visitor,session,ts ON events WHEN OLD.kind='view' BEGIN ${remove('OLD','OLD.id')} END;
      CREATE TRIGGER analytics_view_add_update AFTER UPDATE OF id,kind,path,visitor,session,ts ON events WHEN NEW.kind='view' BEGIN ${add('NEW')} END;
      CREATE TRIGGER analytics_click_insert AFTER INSERT ON events WHEN NEW.kind='click' BEGIN INSERT INTO analytics_click_counts VALUES(NEW.path,1) ON CONFLICT(path) DO UPDATE SET clicks=clicks+1; END;
      CREATE TRIGGER analytics_click_delete AFTER DELETE ON events WHEN OLD.kind='click' BEGIN UPDATE analytics_click_counts SET clicks=clicks-1 WHERE path=OLD.path; END;
      CREATE TRIGGER analytics_click_update AFTER UPDATE OF kind,path ON events BEGIN
        UPDATE analytics_click_counts SET clicks=clicks-1 WHERE OLD.kind='click' AND path=OLD.path;
        INSERT INTO analytics_click_counts SELECT NEW.path,1 WHERE NEW.kind='click' ON CONFLICT(path) DO UPDATE SET clicks=clicks+1; END;
      CREATE TRIGGER analytics_event_insert AFTER INSERT ON events BEGIN UPDATE analytics_generations SET events=events+1 WHERE id=1; END;
      CREATE TRIGGER analytics_event_delete AFTER DELETE ON events BEGIN UPDATE analytics_generations SET events=events+1 WHERE id=1; END;
      CREATE TRIGGER analytics_event_update AFTER UPDATE ON events BEGIN UPDATE analytics_generations SET events=events+1 WHERE id=1; END;
      CREATE TRIGGER analytics_activity_insert AFTER INSERT ON page_activity BEGIN UPDATE analytics_generations SET activity=activity+1 WHERE id=1; END;
      CREATE TRIGGER analytics_activity_update AFTER UPDATE ON page_activity BEGIN UPDATE analytics_generations SET activity=activity+1 WHERE id=1; END;
      CREATE TRIGGER analytics_context_insert AFTER INSERT ON event_context BEGIN UPDATE analytics_generations SET activity=activity+1 WHERE id=1; END;
      CREATE TRIGGER analytics_context_update AFTER UPDATE ON event_context BEGIN UPDATE analytics_generations SET activity=activity+1 WHERE id=1; END;
      CREATE TRIGGER analytics_history_insert AFTER INSERT ON historical_views BEGIN UPDATE analytics_generations SET events=events+1 WHERE id=1; END;
      CREATE TRIGGER analytics_history_update AFTER UPDATE ON historical_views BEGIN UPDATE analytics_generations SET events=events+1 WHERE id=1; END;
      CREATE TRIGGER analytics_history_delete AFTER DELETE ON historical_views BEGIN UPDATE analytics_generations SET events=events+1 WHERE id=1; END;`);
  }).immediate();
}
