import { ButtonInteraction } from "discord.js";
import type { TaskFeedbackOutcome } from "../../models/TaskFeedback.js";
import type { ITaskRepository } from "../../core/database/interfaces/ITaskRepo.js";

export async function handleTaskFeedback(interaction: ButtonInteraction, repo: ITaskRepository) {
    await interaction.deferReply({ flags: 1 << 6 });

    try {
        const customId = interaction.customId;
        let direction: string | undefined;
        let taskId: string | undefined;
        let eventId: string | undefined;

        if (customId.includes("|")) {
            // New format: task-feedback|up|taskId|eventId
            const [prefix, parsedDirection, parsedTaskId, parsedEventId] = customId.split("|");
            if (prefix !== "task-feedback") {
                await interaction.editReply({ content: "Invalid feedback action." });
                return;
            }
            direction = parsedDirection;
            taskId = parsedTaskId;
            eventId = parsedEventId;
        } else {
            // Legacy format: task-feedback-up-${taskId}-${eventId}
            const parts = customId.split("-");
            if (parts.length < 5 || parts[0] !== "task" || parts[1] !== "feedback") {
                await interaction.editReply({ content: "Invalid feedback action." });
                return;
            }
            direction = parts[2];
            taskId = parts[3];
            const eventSuffix = parts.slice(4).join("-");
            if (!eventSuffix) {
                eventId = taskId;
            } else if (eventSuffix.startsWith(`${taskId}-`)) {
                // Some legacy buttons already embed the task id in the suffix.
                eventId = eventSuffix;
            } else {
                eventId = `${taskId}-${eventSuffix}`;
            }
        }

        if (!taskId || !eventId) {
            await interaction.editReply({ content: "Invalid task or event ID." });
            return;
        }

        if (direction !== "up" && direction !== "down") {
            await interaction.editReply({ content: "Unknown feedback type." });
            return;
        }

        const outcome = await repo.recordFeedback({ taskId, eventId, userId: interaction.user.id, vote: direction });
        const replies: Record<TaskFeedbackOutcome, string> = {
            added: "Thanks for your feedback!",
            changed: "Feedback updated!",
            unchanged: `You already gave this task a ${direction === "up" ? "👍" : "👎"}.`,
            taskNotFound: "Task not found.",
        };
        await interaction.editReply({ content: replies[outcome] });
    } catch (err) {
        console.error("[TaskFeedback] Failed to record feedback:", err);
        await interaction.editReply({ content: "Couldn't record your feedback. Please try again." });
    }
}
