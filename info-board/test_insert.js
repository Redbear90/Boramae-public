import pg from 'pg';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

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

async function testInsert() {
  const title = "Test Title";
  const content = "Test Content";
  const password = "testpassword";
  const author = "Test Author";
  const phone = "010-1234-5678";
  const ip = "127.0.0.1";
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const time = now.toTimeString().slice(0, 5);

  try {
    const hashedPw = await bcrypt.hash(password, 10);
    const encryptedContent = encrypt(content);
    const displayAuthor = author?.trim() || '익명';
    const displayPhone = phone?.trim() || null;

    console.log('Attempting insert...');
    const result = await pool.query(
      `INSERT INTO posts (title, content, category, author, date, time, images, password, ip_address, is_public_post, phone, sort_order)
       VALUES ($1, $2, '문의사항', $3, $4, $5, '{}', $6, $7, TRUE, $8, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM posts))
       RETURNING id, title, category, author, date, time, is_public_post`,
      [title.trim(), encryptedContent, displayAuthor, date, time, hashedPw, ip, displayPhone]
    );
    console.log('Insert successful:', result.rows[0]);
  } catch (err) {
    console.error('Insert failed:', err);
  } finally {
    await pool.end();
  }
}

testInsert();
