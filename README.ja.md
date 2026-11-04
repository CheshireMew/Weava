<!-- readme-header:start -->

<p align="center">
  <img src="./assets/readme/logo.svg" width="64" alt="Weava">
</p>

<h1 align="center">Weava</h1>

<p align="center">
  <strong>執筆・公開・サイト管理をまとめて行える、セルフホスト型のコンテンツ中心の Web サイトフレームワーク。</strong>
</p>

<p align="center">
  <a href="./README.md">中文</a> · <a href="./README.en.md">English</a> · <strong>日本語</strong> | <a href="./docs/authoring.md">文档</a> | <a href="./CONTRIBUTING.md">贡献</a> | <a href="https://github.com/CheshireMew/Weava/issues">反馈</a>
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

Weava は、ブログ、企業サイト、ポートフォリオ、ドキュメントサイト、リソース一覧を構築・管理するためのフレームワークです。ブラウザーの管理画面で執筆、メディアのアップロード、プレビュー、公開を行い、CLI／API でコンテンツ構造のカスタマイズや操作の自動化ができます。記事とサイト設定は独立したサイトディレクトリに保存され、日常の更新でプログラムを再ビルドする必要はありません。

## できること

| やりたいこと | Weava の機能 |
| --- | --- |
| 執筆と公開 | ビジュアル／Markdown 編集、表とメディア、自動保存、履歴比較、競合からの復元、プレビュー、予約公開、公開バージョンの切り戻し |
| サイト管理 | サイト紹介、相互リンク、カテゴリーとタグ、ナビゲーション、外観、広告。コンテンツタイプ、独自フィールド、テンプレート、拡張機能は CLI／API で設定 |
| 読者との交流 | Newsletter テーマ、記事の目次、いいね、コメントと返信、サイト運営者の返信、コメント管理 |
| コンテンツの発見 | 中国語検索、検索・共有用の情報、RSS、サイトマップ、旧 URL からのリダイレクト |
| アクセス分析 | 推移、流入元、端末、地域、訪問履歴、リアルタイムの訪問者、期間比較、CSV 出力 |
| 移行と保守 | WordPress インポート、メディアとコメントの移行、ディレクトリ形式のバックアップと復元、履歴アーカイブ、独立したプログラムの更新 |

各サイトは単一の運営者アカウントで管理します。管理画面は日常の執筆とサイト管理に集中し、コンテンツ構造やテンプレートの変更には [CLI／API](docs/interfaces.md) を使用します。非公開コンテンツ、メディアのアクセス制御、任意の二要素認証も利用できます。詳しくは[執筆ガイド](docs/authoring.md)を参照してください。管理画面とリンク先のドキュメントは現在中国語です。

## サイトを作成する

現在の検証対象は **Windows** です。**Node.js 24.12–24.x** と **pnpm 12.4.2** が必要です。以下のコマンドでソースから依存関係をインストールし、サンプル入りのサイトを初期化して、プログラムをビルド・起動します。

```powershell
git clone https://github.com/CheshireMew/Weava.git
cd Weava
powershell -NoProfile -File .\scripts\setup.ps1
powershell -NoProfile -File .\scripts\run.ps1 --site E:\WeavaSites\my-site init --demo --port 4322
powershell -NoProfile -File .\scripts\run.ps1 build
powershell -NoProfile -File .\scripts\run.ps1 --site E:\WeavaSites\my-site start
```

`setup.ps1` はロック済みの依存関係をインストールし、専用の pnpm がない場合は指定バージョンを導入します。既定の Node パスは `D:\Tools\NodeJS\node.exe` で、ツール、ダウンロードキャッシュ、依存関係のストアも D ドライブを使用します。Node が別の場所にある場合は、先に `$env:WEAVA_NODE='node.exe のフルパス'` を設定してください。`E:\WeavaSites\my-site` は例なので、自分のデータ保存先に置き換えられます。

起動後はターミナルを開いたまま、最初の記事を公開します。

1. ターミナルに表示される一度限りの設定リンクを開き、運営者のユーザー名とパスワードを入力します。リンクの有効期限は 10 分です。
2. 新しいアカウントで[ローカル管理画面](http://127.0.0.1:4322/admin/)にログインし、記事を作成してタイトルと本文を入力します。
3. 「预览」で確認し、「发布」をクリックして変更内容を確認・承認します。
4. [サイトのトップページ](http://127.0.0.1:4322/)で公開された記事を確認します。

記事は下書きとして自動保存され、公開の確認後に閲覧者向けの内容が更新されます。サイト設定は自動保存後に反映されます。既定のサービスはローカル接続のみを受け付け、初期化や起動だけでインターネットに公開されることはありません。

設定リンクの期限が切れた場合は、同じサイトに対して再発行します。

```powershell
powershell -NoProfile -File .\scripts\run.ps1 --site E:\WeavaSites\my-site owner setup-link
```

パスワードの再設定、二要素認証の復旧、自動初期化については[運用・バックアップ・復旧](docs/operations.md)を参照してください。

## 既存サイトから移行する

WordPress の標準 WXR XML に対応しています。まず事前チェックを行い、変換レポートを確認してからコンテンツ、添付ファイル、コメントを取り込みます。管理画面の「备份与维护」でファイルを選ぶか、CLI で事前チェックを実行できます。

```powershell
powershell -NoProfile -File .\scripts\run.ps1 --site E:\WeavaSites\my-site migrate wxr --input E:\Exports\wordpress.xml --dry-run
```

事前チェックは報告のみで保存しません。未対応のプラグインブロック、動的ブロック、ショートコードは、公開前に編集画面で確認してください。旧 URL、オフラインのメディア、過去の閲覧数、WP Statistics データにはそれぞれ移行手順があります。[旧サイトの移行](docs/migration.md)と [WP Statistics の移行](docs/wordpress-statistics.md)を参照してください。

## 運用とデータ

フレームワークのソースとサイトデータは別々に保存します。リポジトリにはプログラム、ドキュメント、テストが入り、サイトディレクトリにはデータベース、記事、メディア、アカウント設定、アクセス統計、移行記録が入ります。サイトの保全にはインスタンス全体のバックアップを使用してください。手順は[運用ガイド](docs/operations.md)にあります。

初期化とビルドが完了したサイトは、以下のコマンドで再起動できます。`start.bat` のダブルクリックでは既定の `../WeavaSites/demo` が起動します。この既定サイトも事前に初期化が必要です。

```powershell
.\start.bat --site "E:\WeavaSites\my-site"
```

ウィンドウは開いたままにし、Ctrl+C で停止します。同じサイトにはサービスを一つだけ起動してください。ポートを変える場合は `--port 4323` を追加します。ソース、テーマ、拡張機能のコード変更には再ビルドが必要ですが、日常の編集と公開では既存のプログラムを使います。サーバー運用とリバースプロキシは運用ガイドを参照してください。現在のプラットフォーム検証範囲は Windows です。

## 開発

Astro が閲覧者向けページ、React が管理画面を提供し、TypeScript コアがコンテンツ、履歴、公開、検索、保守を担います。サイトデータは SQLite に保存します。通常の公開ページは React 管理画面や Lexical エディターを読み込みません。

依存関係のインストール後、リポジトリのルートで実行します。

```powershell
pnpm check
pnpm test
pnpm build
pnpm weava --site E:\WeavaSites\my-site dev
```

プログラムのビルドとコンテンツの公開は別の操作です。開発規約、変更に応じた検証、ブラウザーチェックの入口は[コントリビューションガイド](CONTRIBUTING.md)を参照してください。

## ドキュメント

| 内容 | 入口 |
| --- | --- |
| 執筆、メディア、公開 | [執筆ガイド](docs/authoring.md) |
| 運用、バックアップ、復旧、更新 | [運用](docs/operations.md) · [アカウントとサイト保護](docs/security.md) |
| サイトと統計の移行 | [移行](docs/migration.md) · [WP Statistics](docs/wordpress-statistics.md) |
| アクセス統計と地域データ | [アクセス分析](docs/analytics.md) |
| カスタマイズと自動化 | [API と CLI](docs/interfaces.md) · [API リファレンス](docs/api-reference.md) · [テーマと拡張機能](docs/extensions.md) |
| 設計と保守記録 | [アーキテクチャとデータ](docs/architecture.md) · [実装記録](docs/implementation.md) · [整備計画と検証記録](docs/completion-plan.md) |

## Star History

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/CheshireMew/Weava/star-history/star-history-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/CheshireMew/Weava/star-history/star-history.svg">
  <img alt="GitHub Star History" src="https://raw.githubusercontent.com/CheshireMew/Weava/star-history/star-history.svg">
</picture>

## ライセンスと第三者リソース

フレームワークは **AGPL-3.0-only** で提供します。[LICENSE](LICENSE) と [NOTICE](NOTICE) を参照してください。サイトの記事、元のメディア、アクセス統計、非公開設定は、このリポジトリのソフトウェア配布範囲に含まれません。

第三者の依存パッケージには各自のライセンスが適用されます。[依存関係の一覧](docs/dependencies.json)を参照してください。管理画面の統計地図は [Natural Earth のパブリックドメイン国境データ](https://www.naturalearthdata.com/about/terms-of-use/)に基づきます。任意の地域判定では、別途ダウンロードする [DB-IP Lite](https://db-ip.com/db/lite.php) のデータを CC BY 4.0 の帰属表示付きで使用します。出典の詳細は NOTICE にあります。
