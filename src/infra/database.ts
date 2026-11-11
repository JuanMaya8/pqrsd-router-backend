import { Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { migrate, PgPqrsdRepository, type AppConfig } from '../domain';

export interface Database {
  repo: PgPqrsdRepository;
  close(): Promise<void>;
}

/** Opens the pool, applies pending migrations on one dedicated connection and returns the repository. */
export async function openDatabase(config: AppConfig): Promise<Database> {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
  pool.on('error', (e) => new Logger('Database').error(`Conexión inactiva con error: ${e.message}`));
  const client = await pool.connect();
  try {
    const applied = await migrate(client);
    if (applied.length) new Logger('Database').log(`Migraciones aplicadas: ${applied.join(', ')}`);
  } finally {
    client.release();
  }
  return { repo: new PgPqrsdRepository(pool), close: () => pool.end() };
}
