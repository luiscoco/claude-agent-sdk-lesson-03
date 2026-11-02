import { fileURLToPath } from 'node:url';
import path from 'node:path';
export const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const WORKSPACE = path.join(PROJECT_ROOT, 'fixtures', 'workspace');
