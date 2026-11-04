<!-- readme-header:start -->

<p align="center">
  <img src="./assets/readme/logo.svg" width="64" alt="Weava">
</p>

<h1 align="center">Weava</h1>

<p align="center">
  <strong>A self-hosted, content-first website framework for writing, publishing, and managing your site.</strong>
</p>

<p align="center">
  <a href="./README.md">中文</a> · <strong>English</strong> · <a href="./README.ja.md">日本語</a> | <a href="./docs/authoring.md">文档</a> | <a href="./CONTRIBUTING.md">贡献</a> | <a href="https://github.com/CheshireMew/Weava/issues">反馈</a>
</p>

<p align="center">
  <a href="https://x.com/0xCheshire" title="X"><img src="https://img.shields.io/badge/X-%400xCheshire-000000?logo=x&amp;logoColor=white" alt="X：@0xCheshire"></a>
  <a href="https://t.me/CheshireBTC" title="Telegram"><img src="https://img.shields.io/badge/Telegram-CheshireBTC-26A5E4?logo=telegram&amp;logoColor=white" alt="Telegram：CheshireBTC"></a>
  <a href="https://blog.blacknico.com/" title="Blog"><img src="https://img.shields.io/badge/Blog-blog.blacknico.com-2E7D32?logo=rss&amp;logoColor=white" alt="博客：blog.blacknico.com"></a>
  <a href="https://blacknico.com/" title="Homepage"><img src="https://img.shields.io/badge/Home-blacknico.com-1F6FEB?logo=googlechrome&amp;logoColor=white" alt="个人主页：blacknico.com"></a>
</p>

<p align="center">
  <a href="https://github.com/CheshireMew/Weava/stargazers"><img src="https://img.shields.io/github/stars/CheshireMew/Weava?style=flat" alt="GitHub Stars"></a>
  <a href="https://github.com/CheshireMew/Weava/forks"><img src="https://img.shields.io/github/forks/CheshireMew/Weava?style=flat" alt="GitHub Forks"></a>
  <a href="https://github.com/CheshireMew/Weava/blob/main/LICENSE"><img src="https://img.shields.io/github/license/CheshireMew/Weava?style=flat" alt="Repository License"></a>
</p>

<!-- readme-header:end -->

Weava builds and manages blogs, company websites, portfolios, documentation sites, and resource directories. Write in the browser, upload media, preview, and publish; use the CLI or API for custom content structures and automation. Content and settings live in a separate site directory, so everyday updates do not require a rebuild.

## What you can do

| Your task | What Weava provides |
| --- | --- |
| Write and publish | Visual or Markdown editing, tables and media, autosave, revision comparison, conflict recovery, previews, scheduled publishing, and public release rollback |
| Manage a site | About text, friend links, categories, tags, navigation, appearance, and advertisements; content types, custom fields, templates, and extensions through the CLI or API |
| Engage readers | A Newsletter theme, article outlines, likes, comments and replies, owner replies, and moderation |
| Make content discoverable | Chinese-language search, search and sharing metadata, RSS, sitemaps, and redirects from old URLs |
| Understand traffic | Trends, sources, devices, regions, visitor journeys, live visitors, period comparisons, and CSV export |
| Migrate and maintain | WordPress import, media and comment migration, directory backups and recovery, history archiving, and independent program upgrades |

A single owner account manages each site. The admin focuses on everyday writing and site management; use the [CLI or API](docs/interfaces.md) to customize content structures and templates. Private content, media access controls, and optional two-factor authentication are also available. See [Authoring](docs/authoring.md) for usage details. The admin and linked documentation are currently in Chinese.

## Create a site

The currently validated platform is **Windows**. You need **Node.js 24.12–24.x** and **pnpm 12.4.2**. These commands install from source, initialize a site with sample content, then build and start the program:

```powershell
git clone https://github.com/CheshireMew/Weava.git
cd Weava
powershell -NoProfile -File .\scripts\setup.ps1
powershell -NoProfile -File .\scripts\run.ps1 --site E:\WeavaSites\my-site init --demo --port 4322
powershell -NoProfile -File .\scripts\run.ps1 build
powershell -NoProfile -File .\scripts\run.ps1 --site E:\WeavaSites\my-site start
```

`setup.ps1` installs locked dependencies and the specified pnpm version if missing. Node defaults to `D:\Tools\NodeJS\node.exe`; tools, caches, and dependency storage use drive D. For another Node location, first set `$env:WEAVA_NODE='full path to node.exe'`. Replace `E:\WeavaSites\my-site` with your own data directory if needed.

Keep the terminal open after startup, then publish your first article:

1. Open the one-time setup link printed in the terminal and choose an owner username and password. The link expires after 10 minutes.
2. Sign in to the [local admin](http://127.0.0.1:4322/admin/) with your new account. Create an article and enter its title and body.
3. Choose Preview (预览), then Publish (发布), review the changes, and confirm.
4. Open the [site homepage](http://127.0.0.1:4322/) to view your published article.

Articles autosave as drafts and update the public site after publication is confirmed. Site settings take effect after autosave. The service listens locally by default; initialization and startup do not expose the site to the internet automatically.

If the setup link expires, generate another one for the same site:

```powershell
powershell -NoProfile -File .\scripts\run.ps1 --site E:\WeavaSites\my-site owner setup-link
```

See [Operations, backups, and recovery](docs/operations.md) for password resets, two-factor recovery, and automated initialization.

## Migrate an existing site

WordPress migration accepts standard WXR XML. Run a preflight check, then use the conversion report to import content, attachments, and comments. Select a file under Backups and maintenance (备份与维护) in the admin, or run a CLI preflight:

```powershell
powershell -NoProfile -File .\scripts\run.ps1 --site E:\WeavaSites\my-site migrate wxr --input E:\Exports\wordpress.xml --dry-run
```

Preflight reports changes without saving them. Review unsupported plugin blocks, dynamic blocks, and shortcodes in the editor before publishing. Old URLs, offline media, historical view counts, and WP Statistics data have dedicated migration paths. See [Migration](docs/migration.md) and [WP Statistics migration](docs/wordpress-statistics.md).

## Run the site and manage its data

Framework source and site data are separate. The repository contains the program, documentation, and tests; the site directory holds databases, articles, media, account configuration, analytics, and migration records. Use a complete instance backup to preserve the site. See [Operations](docs/operations.md).

After initialization and a successful build, start the same site with the command below. Double-clicking `start.bat` starts the default `../WeavaSites/demo` site, which must also be initialized beforehand.

```powershell
.\start.bat --site "E:\WeavaSites\my-site"
```

Keep the window open and press Ctrl+C to stop. Run one service per site; add `--port 4323` to change the port. Source, theme, or extension code changes require a rebuild, while everyday editing and publishing use the existing program. Operations covers server use and reverse proxies; platform validation currently covers Windows.

## Development

Astro serves visitor pages, React provides the admin, and the TypeScript core manages content, revisions, publication, search, and maintenance. SQLite stores site data. Ordinary visitor pages do not load the React admin or Lexical editor.

After installing dependencies, run these commands from the repository root:

```powershell
pnpm check
pnpm test
pnpm build
pnpm weava --site E:\WeavaSites\my-site dev
```

Program builds and content publication are separate operations. See [Contributing](CONTRIBUTING.md) for development conventions, focused validation, and browser checks.

## Documentation

| Topic | Entry point |
| --- | --- |
| Writing, media, and publishing | [Authoring](docs/authoring.md) |
| Running, backups, recovery, and upgrades | [Operations](docs/operations.md) · [Accounts and site protection](docs/security.md) |
| Site and analytics migration | [Migration](docs/migration.md) · [WP Statistics](docs/wordpress-statistics.md) |
| Traffic analytics and geolocation | [Analytics](docs/analytics.md) |
| Customization and automation | [API and CLI](docs/interfaces.md) · [API reference](docs/api-reference.md) · [Themes and extensions](docs/extensions.md) |
| Architecture and maintenance records | [Architecture and data](docs/architecture.md) · [Implementation](docs/implementation.md) · [Completion and validation records](docs/completion-plan.md) |

## Star History

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/CheshireMew/Weava/star-history/star-history-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/CheshireMew/Weava/star-history/star-history.svg">
  <img alt="GitHub Star History" src="https://raw.githubusercontent.com/CheshireMew/Weava/star-history/star-history.svg">
</picture>

## License and third-party resources

The framework is licensed under **AGPL-3.0-only**. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Site articles, source media, analytics, and private configuration are outside this repository's software distribution.

Third-party dependencies retain their own licenses; see the [dependency inventory](docs/dependencies.json). The admin analytics map uses [Natural Earth's public-domain country boundaries](https://www.naturalearthdata.com/about/terms-of-use/). Optional geolocation uses separately downloaded [DB-IP Lite](https://db-ip.com/db/lite.php) data with attribution under CC BY 4.0. Full source notices are in NOTICE.
