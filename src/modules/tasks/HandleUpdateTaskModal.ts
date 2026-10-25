import { MessageFlags, type ModalSubmitInteraction } from "discord.js";
import { DateTime } from "luxon";
import { TaskType, type Task } from "../../models/Task.js";
import type { ServiceContainer } from "../../core/services/ServiceContainer.js";
import { refreshTaskPollMessage } from "./HandleTaskPoll.js";
import { refreshTaskEventMessage } from "./HandleTaskStart.js";
import { AMOUNTS_ERROR, parseAmounts } from "./TaskForm.js";

function parseTaskType(input: string): TaskType | null {
    return Object.values(TaskType).find((type) => type.toLowerCase() === input.trim().toLowerCase()) ?? null;
}

export async function handleUpdateTaskModal(interaction: ModalSubmitInteraction, services: ServiceContainer) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const repo = services.repos.taskRepo;

    const taskId = interaction.customId.replace("update_task_modal_", "");
    const task = await repo.getTaskById(taskId);
    if (!task) {
        await interaction.editReply({ content: `Could not find task with ID **${taskId}**.` });
        return;
    }

    const type = parseTaskType(interaction.fields.getTextInputValue("type"));
    if (!type) {
        await interaction.editReply({
            content: `Type must be one of: ${Object.values(TaskType).join(", ")}. Nothing was changed.`,
        });
        return;
    }

    const amounts = parseAmounts(interaction.fields.getTextInputValue("amounts"));
    if (!amounts) {
        await interaction.editReply({ content: `${AMOUNTS_ERROR} Nothing was changed.` });
        return;
    }

    const updated: Task = {
        ...task,
        ...amounts,
        taskName: interaction.fields.getTextInputValue("taskName").trim(),
        shortName: interaction.fields.getTextInputValue("shortName").trim(),
        type,
    };

    try {
        await saveAndRedraw(interaction, services, updated);
    } catch (err) {
        console.error(`[HandleUpdateTaskModal] Failed to save task ${taskId}:`, err);
        await interaction.editReply({ content: `Couldn't save task **${taskId}**. Please try again.` });
        return;
    }

    await interaction.editReply({ content: `Task **${taskId}** updated successfully.` });
}

async function saveAndRedraw(
    interaction: ModalSubmitInteraction,
    services: ServiceContainer,
    task: Task,
): Promise<void> {
    const repo = services.repos.taskRepo;
    await services.tasks.createTask(task);

    const now = new Date();
    const activeEvents = (
        await repo.getTaskEventsBetween(now, DateTime.fromJSDate(now).plus({ days: 30 }).toJSDate())
    ).filter((event) => event.task.id === task.id && event.startTime <= now);

    for (const activeEvent of activeEvents) {
        activeEvent.task = task;
        activeEvent.amounts = {
            bronze: task.amtBronze,
            silver: task.amtSilver,
            gold: task.amtGold,
        };
        await repo.updateTaskEventTask(activeEvent.id, activeEvent.task, activeEvent.amounts);

        try {
            await refreshTaskEventMessage(interaction.client, activeEvent);
        } catch (err) {
            console.error("[HandleUpdateTaskModal] Failed to update active task event embed:", err);
        }
    }

    const activePoll = await repo.getActiveTaskPollByCategory(task.category);
    if (activePoll?.options.some((option) => option.id === task.id)) {
        activePoll.options = activePoll.options.map((option) =>
            option.id === task.id ? { ...option, ...task } : option,
        );
        await repo.updateTaskPollOptions(activePoll.id, activePoll.options);
        try {
            await refreshTaskPollMessage(interaction.client, activePoll);
        } catch (err) {
            console.error("[HandleUpdateTaskModal] Failed to refresh active task poll embed:", err);
        }
    }
}
