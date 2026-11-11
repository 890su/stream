import { existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { JournalStore } from './store/store.ts';

if (existsSync('.env')) process.loadEnvFile('.env');
const root = process.argv[2];
if (!root) throw new Error('Usage: node src/backup.ts <backup-directory>');
const destination = resolve(root);
mkdirSync(destination, { recursive: true });
const snapshot = join(destination, new Date().toISOString().replaceAll(':', '-'));
const store = new JournalStore(resolve(process.env.DATA_DIR || 'data'));
try { store.backupTo(snapshot); console.log(`Backup saved to ${snapshot}`); }
finally { store.close(); }
