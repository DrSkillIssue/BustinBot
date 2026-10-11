import type { Client } from 'discord.js';
import type { Firestore } from 'firebase-admin/firestore';
import { loadCommands } from './core/services/CommandService.js';
import { handleMessage } from './core/events/onMessage.js';
import { routeInteraction } from './core/events/routeInteraction.js';
import { handleDirectMessage } from './modules/tasks/TaskInteractions.js';
import { registerGuildCommands } from './utils/registerCommands.js';
import { scheduleActivePollClosure } from './modules/movies/MoviePollScheduler.js';
import { createServiceContainer } from './core/services/ServiceFactory.js';
import type { ServiceContainer } from './core/services/ServiceContainer.js';
import { BotStatsService } from './core/services/BotStatsService.js';
import { BotRepository } from './core/database/BotRepo.js';
import { GuildRepository } from './core/database/GuildRepo.js';
import { initTaskScheduler } from './modules/tasks/TaskScheduler.js';
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

    // Bot-wide stats are shared by every guild so counts stay consistent across them
    const botStats = new BotStatsService(new BotRepository(db));
    await botStats.init();

    const servicesByGuild = new Map<string, ServiceContainer>();
    const getServices = (guildId: string): ServiceContainer => {
        if (!servicesByGuild.has(guildId)) {
            const services = createServiceContainer(db, guildId, botStats);
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
                let services: ServiceContainer | undefined;

                for (const existingServices of servicesByGuild.values()) {
                    if (existingServices.tasks.hasPendingTask(message.author.id)) {
                        services = existingServices;
                        break;
                    }
                }

                if (!services) {
                    // Fall back to the guild the DM originated from (if tracked) or the primary guild.
                    const fallbackGuild = message.guildId ?? primaryGuildId;
                    services = getServices(fallbackGuild);
                }

                await handleDirectMessage(message, client, services);
            } else if (message.guildId) {
                const services = getServices(message.guildId);
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
            await routeInteraction(interaction, client, commands, getServices(guildId));
        } catch (error) {
            console.error('Error handling interaction:', error);
        }
    });

    // Ready event
    client.once('clientReady', async () => {
        console.log(`Logged in as ${client.user?.tag}!`);
        const primaryServices = getServices(primaryGuildId);
        await scheduleActivePollClosure(primaryServices, client);

        for (const guild of guildConfigs) {
            if (guild.toggles?.taskScheduler) {
                console.log(`[Startup] Starting Task Scheduler for ${guild.id}`);
                const guildServices = getServices(guild.id);
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
