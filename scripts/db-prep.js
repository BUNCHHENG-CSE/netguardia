const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const prismaDir = path.join(rootDir, 'prisma');
const schemaTarget = path.join(prismaDir, 'schema.prisma');
const sqliteSchema = path.join(prismaDir, 'schema.sqlite.prisma');
const postgresSchema = path.join(prismaDir, 'schema.postgresql.prisma');

const targetArg = process.argv[2]?.toLowerCase();
let mode = 'sqlite';

if (targetArg === 'postgres' || targetArg === 'neon' || targetArg === 'postgresql') {
  mode = 'postgres';
} else if (targetArg === 'sqlite') {
  mode = 'sqlite';
} else {
  // Check environment variable
  const dbUrl = process.env.DATABASE_URL || '';
  if (dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://')) {
    mode = 'postgres';
  } else {
    mode = 'sqlite';
  }
}

console.log(`[db-prep] Configuring Prisma for: ${mode.toUpperCase()} (mode=${mode})`);

if (mode === 'postgres') {
  fs.copyFileSync(postgresSchema, schemaTarget);
  console.log('[db-prep] Copied prisma/schema.postgresql.prisma -> prisma/schema.prisma');
} else {
  fs.copyFileSync(sqliteSchema, schemaTarget);
  console.log('[db-prep] Copied prisma/schema.sqlite.prisma -> prisma/schema.prisma');
}

try {
  console.log('[db-prep] Running prisma generate...');
  execSync('bun x prisma generate', { stdio: 'inherit', cwd: rootDir });
  console.log('[db-prep] Prisma client generated successfully!');
} catch (err) {
  console.error('[db-prep] Failed to generate prisma client:', err.message);
}
