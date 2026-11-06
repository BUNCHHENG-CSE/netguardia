import { prisma } from '../src/lib/prisma';
import { seedDatabase } from '../src/lib/seedData';

async function main() {
  console.log('[Seed] Seeding initial NetGuardia fleet data...');
  await seedDatabase(prisma);
  const devCount = await prisma.device.count();
  console.log(`[Seed] Seed finished successfully! Monitored devices: ${devCount}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('[Seed] Error during seeding:', err);
  process.exit(1);
});
