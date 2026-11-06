const fs = require('fs');
const path = require('path');

function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) {
      walk(p);
    } else if (f === 'route.ts') {
      const content = fs.readFileSync(p, 'utf-8');
      const lines = content.split('\n');
      const filtered = lines.filter((line) => !line.includes("export const dynamic = 'force-dynamic';"));
      fs.writeFileSync(p, filtered.join('\n'), 'utf-8');
    }
  }
}

walk(path.join(__dirname, '..', 'src', 'app', 'api'));
console.log('Successfully removed dynamic export from all route.ts files');
