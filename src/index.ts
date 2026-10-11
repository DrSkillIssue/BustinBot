import { Client } from 'discord.js';
import { config } from 'dotenv';
import path from 'path';
import { loadCommands } from './core/services/CommandService.js';
import { createFirestore } from './core/database/firestore.js';
import { startBot } from './bot.js';
import { clientOptions } from './clientOptions.js';
const isDryRun = process.argv.includes('--dryrun') || process.argv.includes('--dry-run');

// Load environment variables (only for global secrets)
config();

const commandsDir = path.join(import.meta.dirname, 'modules', 'commands');
const isDevMode = process.env.BOT_MODE === 'dev';

function resolveCommandSync(): { token: string; clientId: string } | null {
    const enableSync = process.env.ENABLE_GUILD_COMMAND_SYNC === 'true' || isDevMode;
    if (!enableSync) return null;

    const token = isDevMode
        ? process.env.DISCORD_TOKEN_DEV
        : process.env.DISCORD_TOKEN_LIVE ?? process.env.DISCORD_TOKEN_DEV;
    const clientId = isDevMode
        ? process.env.DISCORD_CLIENT_ID_DEV
        : process.env.DISCORD_CLIENT_ID ?? process.env.DISCORD_CLIENT_ID_DEV;

    if (!token || !clientId) {
        console.warn('[SlashCommands] Skipping guild sync; missing token or client ID env vars.');
        return null;
    }
    return { token, clientId };
}

async function main(): Promise<void> {
    if (!process.env.TMDB_API_KEY) {
        throw new Error('TMDB_API_KEY is not set in your environment variables.');
    }

    if (isDryRun) {
        console.log('Loading commands...');
        const commands = await loadCommands(commandsDir);
        console.log(`Loaded ${commands.size} commands.`);
        console.log('[DryRun] Startup preflight passed. Skipping Firestore and Discord login.');
        return;
    }

    // Login to Discord with the appropriate bot token
    const loginToken = isDevMode
        ? process.env.DISCORD_TOKEN_DEV
        : process.env.DISCORD_TOKEN_LIVE ?? process.env.DISCORD_TOKEN_DEV;
    if (!loginToken) {
        throw new Error('No Discord bot token available. Check DISCORD_TOKEN_LIVE / DISCORD_TOKEN_DEV.');
    }

    const client = new Client(clientOptions);

    const db = createFirestore();
    const shutdown = await startBot(client, {
        db,
        commandsDir,
        fallbackGuildId: process.env.DISCORD_GUILD_ID ?? null,
        commandSync: resolveCommandSync(),
    });

    // Hosts stop the bot with SIGINT (Ctrl+C in a console) or SIGTERM. Exit once cleanup is done instead of
    // waiting for every pending timer, such as reminders scheduled days ahead.
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
        process.once(signal, () => {
            console.log(`[Shutdown] ${signal} received; stopping BustinBot.`);
            shutdown()
                .then(() => db.terminate())
                .then(
                    () => process.exit(0),
                    (err) => {
                        console.error('[Shutdown] BustinBot did not stop cleanly:', err);
                        process.exit(1);
                    }
                );
        });
    }

    await client.login(loginToken);
}

main().catch((err) => {
    console.error('[Startup] BustinBot failed to start:', err);
    process.exitCode = 1;
});
