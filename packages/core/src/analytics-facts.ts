import type Database from 'better-sqlite3';
function changeLog(db:Database.Database){
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='analytics_changes'").get())return;
  db.transaction(()=>{
    if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='analytics_changes'").get())return;
    db.exec(`CREATE TABLE analytics_changes(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL,visitor_key TEXT NOT NULL,session_key TEXT NOT NULL);
      CREATE TRIGGER analytics_changes_insert AFTER INSERT ON analytics_facts BEGIN INSERT INTO analytics_changes(id,visitor_key,session_key) VALUES(NEW.id,NEW.visitor_key,NEW.session_key); END;
      CREATE TRIGGER analytics_changes_update AFTER UPDATE ON analytics_facts BEGIN INSERT INTO analytics_changes(id,visitor_key,session_key) VALUES(NEW.id,NEW.visitor_key,NEW.session_key); END;
      CREATE TRIGGER analytics_changes_delete AFTER DELETE ON analytics_facts BEGIN INSERT INTO analytics_changes(id,visitor_key,session_key) VALUES(OLD.id,OLD.visitor_key,OLD.session_key); END;
      CREATE TRIGGER analytics_changes_bound AFTER INSERT ON analytics_changes WHEN NEW.seq%256=0 BEGIN DELETE FROM analytics_changes WHERE seq<NEW.seq-10000; END;`);
  }).immediate();
}
/** Read projection: retain the public event schema, avoid joining three scattered records per event. */
export function analyticsFacts(db:Database.Database){
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='analytics_facts'").get()){changeLog(db);return;}
  const projection=`SELECT e.id,e.kind,e.ts,e.path,e.url,e.label,e.zone,e.referrer,
    COALESCE(NULLIF(e.visitor,''),'legacy-'||e.id),COALESCE(NULLIF(e.session,''),e.id),
    json_array(COALESCE(NULLIF(e.visitor,''),'legacy-'||e.id),COALESCE(NULLIF(e.session,''),e.id)),
    COALESCE(c.country,''),COALESCE(NULLIF(c.browser,''),'未知'),COALESCE(NULLIF(c.os,''),'未知'),COALESCE(NULLIF(c.device,''),'unknown'),COALESCE(NULLIF(c.model,''),'未知'),
    COALESCE(c.channel,''),COALESCE(c.engine,''),COALESCE(c.source,''),COALESCE(c.medium,''),COALESCE(c.campaign,''),COALESCE(a.active_ms,0)
    FROM events e LEFT JOIN event_context c ON c.event_id=e.id LEFT JOIN page_activity a ON a.view_id=e.id`;
  const defaults="country='',browser='未知',os='未知',device='unknown',model='未知',channel='',engine='',source='',medium='',campaign=''";
  const context=`country=NEW.country,browser=COALESCE(NULLIF(NEW.browser,''),'未知'),os=COALESCE(NULLIF(NEW.os,''),'未知'),device=COALESCE(NULLIF(NEW.device,''),'unknown'),model=COALESCE(NULLIF(NEW.model,''),'未知'),channel=NEW.channel,engine=NEW.engine,source=NEW.source,medium=NEW.medium,campaign=NEW.campaign`;
  db.transaction(()=>{
    if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='analytics_facts'").get())return;
    db.exec(`CREATE TABLE analytics_facts(id TEXT PRIMARY KEY,kind TEXT NOT NULL,ts TEXT NOT NULL,path TEXT NOT NULL,url TEXT NOT NULL,label TEXT NOT NULL,zone TEXT NOT NULL,referrer TEXT NOT NULL,
      visitor_key TEXT NOT NULL,session_key TEXT NOT NULL,session_token TEXT NOT NULL,country TEXT NOT NULL,browser TEXT NOT NULL,os TEXT NOT NULL,device TEXT NOT NULL,model TEXT NOT NULL,
      channel TEXT NOT NULL,engine TEXT NOT NULL,source TEXT NOT NULL,medium TEXT NOT NULL,campaign TEXT NOT NULL,active_ms INTEGER NOT NULL);
      INSERT INTO analytics_facts ${projection};
      CREATE INDEX analytics_fact_date ON analytics_facts(ts,path);
      CREATE INDEX analytics_fact_path ON analytics_facts(path,ts);
      CREATE TRIGGER analytics_fact_event_insert AFTER INSERT ON events BEGIN INSERT INTO analytics_facts ${projection} WHERE e.id=NEW.id; END;
      CREATE TRIGGER analytics_fact_event_update AFTER UPDATE ON events BEGIN DELETE FROM analytics_facts WHERE id=OLD.id;INSERT INTO analytics_facts ${projection} WHERE e.id=NEW.id; END;
      CREATE TRIGGER analytics_fact_event_delete AFTER DELETE ON events BEGIN DELETE FROM analytics_facts WHERE id=OLD.id; END;
      CREATE TRIGGER analytics_fact_context_insert AFTER INSERT ON event_context BEGIN UPDATE analytics_facts SET ${context} WHERE id=NEW.event_id; END;
      CREATE TRIGGER analytics_fact_context_update AFTER UPDATE ON event_context BEGIN
        UPDATE analytics_facts SET ${defaults} WHERE id=OLD.event_id AND OLD.event_id<>NEW.event_id;
        UPDATE analytics_facts SET ${context} WHERE id=NEW.event_id; END;
      CREATE TRIGGER analytics_fact_context_delete AFTER DELETE ON event_context BEGIN UPDATE analytics_facts SET ${defaults} WHERE id=OLD.event_id; END;
      CREATE TRIGGER analytics_fact_activity_insert AFTER INSERT ON page_activity BEGIN UPDATE analytics_facts SET active_ms=NEW.active_ms WHERE id=NEW.view_id; END;
      CREATE TRIGGER analytics_fact_activity_update AFTER UPDATE ON page_activity BEGIN UPDATE analytics_facts SET active_ms=0 WHERE id=OLD.view_id AND OLD.view_id<>NEW.view_id;UPDATE analytics_facts SET active_ms=NEW.active_ms WHERE id=NEW.view_id; END;
      CREATE TRIGGER analytics_fact_activity_delete AFTER DELETE ON page_activity BEGIN UPDATE analytics_facts SET active_ms=0 WHERE id=OLD.view_id; END;`);
  }).immediate();
  changeLog(db);
}
