import { MessageFlags, type ModalSubmitInteraction } from "discord.js";
import { DateTime } from "luxon";
import { TaskType, type Task } from "../../models/Task.js";
import type { ServiceContainer } from "../../core/services/ServiceContainer.js";
import { refreshTaskPollMessage } from "./HandleTaskPoll.js";
import { refreshTaskEventMessage } from "./HandleTaskStart.js";
import { AMOUNTS_ERROR, parseAmounts } from "./TaskForm.js";

export async function handleUpdateTaskModal(interaction: ModalSubmitInteraction, services: ServiceContainer) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const repo = services.repos.taskRepo;

    const taskId = interaction.customId.replace("update_task_modal_", "");
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

    const activeEvent = await repo.getLatestTaskEvent();
    if (activeEvent && activeEvent.task.id === task.id && activeEvent.messageId && activeEvent.channelId) {
        activeEvent.task = task;
        activeEvent.amounts = {
            bronze: task.amtBronze,
            silver: task.amtSilver,
            gold: task.amtGold,
        }
        const event = normaliseFirestoreDates(activeEvent);

    try {
        await saveAndRedraw(interaction, services, updated);
    } catch (err) {
        console.error(`[HandleUpdateTaskModal] Failed to save task ${taskId}:`, err);
        await interaction.editReply({ content: `Couldn't save task **${taskId}**. Please try again.` });
        return;
    }

    await interaction.editReply({ content: `Task **${taskId}** updated successfully.` });
}

async function saveAndRedraw(interaction: ModalSubmitInteraction, services: ServiceContainer, task: Task): Promise<void> {
    const repo = services.repos.taskRepo;
    await services.tasks.createTask(task);

    const now = new Date();
    const activeEvents = (
        await repo.getTaskEventsBetween(now, DateTime.fromJSDate(now).plus({ days: 30 }).toJSDate())
    ).filter((event) => event.task.id === task.id && event.startTime <= now);

    const amounts = { bronze: task.amtBronze, silver: task.amtSilver, gold: task.amtGold };
    for (const activeEvent of activeEvents) {
        await repo.updateTaskEventTask(activeEvent.id, task, amounts);

        try {
            await refreshTaskEventMessage(interaction.client, { ...activeEvent, task, amounts });
        } catch (err) {
            console.error("[HandleUpdateTaskModal] Failed to update active task event embed:", err);
        }
    }

    const activePoll = await repo.getActiveTaskPollByCategory(task.category);
    if (activePoll?.options.some(option => option.id === task.id)) {
        activePoll.options = activePoll.options.map(option =>
            option.id === task.id ? { ...option, ...task } : option
        );
        await repo.updateTaskPollOptions(activePoll.id, activePoll.options);
        try {
            await refreshTaskPollMessage(interaction.client, activePoll);
        } catch (err) {
            console.error("[HandleUpdateTaskModal] Failed to refresh active task poll embed:", err);
        }
    }
}
