import { randomUUID } from 'node:crypto';
import type { Client, GuildTextBasedChannel } from 'discord.js';
import { DateTime } from 'luxon';
import { buildTaskEventEmbed } from './TaskEmbeds.js';
import type { TaskEvent } from '../../models/TaskEvent.js';
import type { ServiceContainer } from '../../core/services/ServiceContainer.js';
import { TaskCategory } from '../../models/Task.js';
import { registerPeriodicTaskEvent } from './TaskLeaderboards.js';
import { isMentionSuppressed, withSuppressedMentions } from '../../utils/MentionUtils.js';
import { refreshTaskPollMessage } from './HandleTaskPoll.js';
import { configuredChannel } from '../../utils/ChannelUtils.js';

function generateTaskEventId(taskId: string): string {
    return `${taskId}-${DateTime.utc().toFormat('yyyyLLdd')}-${randomUUID().slice(0, 8)}`;
}

export async function refreshTaskEventMessage(client: Client, event: TaskEvent): Promise<void> {
    if (!event.messageId || !event.channelId) return;

    const channel = await client.channels.fetch(event.channelId).catch(() => null);
    if (!channel?.isTextBased()) {
        throw new Error(`Task event ${event.id} is posted in ${event.channelId}, which is not a text channel the bot can reach.`);
    }

    const message = await channel.messages.fetch(event.messageId);
    const { embeds, components, files } = buildTaskEventEmbed(event);
    await message.edit({ embeds, components, files });
}

export async function startAllTaskEvents(client: Client, services: ServiceContainer): Promise<void> {
    const { keywords } = services;

    const guildConfig = await services.guilds.get(services.guildId);
    if (!guildConfig) {
        console.warn(`[TaskStart] Guild configuration not found for ${services.guildId}.`);
        return;
    }
    const leaguesEnabled = guildConfig.toggles?.leaguesEnabled ?? false;

    const categories: TaskCategory[] = [
        TaskCategory.PvM,
        TaskCategory.Skilling,
        TaskCategory.MinigameMisc
    ];

    if (leaguesEnabled) categories.push(TaskCategory.Leagues);

    const sharedKeyword = await keywords.selectKeyword(`weekly-${Date.now()}`);

    const channel = await configuredChannel(client, services, 'taskChannel');
    if (!channel) return;

    const roleId = guildConfig.roles?.taskUser;
    const role = roleId ? channel.guild.roles.cache.get(roleId) : null;
    const mention = role ? `<@&${role.id}>` : '';
    const suppressMentions = await isMentionSuppressed(services.guilds, services.guildId);

    if (!role) {
        console.warn(`[TaskStart] Task user role not configured or not found.`);
    }

    await channel.send(withSuppressedMentions({
        content:
            `${mention} **The new tasks are live!**\n` +
            `Include the keyword **${sharedKeyword}** in your screenshots for verification 🔑`
    }, suppressMentions));

    for (const category of categories) {
        await startTaskEventForCategory(client, services, category, sharedKeyword, channel);
    }
}

export async function startTaskEventForCategory(
    client: Client,
    services: ServiceContainer,
    category: TaskCategory,
    sharedKeyword: string,
    channelOverride?: GuildTextBasedChannel
): Promise<void> {
    const { repos, taskEvents } = services;

    const channel = channelOverride ?? (await configuredChannel(client, services, 'taskChannel'));
    if (!channel) return;

    const pollData =
        (await repos.taskRepo.getActiveTaskPollByCategory(category)) ??
        (await repos.taskRepo.getLatestTaskPollByCategory(category));

    if (!pollData || !pollData.options?.length) {
        console.warn(`[TaskStart] No active poll found for ${category}.`);
        return;
    }

    // Tally votes per option ID
    const voteCounts: Record<string, number> = {};
    for (const votedTaskId of Object.values(pollData.votes)) {
        voteCounts[votedTaskId] = (voteCounts[votedTaskId] ?? 0) + 1;
    }

    const maxVotes = Math.max(...pollData.options.map(opt => voteCounts[opt.id] ?? 0));
    const topTasks = pollData.options.filter(opt => (voteCounts[opt.id] ?? 0) === maxVotes);

    // Deterministically select winner; fall back to first in poll order for ties
    const winningTask = topTasks[0];
    if (!winningTask) return;

    const winnerLabel = winningTask.taskName ?? winningTask.id;
    if (topTasks.length > 1) {
        console.log(`[TaskStart] Tie detected in ${category}: ${topTasks.length} tasks tied with ${maxVotes} votes. Selected winner by poll order: ${winnerLabel}`);
    } else {
        console.log(`[TaskStart] Winner for ${category}: ${winnerLabel} (${maxVotes} votes)`);
    }

    // Load full task data
    const task = await repos.taskRepo.getTaskById(winningTask.id);
    if (!task) {
        console.error(`[TaskStart] Could not find task with id ${winningTask.id}`);
        return;
    }

    const taskEventId = generateTaskEventId(task.id);

    const now = DateTime.utc();
    const event: TaskEvent = {
        id: taskEventId,
        task,
        category,
        keyword: sharedKeyword,
        startTime: now.toJSDate(),
        endTime: now.plus({ weeks: 1 }).toJSDate(),
        amounts: {
            bronze: task.amtBronze,
            silver: task.amtSilver,
            gold: task.amtGold,
        },
        completionCounts: {
            bronze: 0,
            silver: 0,
            gold: 0
        },
        completedUserIds: [],
        createdAt: now.toJSDate(),
    };

    const { embeds, components, files } = buildTaskEventEmbed(event);

    const sentMessage = await channel.send({ embeds, components, files });

    event.messageId = sentMessage.id;
    event.channelId = channel.id;

    try {
        await taskEvents.storeTaskEvent(event);
    } catch (err) {
        await sentMessage.delete().catch((deleteErr) => {
            console.warn(`[TaskStart] Failed to remove the post for unsaved event ${taskEventId}:`, deleteErr);
        });
        throw err;
    }

    try {
        await registerPeriodicTaskEvent(services, taskEventId);
    } catch (err) {
        console.warn(`[TaskStart] Failed to register periodic leaderboard event ${taskEventId}:`, err);
    }

    if (pollData.id) {
        await repos.taskRepo.closeTaskPoll(pollData.id);
        try {
            await refreshTaskPollMessage(client, { ...pollData, isActive: false });
        } catch (err) {
            console.warn(`[TaskStart] Failed to show the ${category} poll as closed:`, err);
        }
    }

    console.log(`[TaskStart] Task event posted for ${category} (${taskEventId})`);
}
