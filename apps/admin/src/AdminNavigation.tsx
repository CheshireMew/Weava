import {
  FileText,
  X,
  Images,
  Palette,
  ChartNoAxesCombined,
  Settings2,
  ArrowUpRight,
  LogOut,
  MessageSquare,
  UserRound,
  NotebookPen,
} from 'lucide-react';
import {isNoteType} from '@weava/contracts';

export const tabs = [
  ['content', '文章', FileText],
  ['notes', '笔记', NotebookPen],
  ['media', '媒体', Images],
  ['comments', '评论', MessageSquare],
  ['appearance', '网站设置', Palette],
  ['analytics', '访问统计', ChartNoAxesCombined],
  ['operations', '备份与维护', Settings2],
  ['account', '账户', UserRound],
] as const;
export function AdminNavigation({
  compact,
  state,
  tab,
  setMenu,
  navigate,
  preload,
  logout,
}: {
  compact: boolean;
  state: any;
  tab: string;
  setMenu: (open: boolean) => void;
  navigate: (tab: string) => Promise<boolean>;
  preload?: (tab: string) => void;
  logout: () => Promise<void>;
}) {
  const capability:Record<string,string>={content:'content',notes:'content',media:'media',comments:'engagement',analytics:'analytics'};
  const group = (keys: string[]) => keys.filter(key=>(key!=='notes'||state?.types?.some((row:any)=>isNoteType(row.value)))&&(!state?.features||!capability[key]||state.features.includes(capability[key]))).map(key => tabs.find(tab => tab[0] === key)!);
  const links = (items: (typeof tabs)[number][]) => items.map(([key, label, Icon]) => (
    <button aria-current={tab === key ? 'page' : undefined} className={tab === key ? 'active' : ''}
      key={key} onPointerEnter={() => preload?.(key)} onFocus={() => preload?.(key)} onClick={() => navigate(key)}><Icon size={18} />{label}</button>
  ));
  return (
    <>
      {compact && (
        <button className="mobile-menu-close" aria-label="关闭菜单" onClick={() => setMenu(false)}>
          <X size={20} />
        </button>
      )}
      <div className="site-identity">
        <a className="app-brand" href={window.location.pathname} aria-label="返回 Weava 后台">
          {state?.settings.value.logo ? <img className="brand-logo" src={state.siteIcon ?? state.settings.value.logo} alt="" width="30" height="30" /> : <span className="brand-mark" aria-hidden="true">W</span>}<span title={state?.settings.value.name ?? '你的网站'}>{state?.settings.value.name ?? '你的网站'}</span>
        </a>
        <a href="/" target="_blank" rel="noreferrer" className="view-site" aria-label="查看网站" title="查看网站"><ArrowUpRight size={17} aria-hidden="true" /></a>
      </div>
      <nav aria-label="网站管理">
        <div className="nav-group">{links(group(['content', 'notes', 'media', 'comments', 'analytics']))}</div>
        <div className="nav-group">{links(group(['appearance', 'operations']))}</div>
        <div className="nav-group nav-account-row">
          {links(group(['account']))}
          <button type="button" className="nav-logout" onClick={logout} aria-label="退出登录" title="退出登录">
            <LogOut size={18} aria-hidden="true" />
          </button>
        </div>
      </nav>
    </>
  );
}
