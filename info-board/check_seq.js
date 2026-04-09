import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function checkSeq() {
  try {
    const res = await pool.query("SELECT last_value, is_called FROM posts_id_seq");
    console.log('Sequence status:', res.rows[0]);
    const res2 = await pool.query("SELECT max(id) FROM posts");
    console.log('Max ID in posts:', res2.rows[0].max);
  } catch (err) {
    console.error('Error checking sequence:', err);
  } finally {
    await pool.end();
  }
}

checkSeq();
