import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function checkConstraints() {
  try {
    const res = await pool.query(`
      SELECT conname, pg_get_constraintdef(c.oid)
      FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = 'public' AND conrelid = 'posts'::regclass;
    `);
    console.log('Constraints on posts table:');
    res.rows.forEach(row => {
      console.log(`- ${row.conname}: ${row.pg_get_constraintdef}`);
    });

    const res2 = await pool.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'posts';
    `);
    console.log('Indexes on posts table:');
    res2.rows.forEach(row => {
      console.log(`- ${row.indexname}: ${row.indexdef}`);
    });

  } catch (err) {
    console.error('Error checking constraints:', err);
  } finally {
    await pool.end();
  }
}

checkConstraints();
