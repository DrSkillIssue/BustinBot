import { ChannelType, type Client, type Interaction, type Message, type VoiceState } from 'discord.js';
import cron from 'node-cron';
import type { Firestore } from 'firebase-admin/firestore';
import { loadCommands } from './core/services/CommandService.js';
import { handleMessage } from './core/events/onMessage.js';
import { routeInteraction } from './core/events/routeInteraction.js';
import { handleDirectMessage } from './modules/tasks/TaskInteractions.js';
import { registerGuildCommands } from './utils/registerCommands.js';
import { createServiceContainer } from './core/services/ServiceFactory.js';
import type { ServiceContainer } from './core/services/ServiceContainer.js';
import { BotStatsService } from './core/services/BotStatsService.js';
import { BotRepository } from './core/database/BotRepo.js';
import { GuildRepository } from './core/database/GuildRepo.js';
import { initTaskScheduler } from './modules/tasks/TaskScheduler.js';
import { startMovieScheduler } from './modules/movies/MovieScheduler.js';
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
// Returns a function that shuts the bot down gracefully: it stops taking events, lets those being handled finish,
// stops the schedulers started on ready and disconnects the client.
export async function startBot(client: Client, { db, commandsDir, fallbackGuildId, commandSync }: BotOptions): Promise<() => Promise<void>> {
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

    // Events being handled right now, so shutting down can let them finish
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

    // Voice joins and leaves count towards the attendance of the guild's movie night
    const onVoiceStateUpdate = (oldState: VoiceState, newState: VoiceState) => {
        getServices(newState.guild.id).movieAttendance.voiceStateChanged(oldState, newState);
    };
    client.on('voiceStateUpdate', onVoiceStateUpdate);

    // Ready event. Its work is kept so shutting down can wait for it, rather than racing it and leaving behind
    // schedulers started after the stop.
    let initialised: Promise<void> | undefined;

    const initialiseGuilds = async (): Promise<void> => {
        console.log(`Logged in as ${client.user?.tag}!`);
        const primaryServices = getServices(primaryGuildId);

        for (const guild of guildConfigs) {
            if (guild.toggles?.taskScheduler) {
                console.log(`[Startup] Starting Task Scheduler for ${guild.id}`);
                const guildServices = getServices(guild.id);
                await initTaskScheduler(client, guildServices);
            }
        }

        startMovieScheduler(client, () => client.guilds.cache.map((guild) => getServices(guild.id)));
        console.log("[MovieModule] Movie night scheduler started.");

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
        // Take no new events, then let the ones being handled finish before anything they use is stopped
        client.off('messageCreate', onMessageCreate);
        client.off('interactionCreate', onInteractionCreate);
        client.off('voiceStateUpdate', onVoiceStateUpdate);
        await Promise.all(inProgress);
        await initialised;
        // node-cron's own shutdown stops every scheduled job, waiting for any that is running to finish
        await cron.shutdown();
        await client.destroy();
    };
}
