import type { ModalSubmitInteraction, TextChannel } from "discord.js";
import { buildTaskEventEmbed } from "./TaskEmbeds.js";
import { isTextChannel } from "../../utils/ChannelUtils.js";
import { TaskCategory, TaskType } from "../../models/Task.js";
import { normaliseFirestoreDates } from "../../utils/DateUtils.js";
import type { ServiceContainer } from "../../core/services/ServiceContainer.js";
import { refreshTaskPollMessage, syncActivePollSelection } from "./HandleTaskPoll.js";

export async function handleUpdateTaskModal(interaction: ModalSubmitInteraction, services: ServiceContainer) {
    await interaction.deferReply({ flags: 1 << 6 });

    const repo = services.repos?.taskRepo;
    if (!repo) {
        await interaction.editReply({ content: 'Task repository unavailable.' });
        return;
    }

    const taskId = interaction.customId.replace('update_task_modal_', '');
    const task = await repo.getTaskById(taskId);
    if (!task) {
        await interaction.editReply({ content: `Could not find task with ID **${taskId}**.` });
        return;
    }

    task.taskName = interaction.fields.getTextInputValue('taskName');
    task.type = interaction.fields.getTextInputValue('type') as TaskType;
    task.amtBronze = parseInt(interaction.fields.getTextInputValue('bronze')) || 0;
    task.amtSilver = parseInt(interaction.fields.getTextInputValue('silver')) || 0;
    task.amtGold = parseInt(interaction.fields.getTextInputValue('gold')) || 0;

    await repo.createTask(task);

    // Events from every category start together, so the latest event may belong to another category
    const now = new Date();
    const activeEvents = (await repo.getTaskEventsBetween(now, new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)))
        .filter(event => event.task.id === task.id && normaliseFirestoreDates(event).startTime <= now);

    for (const activeEvent of activeEvents) {
        if (!activeEvent.messageId || !activeEvent.channelId) continue;

        activeEvent.task = task;
        activeEvent.amounts = {
            bronze: task.amtBronze,
            silver: task.amtSilver,
            gold: task.amtGold,
        }
        const event = normaliseFirestoreDates(activeEvent);

        const { embeds, components, files } = buildTaskEventEmbed(event);

        let channel = interaction.client.channels.cache.get(activeEvent.channelId) as TextChannel | undefined;
        if (!channel) {
            const fetched = await interaction.client.channels.fetch(activeEvent.channelId).catch(() => null);
            channel = fetched && fetched.isTextBased() ? (fetched as TextChannel) : undefined;
        }

        if (!channel || !isTextChannel(channel)) {
            console.warn(`[HandleUpdateTaskModal] Could not resolve text channel ${activeEvent.channelId} for live embed update.`);
        } else {
            try {
                const message = await channel.messages.fetch(activeEvent.messageId);
                if (message) await message.edit({ embeds, components, files });
            } catch (err) {
                console.error('[HandleUpdateTaskModal] Failed to update active task event embed:', err);
            }
        }

        await repo.createTaskEvent(activeEvent);
    }

    if (task.category) {
        const activePoll = await repo.getActiveTaskPollByCategory(task.category as TaskCategory);
        if (activePoll?.options?.some(option => option.id === task.id)) {
            activePoll.options = activePoll.options.map(option =>
                option.id === task.id ? { ...option, ...task } : option
            );
            await repo.createTaskPoll(activePoll);
            syncActivePollSelection(activePoll.messageId, task);
            try {
                await refreshTaskPollMessage(interaction.client, activePoll);
            } catch (err) {
                console.error('[HandleUpdateTaskModal] Failed to refresh active task poll embed:', err);
            }
        }
    }

    await interaction.editReply({ content: `Task **${taskId}** updated successfully.` });
}
