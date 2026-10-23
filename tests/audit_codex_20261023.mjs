// Historical audit command now runs assertions that require the defects to stay fixed.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const result = spawnSync(process.execPath, ['--test', fileURLToPath(new URL('./admin-security.test.mjs', import.meta.url))], { stdio: 'inherit' });
process.exitCode = result.status ?? 2;
