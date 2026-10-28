import { afterEach, describe, expect, it } from 'vitest';
import { Storage, Engagement, articleOutline, SCHEMA_VERSION } from '@weava/core';
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const base = 'D:/Tools/cache/weava/tests/engagement-' + Date.now();
const stores: Storage[] = [];
const reader = 'a'.repeat(64), other = 'b'.repeat(64);
let sequence = 0;
function fixture() {
  const store = new Storage(join(base, String(sequence++))); stores.push(store);
  let time = Date.parse('2026-10-28T12:00:00Z');
  const engagement = new Engagement(store.raw, 'test-secret', { clock: () => time, code: () => 'A2BCD' });
  const value = (challenge: { id: string }, extra = {}) => ({ author: '读者', body: '一条评论', captchaId: challenge.id, captcha: 'a2 bcd', clientId: 'test-comment-' + sequence++ , ...extra });
  return { store, engagement, value, advance: (milliseconds: number) => { time += milliseconds; } };
}
afterEach(() => { for (const store of stores.splice(0)) store.close(); });

describe('article interactions', () => {
  it('migrates a version-one site without changing existing records', () => {
    const root = join(base, 'migration'); mkdirSync(root, { recursive: true });
    const db = new Database(join(root, 'weava.sqlite'));
    db.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL); INSERT INTO schema_migrations VALUES(1,'before'); CREATE TABLE records(scope TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,data TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(scope,id)); INSERT INTO records VALUES('example','kept',1,'{\"text\":\"原内容\"}','before');"); db.close();
    const store = new Storage(root); stores.push(store);
    expect(store.get('example', 'kept')!.value).toEqual({ text: '原内容' });
    expect(store.raw.prepare('SELECT MAX(version) version FROM schema_migrations').get()).toEqual({ version: SCHEMA_VERSION });
    expect(new Engagement(store.raw, 'secret').counts('article')).toEqual({ likes: 0, comments: 0 });
  });
  it('sets and cancels likes idempotently for each visitor', () => {
    const { engagement } = fixture();
    expect(engagement.setLike('article', reader, true).likes).toBe(1);
    expect(engagement.setLike('article', reader, true).likes).toBe(1);
    expect(engagement.summary('article', reader).liked).toBe(true);
    expect(engagement.summary('article', other).liked).toBe(false);
    expect(engagement.setLike('article', other, true).likes).toBe(2);
    expect(engagement.setLike('article', reader, false).likes).toBe(1);
    expect(engagement.setLike('article', reader, false).likes).toBe(1);
    expect(engagement.counts('other')).toEqual({ likes: 0, comments: 0 });
  });
  it('requires a raster captcha, bound to the reader, and consumes it only once', async () => {
    const { engagement, value } = fixture();
    expect(() => engagement.postComment('article', reader, 'ip', value({ id: '' }))).toThrow(/验证码/);
    const challenge = await engagement.createCaptcha(reader, 'ip');
    expect(Object.keys(challenge).sort()).toEqual(['expiresAt', 'id', 'image']);
    expect(Buffer.from(challenge.image.split(',')[1], 'base64').subarray(1, 4).toString()).toBe('PNG');
    expect(() => engagement.postComment('article', other, 'ip', value(challenge))).toThrow(/验证码/);
    const comment = engagement.postComment('article', reader, 'ip', value(challenge, { body: '<script>test</script>\n正文' }));
    expect(comment.body).toBe('<script>test</script>\n正文');
    expect(engagement.summary('article').items[0].body).toBe(comment.body);
    expect(() => engagement.postComment('article', reader, 'ip', value(challenge))).toThrow(/验证码/);
    expect(engagement.counts('article').comments).toBe(1);
  });
  it('rejects wrong answers and expired challenges, and cannot reuse a wrong answer', async () => {
    const { engagement, value, advance } = fixture();
    const wrong = await engagement.createCaptcha(reader, 'ip');
    expect(() => engagement.postComment('article', reader, 'ip', value(wrong, { captcha: 'WRONG' }))).toThrow(/验证码/);
    expect(() => engagement.postComment('article', reader, 'ip', value(wrong))).toThrow(/验证码/);
    const expired = await engagement.createCaptcha(reader, 'ip'); advance(300001);
    expect(() => engagement.postComment('article', reader, 'ip', value(expired))).toThrow(/验证码/);
    expect(engagement.counts('article').comments).toBe(0);
  });
  it('does not duplicate a successful request retried after a network failure', async () => {
    const { engagement, value } = fixture();
    const payload = value(await engagement.createCaptcha(reader, 'ip'));
    const first = engagement.postComment('article', reader, 'ip', payload);
    expect(engagement.postComment('article', reader, 'ip', payload).id).toBe(first.id);
    expect(() => engagement.postComment('article', reader, 'ip', { ...payload, body: 'changed' })).toThrow(/内容已改变/);
    expect(engagement.counts('article').comments).toBe(1);
  });
  it('limits comment frequency and captcha issuance', async () => {
    const { engagement, value, advance } = fixture();
    engagement.postComment('article', reader, 'ip', value(await engagement.createCaptcha(reader, 'ip')));
    expect(() => engagement.postComment('article', reader, 'ip', value({ id: '' }))).toThrow(/验证码/);
    const challenge = await engagement.createCaptcha(reader, 'ip');
    expect(() => engagement.postComment('article', reader, 'ip', value(challenge))).toThrow(/太频繁/);
    advance(15000);
    engagement.postComment('article', reader, 'ip', value(await engagement.createCaptcha(reader, 'ip')));
    for (let index = 0; index < 7; index++) await engagement.createCaptcha(reader, 'ip');
    await expect(engagement.createCaptcha(reader, 'ip')).rejects.toMatchObject({ status: 429 });
    advance(60000); expect((await engagement.createCaptcha(reader, 'ip')).id).toBeTruthy();
  });
  it('caps comments per reader and network even when readers change', async () => {
    const { engagement, value, advance } = fixture();
    for (let index = 0; index < 10; index++) {
      engagement.postComment('article', reader, 'ip', value(await engagement.createCaptcha(reader, 'ip'))); advance(61000);
    }
    expect(() => engagement.postComment('article', reader, 'ip', value({ id: '' }))).toThrow(/验证码/);
    const capped = await engagement.createCaptcha(reader, 'ip');
    expect(() => engagement.postComment('article', reader, 'ip', value(capped))).toThrow(/太频繁/);
    for (let index = 1; index <= 20; index++) {
      const token = index.toString(16).padStart(64, '0');
      engagement.postComment('article', token, 'ip', value(await engagement.createCaptcha(token, 'ip'))); advance(16000);
    }
    expect(() => engagement.postComment('article', other, 'ip', value({ id: '' }))).toThrow(/验证码/);
    const network = await engagement.createCaptcha(other, 'ip');
    expect(() => engagement.postComment('article', other, 'ip', value(network))).toThrow(/太频繁/);
  });
  it('paginates comments and excludes hidden comments from public counts', async () => {
    const { engagement, value, advance } = fixture();
    for (let index = 1; index <= 31; index++) {
      const token = index.toString(16).padStart(64, '0');
      engagement.postComment('article', token, 'ip', value(await engagement.createCaptcha(token, 'ip'), { body: String(index) })); advance(130000);
    }
    expect(engagement.summary('article').items).toHaveLength(20);
    expect(engagement.summary('article').items[0].body).toBe('31');
    expect(engagement.summary('article', undefined, 2).items).toHaveLength(11);
    expect(engagement.summary('article', undefined, 1, 'oldest').items[0].body).toBe('1');
    const id = engagement.summary('article').items[0].id;
    engagement.moderate(id, 'hidden');
    expect(engagement.summary('article').comments).toBe(30);
    expect(engagement.summary('article').items.some((item) => item.id === id)).toBe(false);
    expect(engagement.comments('hidden').items[0].id).toBe(id);
    expect(engagement.comments('all', 1)).toMatchObject({ total: 31, hasMore: true });
    expect(engagement.comments('all', 2).items).toHaveLength(1);
    engagement.moderate(id, 'visible'); expect(engagement.counts('article').comments).toBe(31);
    expect(() => engagement.moderate('absent', 'hidden')).toThrow(/不存在/);
  });
});

describe('article outline', () => {
  it('keeps original content and stable heading links without duplicate anchors', () => {
    const input = '<p id="kept">原文</p><h2 id="kept">已有标题</h2><h3>子标题</h3><h3>子标题</h3><h4>第四级</h4><h2> </h2><img src="/inside.png" alt="图">';
    const outline = articleOutline(input);
    expect(outline.items.map((item) => item.level)).toEqual([2, 3, 3, 4]);
    expect(new Set(outline.items.map((item) => item.id)).size).toBe(4);
    expect(outline.items[0].id).toBe('kept-2');
    expect(articleOutline(outline.html)).toEqual(outline);
    expect(outline.html).toContain('<p id="kept">原文</p>');
    expect(outline.html).toContain('<img src="/inside.png" alt="图">');
    for (const item of outline.items) expect(outline.html).toContain(`id="${item.id}"`);
    expect(articleOutline('<p>没有标题</p>').items).toEqual([]);
  });
});
