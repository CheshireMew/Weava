import {
  FileText,
  X,
  Images,
  Palette,
  ChartNoAxesCombined,
  Settings2,
  Shapes,
  ArrowUpRight,
  Search,
  LogOut,
  Check,
  MessageSquare,
  UserRound,
} from 'lucide-react';

export const tabs = [
  ['content', '内容', FileText],
  ['types', '内容类型', Shapes],
  ['media', '媒体', Images],
  ['comments', '评论', MessageSquare],
  ['redirects', '网址别名', ArrowUpRight],
  ['publication-plans', '批量发布计划', Check],
  ['appearance', '网站设置', Palette],
  ['analytics', '访问统计', ChartNoAxesCombined],
  ['search-tools', '网站检查', Search],
  ['operations', '备份与维护', Settings2],
  ['account', '账户', UserRound],
] as const;
export function AdminNavigation({
  compact,
  state,
  tab,
  setMenu,
  navigate,
  logout,
}: {
  compact: boolean;
  state: any;
  tab: string;
  setMenu: (open: boolean) => void;
  navigate: (tab: string) => Promise<boolean>;
  logout: () => Promise<void>;
}) {
  const group = (keys: string[]) => keys.map(key => tabs.find(tab => tab[0] === key)!);
  const tools = group(['types', 'redirects', 'publication-plans', 'search-tools']);
  const links = (items: (typeof tabs)[number][]) => items.map(([key, label, Icon]) => (
    <button aria-current={tab === key ? 'page' : undefined} className={tab === key ? 'active' : ''}
      key={key} onClick={() => navigate(key)}><Icon size={18} />{label}</button>
  ));
  return (
    <>
      {compact && (
        <button className="mobile-menu-close" aria-label="关闭菜单" onClick={() => setMenu(false)}>
          <X size={20} />
        </button>
      )}
      <div className="site-identity">
        <a className="app-brand" href="/admin/" aria-label="返回 Weava 后台">
          <span className="brand-mark" aria-hidden="true">W</span><span title={state?.settings.value.name ?? '你的网站'}>{state?.settings.value.name ?? '你的网站'}</span>
        </a>
        <a href="/" target="_blank" rel="noreferrer" className="view-site" aria-label="查看网站" title="查看网站"><ArrowUpRight size={17} aria-hidden="true" /></a>
      </div>
      <nav aria-label="网站管理">
        <div className="nav-group">{links(group(['content', 'media', 'comments', 'analytics']))}</div>
        <div className="nav-group">{links(group(['appearance', 'operations']))}</div>
        <details className="nav-tools" open={tools.some(item => item[0] === tab) || undefined}>
          <summary>更多管理</summary><div className="nav-group">{links(tools)}</div>
        </details>
        <div className="nav-group">{links(group(['account']))}</div>
      </nav>
      <div className="sidebar-bottom">
        <button onClick={logout}>
          <LogOut size={16} />
          退出
        </button>
      </div>
    </>
  );
}
