export interface AnalyticsTotals {
  views: number;
  visitors: number;
  sessions: number;
  clicks: number;
}
export interface AnalyticsDimension {
  name: string;
  visitors: number;
  share: number;
}
export interface AnalyticsVisitor {
  id: string;
  views: number;
  sessions: number;
  firstSeen: string;
  lastSeen: string;
  entryPath: string;
  exitPath: string;
  country: string;
  browser: string;
  os: string;
  device: string;
  model: string;
  channel: string;
  source: string;
  activeMs: number;
}
export interface GeoStatus {
  available: boolean;
  updating: boolean;
  provider: string;
  license: string;
  attributionUrl: string;
  updatedAt: string | null;
  builtAt: string | null;
  checkedAt: string | null;
  error: string | null;
}
export interface AnalyticsRealtime {
  count: number;
  windowMinutes: number;
  at: string;
  visitors: {
    id: string;
    session: string;
    path: string;
    lastSeen: string;
    country: string;
    browser: string;
    os: string;
    device: string;
  }[];
}
export interface AnalyticsReport extends AnalyticsTotals {
  pageTitles?: Record<string, string>;
  range: {
    start: string;
    end: string;
    previousStart: string;
    previousEnd: string;
    days: number;
    timezone: string;
  };
  previous: AnalyticsTotals;
  overview: (AnalyticsTotals & {
    name: string;
    start: string;
    end: string;
    previous: AnalyticsTotals;
  })[];
  lifetime: AnalyticsTotals;
  averageActiveMs: number;
  daily: {
    date: string;
    views: number;
    visitors: number;
    sessions: number;
    clicks: number;
    previousViews: number;
    previousVisitors: number;
  }[];
  pages: {
    path: string;
    views: number;
    visitors: number;
    clicks: number;
    entries: number;
    exits: number;
    activeMs: number;
    averageActiveMs: number;
  }[];
  links: { path: string; url: string; zone: string; label: string; clicks: number }[];
  sources: {
    channel: string;
    host: string | null;
    name: string;
    views: number;
    sessions: number;
    visitors: number;
  }[];
  engines: {
    name: string;
    channel: string;
    sessions: number;
    views: number;
    daily: { date: string; sessions: number }[];
    previousSessions: number;
    previousDaily: { date: string; sessions: number }[];
  }[];
  campaigns: {
    source: string;
    medium: string;
    campaign: string;
    sessions: number;
    views: number;
  }[];
  countries: AnalyticsDimension[];
  browsers: AnalyticsDimension[];
  operatingSystems: AnalyticsDimension[];
  devices: AnalyticsDimension[];
  models: AnalyticsDimension[];
  recentVisitors: AnalyticsVisitor[];
  activeVisitors: AnalyticsVisitor[];
  actions: { name: string; count: number }[];
  crawlers: { agent: string; path: string; status: number; requests: number; identity: string }[];
  legacySources: { id: string; path: string }[];
  realtime: AnalyticsRealtime;
  geo: GeoStatus;
  lifetimeViews: number;
  historicalViews: number;
  lifetimePages: { path: string; views: number; historicalViews: number; recordedViews: number }[];
}
export interface AnalyticsVisitorDetail {
  id: string;
  start: string;
  end: string;
  timezone: string;
  page: number;
  pageSize: number;
  total: number;
  pages: number;
  events: {
    id: string;
    kind: string;
    ts: string;
    path: string;
    session: string;
    url: string;
    label: string;
    zone: string;
    referrer: string;
    country: string;
    browser: string;
    os: string;
    device: string;
    model: string;
    activeMs: number;
    scroll: number;
    channel: string;
  }[];
}
