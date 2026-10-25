import { ChannelType, type Client, type Interaction, type Message } from 'discord.js';
import cron from 'node-cron';
import type { Firestore } from 'firebase-admin/firestore';
import { loadCommands } from './core/services/CommandService.js';
import { handleMessage } from './core/events/onMessage.js';
import { routeInteraction } from './core/events/routeInteraction.js';
import { handleDirectMessage } from './modules/tasks/TaskInteractions.js';
import { registerGuildCommands } from './utils/registerCommands.js';
import { cancelActivePollSchedule, scheduleActivePollClosure } from './modules/movies/MoviePollScheduler.js';
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
    fallbackGuildId: string | null;
    commandSync: { token: string; clientId: string } | null;
}

export async function startBot(client: Client, { db, commandsDir, fallbackGuildId, commandSync }: BotOptions): Promise<() => Promise<void>> {
    // Load commands from /modules/commands recursively
    console.log('Loading commands...');
    const commands = await loadCommands(commandsDir);
    console.log(`Loaded ${commands.size} commands.`);

    const guildRepo = new GuildRepository(db);
    const guildConfigs = await guildRepo.getAllGuilds();
    console.log(`Found ${guildConfigs.length} guild(s) in Firestore.`);

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

    const inProgress = new Set<Promise<void>>();
    const track = (work: Promise<void>) => {
        inProgress.add(work);
        void work.finally(() => inProgress.delete(work));
    };

    // Register message handler
    const onMessageCreate = (message: Message) => track(handleMessageEvent(message));
    const handleMessageEvent = async (message: Message) => {
        try {
            if (message.channel.type === ChannelType.DM) {
                // A DM belongs to no guild, so every guild the bot is in is asked whether it expects one
                await handleDirectMessage(message, client, client.guilds.cache.map((guild) => getServices(guild.id)));
            } else if (message.guildId) {
                const services = getServices(message.guildId);
                await handleMessage(message, commands, services);
            }
        } catch (error) {
            console.error('Error handling message:', error);
        }
    };
    client.on('messageCreate', onMessageCreate);

    // Register interaction handler
    const onInteractionCreate = (interaction: Interaction) => track(handleInteractionEvent(interaction));
    const handleInteractionEvent = async (interaction: Interaction) => {
        try {
            const guildId = interaction.guildId ?? primaryGuildId;
            await routeInteraction(interaction, client, commands, getServices(guildId));
        } catch (error) {
            console.error('Error handling interaction:', error);
        }
    };
    client.on('interactionCreate', onInteractionCreate);

    // Ready event
    let initialised: Promise<void> | undefined;

    const initialiseGuilds = async (): Promise<void> => {
        console.log(`Logged in as ${client.user?.tag}!`);
        const primaryServices = getServices(primaryGuildId);
        await scheduleActivePollClosure(primaryServices, client);

        for (const guild of guildConfigs) {
            if (guild.toggles?.taskScheduler) {
                console.log(`[Startup] Starting Task Scheduler for ${guild.id}`);
                const guildServices = getServices(guild.id);
                await initTaskScheduler(client, guildServices);
            }
        }

        initMovieScheduler(client);
        console.log("[MovieModule] Scheduler and attendance tracking initialised.");

        await SchedulerStatusReporter.logAllUpcoming(primaryServices);
        SchedulerStatusReporter.scheduleDailyLog(primaryServices);

        console.log('All guilds initialised.');
    };

    client.once('clientReady', () => {
        initialised = initialiseGuilds().catch((err) => {
            console.error('[Startup] Failed to start the schedulers:', err);
        });
    });

    return async () => {
        client.off('messageCreate', onMessageCreate);
        client.off('interactionCreate', onInteractionCreate);
        await Promise.all(inProgress);
        await initialised;
        await cron.shutdown();
        cancelActivePollSchedule();
        await client.destroy();
    };
}
