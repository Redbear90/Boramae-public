import express from 'express';
import pg from 'pg';
import dotenv from 'dotenv';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 5000;

app.use(cors({
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));
app.options('*', cors());
app.use(express.json({ limit: '50mb' }));

const { Pool } = pg;

app.get('/health', (req, res) => res.json({ status: 'ok' }));

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL 환경변수가 설정되지 않았습니다.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'ap-northeast-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
const S3_BUCKET = process.env.S3_BUCKET || 'boramae-images';

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

// 테이블 및 컬럼 자동 생성/추가
async function initDb() {
  // 1. posts 테이블 생성
  await pool.query(`
    CREATE TABLE IF NOT EXISTS posts (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      category TEXT NOT NULL,
      author TEXT,
      date TEXT,
      time TEXT,
      images TEXT[] DEFAULT '{}',
      password TEXT,
      ip_address TEXT,
      is_public_post BOOLEAN DEFAULT FALSE,
      phone TEXT,
      sort_order INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // 2. 누락된 컬럼 추가 (기존 DB에서 이전했을 경우 대비)
  const columnsToAdd = [
    { name: 'password', type: 'TEXT' },
    { name: 'ip_address', type: 'TEXT' },
    { name: 'is_public_post', type: 'BOOLEAN DEFAULT FALSE' },
    { name: 'phone', type: 'TEXT' },
    { name: 'sort_order', type: 'INTEGER' },
    { name: 'images', type: 'TEXT[] DEFAULT \'{}\'' }
  ];

  for (const col of columnsToAdd) {
    await pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`);
  }

  // 3. replies 테이블 생성
  await pool.query(`
    CREATE TABLE IF NOT EXISTS replies (
      id         SERIAL PRIMARY KEY,
      post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      content    TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // 4. 성능 인덱스
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_posts_sort ON posts(category, sort_order ASC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_replies_post ON replies(post_id)`);
}

// 1. 게시물 전체 목록 조회 (replies 포함)
app.get('/api/posts', async (req, res) => {
  const isAdmin = req.query.admin === '1';
  try {
    const [postsResult, repliesResult] = await Promise.all([
      pool.query(`
        SELECT * FROM posts
        ORDER BY
          CASE WHEN category = '공지' THEN 0 ELSE 1 END,
          sort_order ASC
      `),
      pool.query('SELECT id, post_id, content, created_at FROM replies ORDER BY created_at ASC'),
    ]);

    const repliesByPost = {};
    for (const r of repliesResult.rows) {
      if (!repliesByPost[r.post_id]) repliesByPost[r.post_id] = [];
      repliesByPost[r.post_id].push(r);
    }

    const rows = postsResult.rows.map(post => {
      const base = {
        ...post,
        images: post.images || [],
        replies: repliesByPost[post.id] || [],
      };
      if (post.is_public_post) {
        return {
          ...base,
          // 관리자: 복호화된 내용 + 연락처 + IP / 일반: 잠금
          content: isAdmin ? decrypt(post.content) : null,
          phone: isAdmin ? post.phone : undefined,
          password: undefined,
          ip_address: isAdmin ? post.ip_address : undefined,
          masked_ip: isAdmin ? maskIp(post.ip_address) : undefined,
        };
      }
      return base;
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

// 2-1. 문의사항 공개 글쓰기
app.post('/api/posts/public', async (req, res) => {
  const { title, content, password, author, phone } = req.body;
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
    const displayPhone = phone?.trim() || null;

    const result = await pool.query(
      `INSERT INTO posts (title, content, category, author, date, time, images, password, ip_address, is_public_post, phone, sort_order)
       VALUES ($1, $2, '문의사항', $3, $4, $5, '{}', $6, $7, TRUE, $8, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM posts))
       RETURNING id, title, category, author, date, time, is_public_post`,
      [title.trim(), encryptedContent, displayAuthor, date, time, hashedPw, ip, displayPhone]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '게시물 작성 중 오류 발생' });
  }
});

// 2-2. 비밀번호 검증 → 맞으면 복호화된 내용 반환
app.post('/api/posts/:id/verify', async (req, res) => {
  const { id } = req.params;
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: '비밀번호를 입력해주세요.' });

  try {
    const { rows } = await pool.query(
      'SELECT content, password, phone FROM posts WHERE id = $1 AND is_public_post = TRUE',
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: '게시물을 찾을 수 없습니다.' });

    const match = await bcrypt.compare(password, rows[0].password);
    if (!match) return res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });

    res.json({
      content: decrypt(rows[0].content),
      phone: rows[0].phone || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 3. 게시물 순서 변경
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

// 6. 이미지 업로드 (S3)
app.post('/api/upload', async (req, res) => {
  const { image, filename } = req.body;
  if (!image || !filename) return res.status(400).json({ error: '이미지 데이터가 없습니다.' });
  try {
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    const ext = filename.split('.').pop() || 'jpg';
    const key = `images/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: `image/${ext}`,
    }));
    const url = `https://${S3_BUCKET}.s3.ap-northeast-2.amazonaws.com/${key}`;
    res.json({ url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '이미지 업로드 실패' });
  }
});

// 7. 답글 작성
app.post('/api/posts/:id/replies', async (req, res) => {
  const { id } = req.params;
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: '내용을 입력해주세요.' });
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

// 7. 답글 삭제
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

const distPath = path.join(__dirname, '../dist');
app.use(express.static(distPath));
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(port, async () => {
  console.log(`서버가 포트 ${port} 에서 실행 중입니다.`);
  try {
    await initDb();
    console.log('DB 초기화 완료');
    // Pool 연결 미리 warm-up (첫 요청 지연 방지)
    await pool.query('SELECT 1');
    console.log('DB 연결 warm-up 완료');
  } catch (err) {
    console.error('DB 초기화 실패:', err);
  }

  const APP_URL = process.env.APP_URL;
  if (APP_URL) {
    setInterval(() => {
      fetch(`${APP_URL}/health`)
        .then(() => console.log('keep-alive ping 성공'))
        .catch(err => console.error('keep-alive ping 실패:', err));
    }, 5 * 60 * 1000);
  }
});
