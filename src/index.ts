import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { config } from 'dotenv';
import path from 'path';
import { loadCommands } from './core/services/CommandService.js';
import { createFirestore } from './core/database/firestore.js';
import { startBot } from './bot.js';
import { getDirname } from './utils/PathUtils.js';
const dirname = getDirname(import.meta.url);
const isDryRun = process.argv.includes('--dryrun') || process.argv.includes('--dry-run');

// Load environment variables (only for global secrets)
config();

const commandsDir = path.join(dirname, 'modules', 'commands');
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

    // Create Discord client with required intents
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.DirectMessages,
            GatewayIntentBits.GuildVoiceStates,
            GatewayIntentBits.GuildMembers,
        ],
        partials: [Partials.Channel]
    });

    await startBot(client, {
        db: createFirestore(),
        commandsDir,
        fallbackGuildId: process.env.DISCORD_GUILD_ID ?? null,
        commandSync: resolveCommandSync(),
    });

    await client.login(loginToken);
}

main().catch((err) => {
    console.error('[Startup] BustinBot failed to start:', err);
    process.exitCode = 1;
});
