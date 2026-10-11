import path from 'path';
import { registerSlashCommands } from '../utils/registerCommands.js';
import { getDirname } from '../utils/PathUtils.js';
const dirname = getDirname(import.meta.url);

try {
    await registerSlashCommands({
        modulesDir: path.join(dirname, '..', 'modules', 'commands'),
    });
    console.log('✅ Slash command registration complete.');
    process.exit(0);
} catch (err) {
    console.error('Failed to register slash commands:', err);
    process.exit(1);
}
