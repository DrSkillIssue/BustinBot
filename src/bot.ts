import type { Client } from 'discord.js';
import type { Firestore } from 'firebase-admin/firestore';
import { loadCommands } from './core/services/CommandService.js';
import { handleMessage } from './core/events/onMessage.js';
import { handleInteraction } from './core/events/onInteraction.js';
import { handleDirectMessage } from './modules/tasks/TaskInteractions.js';
import { handleTaskInteraction } from './modules/tasks/TaskInteractionHandler.js';
import { registerGuildCommands } from './utils/registerCommands.js';
import { scheduleActivePollClosure } from './modules/movies/MoviePollScheduler.js';
import { createServiceContainer } from './core/services/ServiceFactory.js';
import { GuildRepository } from './core/database/GuildRepo.js';
import { initTaskScheduler } from './modules/tasks/TaskScheduler.js';
import { handleMovieInteraction } from './modules/movies/MovieInteractionHandler.js';
import { initMovieScheduler } from './modules/movies/MovieScheduler.js';
import { SchedulerStatusReporter } from './core/services/SchedulerStatusReporter.js';

export interface BotOptions {
    db: Firestore;
    commandsDir: string;
    // Guild to treat as primary when Firestore has no guild configs yet
    fallbackGuildId: string | null;
    // Credentials for syncing slash commands to the primary guild on startup, when enabled
    commandSync: { token: string; clientId: string } | null;
}

// Wires the client to the bot's commands, services and schedulers. Logging in is left to the caller.
export async function startBot(client: Client, { db, commandsDir, fallbackGuildId, commandSync }: BotOptions): Promise<void> {
    console.log('Loading commands...');
    const commands = await loadCommands(commandsDir);
    console.log(`Loaded ${commands.size} commands.`);

    const guildRepo = new GuildRepository(db);
    const guildConfigs = await guildRepo.getAllGuilds();
    console.log(`Found ${guildConfigs.length} guild(s) in Firestore.`);

    const servicesByGuild = new Map<string, Awaited<ReturnType<typeof createServiceContainer>>>();
    const getServices = async (guildId: string) => {
        if (!servicesByGuild.has(guildId)) {
            const services = await createServiceContainer(db, guildId);
            servicesByGuild.set(guildId, services);
        }
        return servicesByGuild.get(guildId)!;
    };

    const primaryGuildId = guildConfigs[0]?.id ?? fallbackGuildId;
    if (!primaryGuildId) {
        throw new Error('No guild ID available. Set DISCORD_GUILD_ID or ensure at least one guild exists in Firestore.');
    }

    if (commandSync) {
        try {
            client.rest.setToken(commandSync.token);
            await registerGuildCommands(client.rest, commandSync.clientId, primaryGuildId, commands);
        } catch (err) {
            console.error('Failed to sync guild slash commands:', err);
        }
    }

    // Register message handler
    client.on('messageCreate', async (message) => {
        try {
            if (message.channel.type === 1) {
                let services: Awaited<ReturnType<typeof createServiceContainer>> | undefined;

                for (const existingServices of servicesByGuild.values()) {
                    if (existingServices.tasks.hasPendingTask(message.author.id)) {
                        services = existingServices;
                        break;
                    }
                }

                if (!services) {
                    // Fall back to the guild the DM originated from (if tracked) or the primary guild.
                    const fallbackGuild = message.guildId ?? primaryGuildId;
                    services = await getServices(fallbackGuild);
                }

                await handleDirectMessage(message, client, services);
            } else if (message.guildId) {
                const services = await getServices(message.guildId);
                await handleMessage(message, commands, services);
            }
        } catch (error) {
            console.error('Error handling message:', error);
        }
    });

    // Register interaction handler
    client.on('interactionCreate', async (interaction) => {
        try {
            const guildId = interaction.guildId ?? primaryGuildId;
            const guildServices = await getServices(guildId);

            await handleInteraction(interaction, commands, guildServices);
            await handleMovieInteraction(interaction, guildServices);
            await handleTaskInteraction(interaction, client, guildServices);
        } catch (error) {
            console.error('Error handling interaction:', error);
        }
    });

    // Ready event
    client.once('clientReady', async () => {
        console.log(`Logged in as ${client.user?.tag}!`);
        const primaryServices = await createServiceContainer(db, primaryGuildId);
        await scheduleActivePollClosure(primaryServices, client);

        for (const guild of guildConfigs) {
            if (guild.toggles?.taskScheduler) {
                console.log(`[Startup] Starting Task Scheduler for ${guild.id}`);
                const guildServices = await getServices(guild.id);
                initTaskScheduler(client, guildServices);
            }
        }

        initMovieScheduler(client);
        console.log("[MovieModule] Scheduler and attendance tracking initialised.");

        await SchedulerStatusReporter.logAllUpcoming(primaryServices);
        SchedulerStatusReporter.scheduleDailyLog(primaryServices);

        console.log('All guilds initialised.');
    });
}
