import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type Client, type ButtonInteraction, type GuildTextBasedChannel } from 'discord.js';
import type { Task } from '../../models/Task.js';
import type { TaskPoll } from '../../models/TaskPoll.js';
import { TaskCategory } from '../../models/Task.js';
import { selectTasksForCategory } from './TaskSelector.js';
import type { ServiceContainer } from '../../core/services/ServiceContainer.js';
import { buildTaskPollEmbed, getTaskPollIconFile } from './TaskEmbeds.js';
import { isMentionSuppressed, withSuppressedMentions } from '../../utils/MentionUtils.js';
import { configuredChannel } from '../../utils/ChannelUtils.js';

const emojiNumbers = ['1️⃣', '2️⃣', '3️⃣'];
const PROD_TASK_POLL_DURATION_MS = 24 * 60 * 60 * 1000;
const DEV_TASK_POLL_DURATION_MS = 5 * 60 * 1000;

function getTaskPollDurationMs(): number {
    return process.env.BOT_MODE === 'dev' ? DEV_TASK_POLL_DURATION_MS : PROD_TASK_POLL_DURATION_MS;
}

function buildVoteMapFromPoll(poll: Pick<TaskPoll, "options" | "votes">): Map<string, number> {
    const voteMap = new Map<string, number>();
    for (const option of poll.options) {
        voteMap.set(option.id, 0);
    }

    Object.values(poll.votes ?? {}).forEach((optionId) => {
        voteMap.set(optionId, (voteMap.get(optionId) ?? 0) + 1);
    });

    return voteMap;
}

function buildPollMessage(poll: Omit<TaskPoll, 'id' | 'messageId'>) {
    const { category } = poll;
    const embed = buildTaskPollEmbed(
        category,
        poll.options,
        buildVoteMapFromPoll(poll),
        poll.isActive ? { endsAt: poll.endsAt } : { isClosed: true }
    );
    const buttons = poll.options.map((task, i) =>
        new ButtonBuilder()
            .setCustomId(`vote_${category}_${task.id}`)
            .setLabel(`${emojiNumbers[i]} ${task.shortName ?? `Task ${i + 1}`}`)
            .setStyle(ButtonStyle.Secondary)
    );
    const files = getTaskPollIconFile(category);

    return {
        embeds: [embed],
        components: poll.isActive ? [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)] : [],
        ...(files.length ? { files } : {}),
    };
}

export async function handleTaskPollVoteInteraction(
    interaction: ButtonInteraction,
    services: ServiceContainer
) {
    await interaction.deferReply({ flags: 1 << 6 });

    const [, categoryRaw, voteId] = interaction.customId.split('_');
    const category = Object.values(TaskCategory).find((value) => value === categoryRaw);
    if (!category || !voteId) {
        await interaction.editReply({ content: "Invalid poll vote option." });
        return;
    }

    const taskRepo = services.repos.taskRepo;

    const poll = await taskRepo.getTaskPollById(interaction.message.id);
    if (!poll?.isActive || poll.endsAt.getTime() <= Date.now()) {
        await interaction.editReply({ content: "This poll has closed." });
        return;
    }

    if (poll.category !== category) {
        await interaction.editReply({ content: "This poll message is outdated." });
        return;
    }

    if (!poll.options.some((option) => option.id === voteId)) {
        await interaction.editReply({ content: "Invalid vote option." });
        return;
    }

    let firstTime = false;
    let updatedPoll = poll;
    try {
        const result = await taskRepo.voteInPollOnce(poll.id, interaction.user.id, voteId);
        firstTime = result.firstTime;
        updatedPoll = result.updatedPoll;
    } catch (err) {
        console.error("[TaskPoll] Failed to record vote transaction:", err);
        await interaction.editReply({ content: "An error occurred while recording your vote." });
        return;
    }

    if (firstTime) {
        const userRepo = services.repos.userRepo;
        try {
            await userRepo.incrementStat(interaction.user.id, "taskPollsVoted", 1);
        } catch (err) {
            console.warn(`[Stats] Failed to increment taskPollsVoted for ${interaction.user.username}:`, err);
        }
    }

    try {
        await interaction.message.edit(buildPollMessage(updatedPoll));
    } catch (err) {
        console.warn(`[TaskPoll] Failed to update the poll message for ${poll.id}:`, err);
    }
    await interaction.editReply({ content: "Thank you for your vote!" });
}

export async function postAllTaskPolls(client: Client, services: ServiceContainer) {
    const guildConfig = await services.guilds.get(services.guildId);
    if (!guildConfig) {
        console.warn(`[TaskPoll] Guild configuration missing for ${services.guildId}.`);
        return;
    }

    const leaguesEnabled = guildConfig.toggles?.leaguesEnabled ?? false;

    const categories: TaskCategory[] = [
        TaskCategory.PvM,
        TaskCategory.Skilling,
        TaskCategory.MinigameMisc,
    ];

    if (leaguesEnabled) {
        categories.push(TaskCategory.Leagues);
    }

    const channel = await configuredChannel(client, services, 'taskChannel');
    if (!channel) return;

    const roleId = guildConfig.roles?.taskUser;
    const role = roleId ? channel.guild.roles.cache.get(roleId) : null;
    const suppressMentions = await isMentionSuppressed(services.guilds, services.guildId);

    const mention = role ? `<@&${role.id}>` : '';
    if (!role) {
        console.warn(`[TaskPoll] Task user role not configured or not found.`);
    }
    await channel.send(
        withSuppressedMentions(
            { content: `${mention} **New task polls are live!** Cast your votes for each category below:` },
            suppressMentions
        )
    );

    for (const category of categories) {
        await postTaskPollForCategory(client, services, category, channel);
    }
}

export async function postTaskPollForCategory(
    client: Client,
    services: ServiceContainer,
    category: TaskCategory,
    channelOverride?: GuildTextBasedChannel
) {
    const channel = channelOverride ?? (await configuredChannel(client, services, 'taskChannel'));
    if (!channel) return;

    const repo = services.repos.taskRepo;

    const allTasks: Task[] = await repo.getAllTasks();
    const taskData = allTasks.filter(t => t.category === category);
    if (taskData.length < 3) {
        console.warn(`[TaskPoll] Not enough tasks to create a poll for category ${category}`);
        return;
    }

    const selectedTasks = selectTasksForCategory(category, allTasks);
    if (selectedTasks.length === 0) {
        console.warn(`[TaskPoll] No tasks selected for ${category}.`);
        return;
    }

    const createdAt = new Date();
    const draft: Omit<TaskPoll, 'id' | 'messageId'> = {
        type: "task",
        category,
        options: selectedTasks,
        channelId: channel.id,
        createdAt,
        endsAt: new Date(createdAt.getTime() + getTaskPollDurationMs()),
        isActive: true,
        votes: {},
    };

    const message = await channel.send(buildPollMessage(draft));
    await repo.createTaskPoll({ ...draft, id: message.id, messageId: message.id });
}

export async function refreshTaskPollMessage(client: Client, poll: TaskPoll) {
    if (!poll.messageId || !poll.channelId) return;

    const channel = await client.channels.fetch(poll.channelId).catch(() => null);
    if (!channel?.isTextBased()) return;

    const message = await channel.messages.fetch(poll.messageId).catch(() => null);
    if (!message) return;

    await message.edit(buildPollMessage(poll));
}
