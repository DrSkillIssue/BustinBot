import type { ModalSubmitInteraction } from "discord.js";
import { TaskType, type Task } from "../../models/Task.js";
import type { ITaskRepository } from "../../core/database/interfaces/ITaskRepo.js";
import type { ServiceContainer } from "../../core/services/ServiceContainer.js";
import { refreshTaskPollMessage } from "./HandleTaskPoll.js";
import { refreshTaskEventMessage } from "./HandleTaskStart.js";

function parseAmount(input: string): number | null {
    const digits = input.replace(/[,\s_]/g, '');
    return /^\d+$/.test(digits) ? Number(digits) : null;
}

function parseTaskType(input: string): TaskType | null {
    return Object.values(TaskType).find((type) => type.toLowerCase() === input.trim().toLowerCase()) ?? null;
}

export async function handleUpdateTaskModal(interaction: ModalSubmitInteraction, services: ServiceContainer) {
    await interaction.deferReply({ flags: 1 << 6 });

    const repo = services.repos.taskRepo;

    const taskId = interaction.customId.replace('update_task_modal_', '');
    const task = await repo.getTaskById(taskId);
    if (!task) {
        await interaction.editReply({ content: `Could not find task with ID **${taskId}**.` });
        return;
    }

    const type = parseTaskType(interaction.fields.getTextInputValue('type'));
    if (!type) {
        await interaction.editReply({ content: `Type must be one of: ${Object.values(TaskType).join(', ')}. Nothing was changed.` });
        return;
    }

    const amounts = {
        bronze: parseAmount(interaction.fields.getTextInputValue('bronze')),
        silver: parseAmount(interaction.fields.getTextInputValue('silver')),
        gold: parseAmount(interaction.fields.getTextInputValue('gold')),
    };
    const invalid = Object.entries(amounts).filter(([, amount]) => amount === null).map(([tier]) => tier);
    if (invalid.length) {
        await interaction.editReply({ content: `The ${invalid.join(', ')} amount must be a whole number. Nothing was changed.` });
        return;
    }

    task.taskName = interaction.fields.getTextInputValue('taskName');
    task.type = type;
    task.amtBronze = amounts.bronze!;
    task.amtSilver = amounts.silver!;
    task.amtGold = amounts.gold!;

    try {
        await saveAndRedraw(interaction, repo, task);
    } catch (err) {
        console.error(`[HandleUpdateTaskModal] Failed to save task ${taskId}:`, err);
        await interaction.editReply({ content: `Couldn't save task **${taskId}**. Please try again.` });
        return;
    }

    await interaction.editReply({ content: `Task **${taskId}** updated successfully.` });
}

async function saveAndRedraw(interaction: ModalSubmitInteraction, repo: ITaskRepository, task: Task): Promise<void> {
    await repo.createTask(task);

    const now = new Date();
    const activeEvents = (await repo.getTaskEventsBetween(now, new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)))
        .filter(event => event.task.id === task.id && event.startTime <= now);

    for (const activeEvent of activeEvents) {
        activeEvent.task = task;
        activeEvent.amounts = {
            bronze: task.amtBronze,
            silver: task.amtSilver,
            gold: task.amtGold,
        }
        await repo.updateTaskEventTask(activeEvent.id, activeEvent.task, activeEvent.amounts);

        try {
            await refreshTaskEventMessage(interaction.client, activeEvent);
        } catch (err) {
            console.error('[HandleUpdateTaskModal] Failed to update active task event embed:', err);
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
            console.error('[HandleUpdateTaskModal] Failed to refresh active task poll embed:', err);
        }
    }
}
