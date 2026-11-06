import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export function getConfiguredDatabaseUrl(): string {
  return (process.env.DATABASE_URL || '').trim();
}

export function isPostgresUrl(url: string): boolean {
  return url.startsWith('postgresql://') || url.startsWith('postgres://');
}

export async function getDatabaseEngineInfo() {
  const dbUrl = getConfiguredDatabaseUrl();
  const isPg = isPostgresUrl(dbUrl);

  if (isPg) {
    try {
      const result = await prisma.$queryRawUnsafe<Array<{ version?: string }>>(
        'SELECT version() AS version;'
      );
      const ver = result[0]?.version || 'PostgreSQL (Neon Cloud)';
      return {
        engine: 'Prisma ORM • PostgreSQL (Neon Production)',
        mode: 'Production Cloud / Multi-Site DB (Neon Pooler / Serverless)',
        connected: true,
        version: ver,
        dsn_configured: true,
        schema_file: 'prisma/schema.postgresql.prisma',
      };
    } catch (exc: any) {
      return {
        engine: 'Prisma ORM • PostgreSQL (Unreachable)',
        mode: `Connection Error: ${exc.message || exc}`,
        connected: false,
        version: 'Unavailable',
        dsn_configured: true,
        schema_file: 'prisma/schema.postgresql.prisma',
      };
    }
  }

  // SQLite mode
  try {
    const sqliteVer = await prisma.$queryRawUnsafe<Array<{ [key: string]: any }>>(
      'SELECT sqlite_version() AS version;'
    );
    const ver = sqliteVer[0]?.version || '3.x';
    return {
      engine: 'Prisma ORM • SQLite WAL (Postgres-Ready)',
      mode: 'Local Appliance Mode (Set DATABASE_URL=postgresql://... for Neon Postgres)',
      connected: true,
      version: `SQLite ${ver} + Prisma 6`,
      dsn_configured: false,
      schema_file: 'prisma/schema.sqlite.prisma',
    };
  } catch (exc: any) {
    return {
      engine: 'Prisma ORM • SQLite',
      mode: 'Local Appliance Mode',
      connected: true,
      version: 'SQLite 3.x + Prisma 6',
      dsn_configured: false,
      schema_file: 'prisma/schema.sqlite.prisma',
    };
  }
}

export async function testPostgresConnection(dsn: string) {
  if (!isPostgresUrl(dsn)) {
    return {
      ok: false,
      message: 'DSN must start with postgresql:// or postgres://',
    };
  }

  // Test connection using pg client or dynamic Prisma client
  try {
    const { Client } = await import('pg').catch(() => ({ Client: null }));
    if (Client) {
      const client = new Client({ connectionString: dsn, connectionTimeoutMillis: 5000 });
      await client.connect();
      const res = await client.query('SELECT version();');
      await client.end();
      const ver = res.rows[0]?.version || 'PostgreSQL';
      return {
        ok: true,
        message: `Connected to PostgreSQL successfully: ${ver}`,
      };
    }

    // Fallback test via temporary PrismaClient if pg is not available
    const tempPrisma = new PrismaClient({
      datasources: { db: { url: dsn } },
    });
    const res = await tempPrisma.$queryRawUnsafe<Array<{ version?: string }>>(
      'SELECT version() AS version;'
    );
    await tempPrisma.$disconnect();
    return {
      ok: true,
      message: `Connected to PostgreSQL successfully: ${res[0]?.version || 'PostgreSQL'}`,
    };
  } catch (err: any) {
    return {
      ok: false,
      message: `PostgreSQL connection test failed: ${err.message || err}`,
    };
  }
}
