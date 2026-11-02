import {
  FileText,
  X,
  PanelsTopLeft,
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
  ['pages', '页面', PanelsTopLeft],
  ['layouts', '布局', PanelsTopLeft],
  ['types', '内容类型', Shapes],
  ['terms', '分类与标签', Shapes],
  ['media', '媒体', Images],
  ['comments', '评论', MessageSquare],
  ['redirects', '网址别名', ArrowUpRight],
  ['publication-plans', '发布计划', Check],
  ['appearance', '外观与导航', Palette],
  ['analytics', '访问统计', ChartNoAxesCombined],
  ['search-tools', '搜索与检查', Search],
  ['operations', '运行与备份', Settings2],
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
  return (
    <>
      {compact && (
        <button className="mobile-menu-close" aria-label="关闭菜单" onClick={() => setMenu(false)}>
          <X size={20} />
        </button>
      )}
      <a className="app-brand" href="/admin/">
        <span>w</span>Weava
      </a>
      <div className="site-name">{state?.settings.value.name ?? '你的网站'}</div>
      <nav aria-label="网站管理">
        {tabs.map(([key, label, Icon]) => (
          <button
            aria-current={tab === key ? 'page' : undefined}
            className={tab === key ? 'active' : ''}
            key={key}
            onClick={() => navigate(key)}
          >
            <Icon size={18} />
            {label}
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <a href="/" target="_blank">
          查看网站
          <ArrowUpRight size={16} />
        </a>
        <button onClick={logout}>
          <LogOut size={16} />
          退出
        </button>
      </div>
    </>
  );
}
