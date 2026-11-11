/** Only framework-owned labels are translated; authored content is never rewritten. */
const labels:Record<string,[string,string,string?]>={
  '关于作者':['About the author','著者について','關於作者'],
  '第 {page} 页':['Page {page}','{page} ページ','第 {page} 頁'],
  '私密':['Private','非公開','私密'],'正文目录':['Contents','本文の目次','正文目錄'],
  '资料分页':['Resource pages','資料のページ','資料分頁'],'没有找到相关资料，请调整筛选条件。':['No matching resources. Adjust the filters.','資料が見つかりません。絞り込み条件を変更してください。','沒有找到相關資料，請調整篩選條件。'],
  '菜单':['Menu','メニュー','選單'],'这个地址还没有公开内容。':['There is no public content at this address.','このアドレスには公開された内容がありません。','這個網址還沒有公開內容。'],'⌕ 搜索':['⌕ Search','⌕ 検索','⌕ 搜尋'],'随笔分页':['Timeline pages','タイムラインのページ','隨筆分頁'],'还没有发布随笔。':['No notes published yet.','まだノートは公開されていません。','還沒有發表隨筆。'],'面包屑':['Breadcrumbs','パンくずリスト','麵包屑'],'文档翻页':['Documentation pages','ドキュメントのページ','文件分頁'],
  '搜索':['Search','検索','搜尋'],'搜索文章':['Search articles','記事を検索','搜尋文章'],'搜索资料':['Search resources','資料を検索','搜尋資料'],'搜索文章、作品或资源':['Search articles, projects or resources','記事、作品、資料を検索','搜尋文章、作品或資源'],
  '搜索全部文章':['Search all articles','すべての記事を検索','搜尋全部文章'],'关闭搜索':['Close search','検索を閉じる','關閉搜尋'],'没有找到匹配的内容，请换个关键词。':['No matching content. Try another search.','一致する内容がありません。別のキーワードをお試しください。','沒有找到符合的內容，請換個關鍵詞。'],
  '共 {count} 项结果':['{count} results','{count} 件の結果','共 {count} 項結果'],'上一页':['Previous','前へ','上一頁'],'下一页':['Next','次へ','下一頁'],'搜索分页':['Search pages','検索結果のページ','搜尋分頁'],'列表分页':['List pages','一覧のページ','列表分頁'],
  '跳到正文':['Skip to content','本文へ移動','跳到正文'],'首页':['Home','ホーム','首頁'],'返回首页':['Back to home','ホームに戻る','返回首頁'],'主导航':['Main navigation','メインナビゲーション','主導覽'],'打开导航菜单':['Open navigation','メニューを開く','開啟導覽選單'],
  '页脚':['Footer','フッター','頁尾'],'归档':['Archive','アーカイブ','封存'],'站点地图':['Sitemap','サイトマップ','網站地圖'],'页面未找到':['Page not found','ページが見つかりません','找不到頁面'],'后台':['Dashboard','管理画面','管理後台'],'编辑':['Edit','編集','編輯'],
  '文章':['Articles','記事','文章'],'文章排序':['Article order','記事の並び順','文章排序'],'推荐文章排序':['Recommendation order','おすすめの並び順','推薦文章排序'],'头条文章':['Featured article','注目の記事','頭條文章'],'热门文章':['Popular articles','人気の記事','熱門文章'],
  '查看全部':['View all','すべて見る','查看全部'],'查看全部文章':['View all articles','すべての記事を見る','查看全部文章'],'次阅读':['views','回閲覧','次閱讀'],'{count} 次阅读':['{count} views','{count} 回閲覧','{count} 次閱讀'],'最新':['Latest','新しい順','最新'],'热门':['Popular','人気順','熱門'],'最早':['Oldest','古い順','最早'],'相关':['Related','関連','相關'],
  '订阅 RSS':['Subscribe via RSS','RSS を購読','訂閱 RSS'],'分类':['Categories','カテゴリー','分類'],'展开文章目录':['Open article contents','記事の目次を開く','展開文章目錄'],'收起文章目录':['Close article contents','記事の目次を閉じる','收合文章目錄'],'目录':['Contents','目次','目錄'],'文章目录':['Article contents','記事の目次','文章目錄'],
  '本页目录':['On this page','このページの目次','本頁目錄'],'继续学习':['Continue reading','続きを読む','繼續學習'],'相关内容':['Related content','関連する内容','相關內容'],'文档导航':['Documentation navigation','ドキュメントのナビゲーション','文件導覽'],'文档路径':['Breadcrumbs','パンくずリスト','文件路徑'],'上一篇':['Previous article','前の記事','上一篇'],'下一篇':['Next article','次の記事','下一篇'],
  '评论':['Comments','コメント','評論'],'留言':['Messages','メッセージ','留言'],'评论排序':['Comment order','コメントの並び順','評論排序'],'留言排序':['Message order','メッセージの並び順','留言排序'],'我':['Me','自分','我'],'取消回复':['Cancel reply','返信を取り消す','取消回覆'],
  '评论内容':['Comment','コメントの内容','評論內容'],'留言内容':['Message','メッセージの内容','留言內容'],'写下你的评论…':['Write a comment…','コメントを書く…','寫下你的評論…'],'写下你的留言…':['Write a message…','メッセージを書く…','寫下你的留言…'],
  '称呼':['Name','名前','稱呼'],'你的称呼':['Your name','お名前','你的稱呼'],'更换验证码':['Refresh verification image','認証画像を更新','更換驗證碼'],'评论验证码':['Verification image','認証画像','評論驗證碼'],'换一张':['Refresh','更新','換一張'],'验证码':['Verification code','認証コード','驗證碼'],
  '发布评论':['Post comment','コメントを投稿','發表評論'],'发布留言':['Post message','メッセージを投稿','發表留言'],'发布回复':['Post reply','返信を投稿','發表回覆'],'发布中…':['Posting…','投稿中…','發表中…'],
  '启用 JavaScript 后可加载验证码并发表评论。':['Enable JavaScript to load the verification image and post a comment.','認証画像の読み込みと投稿には JavaScript を有効にしてください。','啟用 JavaScript 後可載入驗證碼並發表評論。'],
  '这篇内容已关闭新评论。':['New comments are closed.','新しいコメントの受付は終了しました。','這篇內容已關閉新評論。'],'这篇内容已关闭新留言。':['New messages are closed.','新しいメッセージの受付は終了しました。','這篇內容已關閉新留言。'],
  '站主':['Owner','サイト管理者','站主'],'回复':['Reply','返信','回覆'],'回复 {name}':['Reply to {name}','{name} さんに返信','回覆 {name}'],'点赞 {name} 的评论':['Like {name}’s comment','{name} さんのコメントにいいね','讚好 {name} 的評論'],
  '已赞':['Liked','いいね済み','已讚'],'点赞':['Like','いいね','讚好'],'暂无评论':['No comments yet','まだコメントはありません','暫無評論'],'暂无留言':['No messages yet','まだメッセージはありません','暫無留言'],'更多评论':['More comments','コメントをもっと見る','更多評論'],'更多留言':['More messages','メッセージをもっと見る','更多留言'],
  '评论已提交，等待审核':['Comment submitted for review','コメントを送信しました。承認をお待ちください','評論已提交，等待審核'],'留言已提交，等待审核':['Message submitted for review','メッセージを送信しました。承認をお待ちください','留言已提交，等待審核'],'评论已发布':['Comment posted','コメントを投稿しました','評論已發表'],'留言已发布':['Message posted','メッセージを投稿しました','留言已發表'],
  '查看评论':['View comments','コメントを見る','查看評論'],'复制文章链接':['Copy article link','記事のリンクをコピー','複製文章連結'],'分享':['Share','共有','分享'],'更多文章操作':['More article actions','記事のその他の操作','更多文章操作'],'打印文章':['Print article','記事を印刷','列印文章'],
  '链接已复制':['Link copied','リンクをコピーしました','連結已複製'],'复制失败，请从地址栏复制链接。':['Could not copy. Copy the link from the address bar.','コピーできません。アドレスバーからリンクをコピーしてください。','複製失敗，請從網址列複製連結。'],'操作失败，请稍后重试。':['Operation failed. Please try again.','操作に失敗しました。もう一度お試しください。','操作失敗，請稍後重試。'],
  '复制代码':['Copy code','コードをコピー','複製程式碼'],'复制':['Copy','コピー','複製'],'已复制':['Copied','コピーしました','已複製'],'无法复制，请选中代码复制':['Could not copy. Select and copy the code.','コピーできません。コードを選択してコピーしてください。','無法複製，請選取程式碼複製'],
  '放大图片':['Enlarge image','画像を拡大','放大圖片'],'放大图片：{name}':['Enlarge image: {name}','画像を拡大：{name}','放大圖片：{name}'],'图片预览':['Image preview','画像プレビュー','圖片預覽'],'查看大图':['View full image','大きな画像を見る','查看大圖'],'关闭':['Close','閉じる','關閉'],
  '随笔时间流':['Notes timeline','ノートのタイムライン','隨筆時間流'],'展开笔记':['Expand note','ノートを開く','展開筆記'],'收起笔记':['Collapse note','ノートを閉じる','收合筆記'],'还没有公开的内容。':['No public content yet.','まだ公開されている内容はありません。','還沒有公開的內容。'],
  '网站信息':['Site information','サイト情報','網站資訊'],'关于本站':['About','このサイトについて','關於本站'],'友情链接':['Friends','リンク集','友情連結'],'暂时还没有友情链接。':['No links yet.','まだリンクはありません。','暫時還沒有友情連結。'],'关于':['About','サイトについて','關於'],'源代码':['Source code','ソースコード','原始碼'],
  '是':['Yes','はい','是'],'否':['No','いいえ','否'],'了解更多':['Learn more','詳しく見る','瞭解更多'],'下载附件':['Download attachment','添付ファイルをダウンロード','下載附件'],'全部':['All','すべて','全部'],'筛选':['Filter','絞り込み','篩選'],'筛选当前资料':['Filter resources','資料を絞り込む','篩選目前資料'],'排序':['Sort','並び替え','排序'],'标题':['Title','タイトル','標題'],
  '探索主题':['Explore topics','テーマを探す','探索主題'],'{count} 篇资料':['{count} resources','{count} 件の資料','{count} 篇資料'],'没有符合条件的资料。':['No matching resources.','条件に一致する資料がありません。','沒有符合條件的資料。'],'阅读：{name}':['Read: {name}','読む：{name}','閱讀：{name}'],'{count} 分钟阅读':['{count} min read','約 {count} 分','{count} 分鐘閱讀'],
  '验证码错误或已过期，请换一张后重试。':['Verification code is incorrect or expired. Refresh it and try again.','認証コードが正しくないか有効期限が切れています。画像を更新してください。','驗證碼錯誤或已過期，請換一張後重試。'],
  '操作太频繁，请稍后再试。':['Too many requests. Please try again later.','操作が多すぎます。しばらくしてからお試しください。','操作太頻繁，請稍後再試。'],'评论提交太频繁，请稍后再试。':['Too many comments. Please try again later.','投稿が多すぎます。しばらくしてからお試しください。','評論提交太頻繁，請稍後再試。'],
  '请填写称呼（40 字以内）和评论（4000 字以内）。':['Enter a name (up to 40 characters) and comment (up to 4,000 characters).','名前（40 文字以内）とコメント（4,000 文字以内）を入力してください。','請填寫稱呼（40 字以內）和評論（4000 字以內）。'],
};
const dictionaries=new Map<string,Record<string,string>>();
export function siteDictionary(language:string):Record<string,string>{
  const locale=language.toLowerCase(),cached=dictionaries.get(locale);if(cached)return cached;
  if(locale==='zh'||locale==='zh-cn'||locale==='zh-hans'){const empty={};dictionaries.set(locale,empty);return empty;}
  const index=locale.startsWith('ja')?1:/^zh-(tw|hk|hant)/.test(locale)?2:0;
  const result=Object.fromEntries(Object.entries(labels).map(([key,value])=>[key,value[index]??key]));if(dictionaries.size>=16)dictionaries.delete(dictionaries.keys().next().value!);dictionaries.set(locale,result);return result;
}
export function siteText(language:string,text:string,values:Record<string,string|number>={}){
  const dictionary=siteDictionary(language);return (dictionary[text]??text).replace(/\{(\w+)\}/g,(match,key)=>values[key]===undefined?match:String(values[key]));
}
export const textFor=(language:string)=>(text:string,values?:Record<string,string|number>)=>siteText(language,text,values);
