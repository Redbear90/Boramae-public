import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function checkSchema() {
  try {
    const res = await pool.query(`
      SELECT column_name, data_type, column_default, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'posts'
      ORDER BY ordinal_position;
    `);
    console.log('Columns in posts table:');
    res.rows.forEach(row => {
      console.log(`- ${row.column_name}: ${row.data_type} (Default: ${row.column_default}, Nullable: ${row.is_nullable})`);
    });

  } catch (err) {
    console.error('Error checking schema:', err);
  } finally {
    await pool.end();
  }
}

checkSchema();
