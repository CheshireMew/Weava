import type Database from 'better-sqlite3';
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import sharp from 'sharp';
import { WeavaError } from '@weava/contracts';

export interface ArticleComment {
  id: string;
  entryId: string;
  author: string;
  body: string;
  createdAt: string;
  status?: 'visible' | 'hidden';
}
export class Engagement {
  private clock: () => number;
  private code: () => string;
  constructor(private db: Database.Database, private secret: string, options: { clock?: () => number; code?: () => string } = {}) {
    this.clock = options.clock ?? Date.now;
    const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    this.code = options.code ?? (() => Array.from({ length: 5 }, () => alphabet[randomInt(alphabet.length)]).join(''));
  }
  private hash(value: string) { return createHmac('sha256', this.secret).update(value).digest('hex'); }
  private reader(token: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) throw new WeavaError('请刷新页面后重试。');
    return this.hash('reader:' + token);
  }
  private rate(scope: string, key: string, maximum: number, windowMs: number) {
    const time = this.clock(), bucket = Math.floor(time / windowMs), id = scope + ':' + key + ':' + bucket;
    const row = this.db.prepare(`INSERT INTO engagement_limits VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1 RETURNING count`).get(id, (bucket + 1) * windowMs) as { count: number };
    if (row.count > maximum) throw new WeavaError('操作太频繁，请稍后再试。', 429);
  }
  counts(entryId: string) {
    const likes = (this.db.prepare('SELECT COUNT(*) count FROM article_likes WHERE entry_id=?').get(entryId) as any).count;
    const comments = (this.db.prepare("SELECT COUNT(*) count FROM article_comments WHERE entry_id=? AND status='visible'").get(entryId) as any).count;
    return { likes, comments };
  }
  summary(entryId: string, token?: string, page = 1, sort: 'latest' | 'oldest' = 'latest') {
    const counts = this.counts(entryId);
    const liked = token ? !!this.db.prepare('SELECT 1 FROM article_likes WHERE entry_id=? AND reader_key=?').get(entryId, this.reader(token)) : false;
    const offset = (Math.max(1, Math.min(10000, Math.floor(page) || 1)) - 1) * 20;
    const rows = this.db.prepare(`SELECT id,entry_id entryId,author,body,created_at createdAt FROM article_comments WHERE entry_id=? AND status='visible' ORDER BY created_at ${sort === 'oldest' ? 'ASC' : 'DESC'},rowid ${sort === 'oldest' ? 'ASC' : 'DESC'} LIMIT 20 OFFSET ?`).all(entryId, offset) as ArticleComment[];
    return { ...counts, liked, items: rows, hasMore: offset + rows.length < counts.comments };
  }
  setLike(entryId: string, token: string, liked: boolean, network = 'unknown') {
    const reader = this.reader(token);
    this.rate('likes', this.hash('network:' + network), 120, 60000);
    if (liked) this.db.prepare('INSERT OR IGNORE INTO article_likes VALUES(?,?,?)').run(entryId, reader, new Date(this.clock()).toISOString());
    else this.db.prepare('DELETE FROM article_likes WHERE entry_id=? AND reader_key=?').run(entryId, reader);
    return { ...this.counts(entryId), liked };
  }
  async createCaptcha(token: string, network: string) {
    const reader = this.reader(token), time = this.clock();
    this.db.prepare('DELETE FROM comment_captchas WHERE expires_at<?').run(time);
    this.db.prepare('DELETE FROM engagement_limits WHERE reset_at<?').run(time);
    this.rate('captcha-reader', reader, 10, 60000);
    this.rate('captcha-network', this.hash('network:' + network), 40, 60000);
    const word = this.code();
    if (!/^[A-Z2-9]{5}$/.test(word)) throw new Error('Invalid captcha generator');
    const glyphs = [...word].map((letter, index) => `<text x="${25 + index * 29}" y="${40 + randomInt(-3, 4)}" transform="rotate(${randomInt(-13, 14)} ${25 + index * 29} 30)" font-family="sans-serif" font-size="29" font-weight="700" fill="#4a514c">${letter}</text>`).join('');
    const noise = Array.from({ length: 5 }, () => `<path d="M${randomInt(180)} ${randomInt(58)} Q${randomInt(180)} ${randomInt(58)} ${randomInt(180)} ${randomInt(58)}" stroke="#bcc8c0" stroke-width="1" fill="none"/>`).join('');
    const png = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="180" height="58"><rect width="180" height="58" rx="5" fill="#f2f4f1"/>${noise}${glyphs}</svg>`)).png().toBuffer();
    const id = randomBytes(24).toString('hex'), expiresAt = time + 5 * 60000;
    this.db.prepare('INSERT INTO comment_captchas VALUES(?,?,?,?,0)').run(id, reader, this.hash('captcha:' + id + ':' + word), expiresAt);
    return { id, image: 'data:image/png;base64,' + png.toString('base64'), expiresAt };
  }
  postComment(entryId: string, token: string, network: string, value: { author: string; body: string; captchaId: string; captcha: string; clientId: string }) {
    const reader = this.reader(token), networkKey = this.hash('network:' + network), time = this.clock();
    const author = String(value.author ?? '').trim(), body = String(value.body ?? '').trim();
    if (!author || author.length > 40 || !body || body.length > 4000) throw new WeavaError('请填写称呼（40 字以内）和评论（4000 字以内）。');
    if (!/^[a-zA-Z0-9-]{10,100}$/.test(value.clientId ?? '')) throw new WeavaError('评论请求标识无效，请刷新后重试。');
    const existing = this.db.prepare('SELECT id,entry_id entryId,author,body,status,created_at createdAt FROM article_comments WHERE entry_id=? AND reader_key=? AND client_id=?').get(entryId, reader, value.clientId) as ArticleComment | undefined;
    if (existing) {
      if (existing.author !== author || existing.body !== body) throw new WeavaError('评论请求内容已改变，请重新提交。', 409);
      return existing;
    }
    // Claim once outside the posting transaction: wrong answers and failed posts cannot reuse a challenge.
    const challenge = this.db.prepare('UPDATE comment_captchas SET used=1 WHERE id=? AND reader_key=? AND used=0 RETURNING answer_hash,expires_at').get(String(value.captchaId ?? ''), reader) as { answer_hash: string; expires_at: number } | undefined;
    const answer = this.hash('captcha:' + String(value.captchaId ?? '') + ':' + String(value.captcha ?? '').replace(/\s/g, '').toUpperCase());
    if (!challenge || challenge.expires_at < time || !timingSafeEqual(Buffer.from(answer), Buffer.from(challenge.answer_hash)))
      throw new WeavaError('验证码错误或已过期，请换一张后重试。');
    return this.db.transaction(() => {
      const cutoff = new Date(time - 3600000).toISOString();
      const recent = this.db.prepare('SELECT COUNT(*) count,MAX(created_at) latest FROM article_comments WHERE reader_key=? AND created_at>?').get(reader, cutoff) as { count: number; latest: string | null };
      const networkCount = (this.db.prepare('SELECT COUNT(*) count FROM article_comments WHERE network_key=? AND created_at>?').get(networkKey, cutoff) as any).count;
      if (recent.count >= 10 || networkCount >= 30 || (recent.latest && time - Date.parse(recent.latest) < 15000))
        throw new WeavaError('评论提交太频繁，请稍后再试。', 429);
      const comment: ArticleComment = { id: randomBytes(16).toString('hex'), entryId, author, body, createdAt: new Date(time).toISOString(), status: 'visible' };
      this.db.prepare('INSERT INTO article_comments VALUES(?,?,?,?,?,?,?,?,?)').run(comment.id, entryId, reader, networkKey, value.clientId, author, body, 'visible', comment.createdAt);
      return comment;
    }).immediate();
  }
  comments(status: string = 'all', page = 1) {
    const parameters = status === 'visible' || status === 'hidden' ? [status] : [];
    const where = parameters.length ? 'WHERE status=?' : '';
    const offset = (Math.max(1, Math.floor(page) || 1) - 1) * 30;
    const total = (this.db.prepare(`SELECT COUNT(*) count FROM article_comments ${where}`).get(...parameters) as any).count as number;
    const items = this.db.prepare(`SELECT id,entry_id entryId,author,body,status,created_at createdAt FROM article_comments ${where} ORDER BY created_at DESC,rowid DESC LIMIT 30 OFFSET ?`).all(...parameters, offset) as ArticleComment[];
    return { items, total, hasMore: offset + items.length < total };
  }
  moderate(id: string, status: string) {
    if (!['visible', 'hidden'].includes(status)) throw new WeavaError('评论状态无效。');
    if (!this.db.prepare('UPDATE article_comments SET status=? WHERE id=?').run(status, id).changes) throw new WeavaError('评论不存在。', 404);
    return { id, status };
  }
}
