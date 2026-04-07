import express from 'express';
import pg from 'pg';
import dotenv from 'dotenv';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const { Pool } = pg;

// 헬스체크 엔드포인트 (DB 연결 불필요)
app.get('/health', (req, res) => res.json({ status: 'ok' }));

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL 환경변수가 설정되지 않았습니다.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// AES-256-GCM 암호화 키 (32바이트). .env의 ENCRYPT_KEY 우선, 없으면 고정값 사용
const ENCRYPT_KEY = Buffer.from(
  (process.env.ENCRYPT_KEY || 'boramae_info_board_secret_key_32').padEnd(32, '0').slice(0, 32),
  'utf8'
);

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPT_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return iv.toString('hex') + ':' + tag.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(data) {
  try {
    const [ivHex, tagHex, encHex] = data.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const enc = Buffer.from(encHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPT_KEY, iv);
    decipher.setAuthTag(tag);
    return decipher.update(enc) + decipher.final('utf8');
  } catch { return '[복호화 실패]'; }
}

// IP 마스킹: 마지막 옥텟 숨김 (IPv4: 1.2.3.xxx / IPv6: 앞 4그룹만)
function maskIp(ip) {
  if (!ip) return null;
  const v4 = ip.match(/^(\d+\.\d+\.\d+)\.\d+$/);
  if (v4) return v4[1] + '.xxx';
  const v6 = ip.split(':');
  if (v6.length >= 4) return v6.slice(0, 4).join(':') + ':xxxx';
  return ip.slice(0, Math.floor(ip.length / 2)) + '***';
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || null;
}

// replies 테이블 자동 생성
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS replies (
      id        SERIAL PRIMARY KEY,
      post_id   INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      content   TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

// 1. 게시물 전체 목록 조회 (replies 포함)
app.get('/api/posts', async (req, res) => {
  const isAdmin = req.query.admin === '1';
  try {
    const postsResult = await pool.query(`
      SELECT * FROM posts
      ORDER BY
        CASE WHEN category = '공지' THEN 0 ELSE 1 END,
        sort_order ASC
    `);

    const repliesResult = await pool.query(
      'SELECT id, post_id, content, created_at FROM replies ORDER BY created_at ASC'
    );
    const repliesByPost = {};
    for (const r of repliesResult.rows) {
      if (!repliesByPost[r.post_id]) repliesByPost[r.post_id] = [];
      repliesByPost[r.post_id].push(r);
    }

    const rows = postsResult.rows.map(post => {
      const postWithReplies = { ...post, replies: repliesByPost[post.id] || [] };
      if (post.is_public_post) {
        return {
          ...postWithReplies,
          content: isAdmin ? decrypt(post.content) : '비밀글입니다.',
          password: undefined,
          ip_address: isAdmin ? post.ip_address : undefined,
          masked_ip: isAdmin ? maskIp(post.ip_address) : undefined,
        };
      }
      return postWithReplies;
    });
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '데이터베이스 조회 중 오류 발생' });
  }
});

// 2. 게시물 작성 (관리자 일반 글)
app.post('/api/posts', async (req, res) => {
  const { title, content, category, author, date, time, images } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO posts (title, content, category, author, date, time, images, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM posts))
       RETURNING *`,
      [title, content, category, author || '관리자', date, time, images || []]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '게시물 작성 중 오류 발생' });
  }
});

// 2-1. 문의사항탭 공개 글쓰기 (비밀번호 필수, IP 수집, 내용 암호화)
app.post('/api/posts/public', async (req, res) => {
  const { title, content, password, author } = req.body;
  if (!title?.trim() || !content?.trim() || !password?.trim()) {
    return res.status(400).json({ error: '제목, 내용, 비밀번호는 필수입니다.' });
  }
  const ip = getClientIp(req);
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const time = now.toTimeString().slice(0, 5);

  try {
    const hashedPw = await bcrypt.hash(password, 10);
    const encryptedContent = encrypt(content);
    const displayAuthor = author?.trim() || '익명';

    const result = await pool.query(
      `INSERT INTO posts (title, content, category, author, date, time, images, password, ip_address, is_public_post, sort_order)
       VALUES ($1, $2, '문의사항', $3, $4, $5, '{}', $6, $7, TRUE, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM posts))
       RETURNING id, title, category, author, date, time, is_public_post`,
      [title.trim(), encryptedContent, displayAuthor, date, time, hashedPw, ip]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '게시물 작성 중 오류 발생' });
  }
});

// 3. 게시물 순서 변경 (위/아래 이동)
app.patch('/api/posts/:id/move', async (req, res) => {
  const { id } = req.params;
  const { direction } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT id, sort_order FROM posts ORDER BY sort_order ASC');
    const idx = rows.findIndex(r => String(r.id) === String(id));
    if (idx === -1) { await client.query('ROLLBACK'); return res.status(404).json({ error: '게시물 없음' }); }
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= rows.length) { await client.query('ROLLBACK'); return res.json({ ok: true }); }
    const a = rows[idx], b = rows[swapIdx];
    await client.query('UPDATE posts SET sort_order = $1 WHERE id = $2', [b.sort_order, a.id]);
    await client.query('UPDATE posts SET sort_order = $1 WHERE id = $2', [a.sort_order, b.id]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: '순서 변경 중 오류' });
  } finally {
    client.release();
  }
});

// 4. 게시물 삭제
app.delete('/api/posts/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM posts WHERE id = $1', [id]);
    res.json({ message: '게시물 삭제 완료' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '게시물 삭제 중 오류 발생' });
  }
});

// 5. 게시물 수정
app.put('/api/posts/:id', async (req, res) => {
  const { id } = req.params;
  const { title, content, category, images } = req.body;
  try {
    const result = await pool.query(
      'UPDATE posts SET title = $1, content = $2, category = $3, images = $4 WHERE id = $5 RETURNING *',
      [title, content, category, images, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '게시물 수정 중 오류 발생' });
  }
});

// 6. 답글 작성 (관리자 전용)
app.post('/api/posts/:id/replies', async (req, res) => {
  const { id } = req.params;
  const { content } = req.body;
  if (!content?.trim()) {
    return res.status(400).json({ error: '내용을 입력해주세요.' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO replies (post_id, content) VALUES ($1, $2) RETURNING *',
      [id, content.trim()]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '답글 작성 중 오류 발생' });
  }
});

// 7. 답글 삭제 (관리자 전용)
app.delete('/api/replies/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM replies WHERE id = $1', [id]);
    res.json({ message: '답글 삭제 완료' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '답글 삭제 중 오류 발생' });
  }
});

// --- 배포용 정적 파일 서비스 추가 ---
const distPath = path.join(__dirname, '../dist');
app.use(express.static(distPath));

// API 경로 외의 모든 요청은 index.html로 보냄 (SPA 지원)
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(port, async () => {
  console.log(`서버가 포트 ${port} 에서 실행 중입니다.`);
  try {
    await initDb();
    console.log('DB 초기화 완료');
  } catch (err) {
    console.error('DB 초기화 실패:', err);
  }

  // Render 무료 플랜 cold start 방지: 14분마다 self-ping
  const APP_URL = process.env.APP_URL;
  if (APP_URL) {
    setInterval(() => {
      fetch(`${APP_URL}/health`)
        .then(() => console.log('keep-alive ping 성공'))
        .catch(err => console.error('keep-alive ping 실패:', err));
    }, 14 * 60 * 1000);
  }
});
