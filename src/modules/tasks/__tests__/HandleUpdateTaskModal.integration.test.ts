import { describe, expect, test } from "../../../tests/fixtures.js";
import { PRIVATE_DEFERRAL } from "../../../tests/discord/harness.js";
import type { ServiceContainer } from "../../../core/services/ServiceContainer.js";
import { IDS, apiMessage, modalSubmitInteraction } from "../../../tests/discord/payloads.js";
import { buildTask, buildTaskEvent, buildTaskPoll, buildTaskSubmission } from "../../../tests/fakes/builders.js";
import { SubmissionStatus } from "../../../models/TaskSubmission.js";
import { TaskCategory, TaskType } from "../../../models/Task.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const eventMessage = "100000000000000600";
const pollMessage = "100000000000000601";
const form = { taskName: "Kill {amount} Vorkath", type: "kc", bronze: "5", silver: "10", gold: "150,000" };

async function storeRunningEvent(services: ServiceContainer, overrides = {}) {
    const task = buildTask({ id: "PVM001", category: TaskCategory.PvM, taskName: "Kill {amount} Zulrah" });
    await services.repos.taskRepo.createTask(task);
    const event = buildTaskEvent({
        id: "PVM001-week", task, startTime: new Date(Date.now() - DAY), endTime: new Date(Date.now() + 6 * DAY),
        messageId: eventMessage, channelId: IDS.channel, ...overrides,
    });
    await services.repos.taskRepo.createTaskEvent(event);
    return event;
}

describe("the update task form", () => {
    test("saves the task and redraws its running event and open poll, keeping their completions and votes", async ({ discord, interact, services }) => {
        const tasks = services.repos.taskRepo;
        await storeRunningEvent(services);
        // A completion approved after the event was posted
        await tasks.createSubmission(buildTaskSubmission({ id: "approved", userId: "100000000000000031", taskEventId: "PVM001-week" }));
        await tasks.reviewSubmission({ submissionId: "approved", reviewedBy: IDS.user, decision: SubmissionStatus.Bronze });
        await tasks.createTaskPoll(buildTaskPoll({
            id: pollMessage, messageId: pollMessage, category: TaskCategory.PvM, options: [buildTask({ id: "PVM001" }), buildTask({ id: "PVM002" })],
            votes: { "100000000000000032": "PVM001" }, endsAt: new Date(Date.now() + HOUR),
        }));
        for (const id of [eventMessage, pollMessage]) discord.message(apiMessage({ id }));
        discord.acceptMessageEdits(IDS.channel);

        const submit = await interact(modalSubmitInteraction("update_task_modal_PVM001", form));

        expect(discord.callbacks(submit)).toEqual([PRIVATE_DEFERRAL]);
        expect(discord.originalEdits(submit)).toEqual([expect.objectContaining({ content: "Task **PVM001** updated successfully." })]);
        expect(await tasks.getTaskById("PVM001")).toMatchObject({ taskName: "Kill {amount} Vorkath", type: TaskType.KC, amtBronze: 5, amtSilver: 10, amtGold: 150000 });
        expect(await tasks.getTaskEventById("PVM001-week")).toMatchObject({
            task: { taskName: "Kill {amount} Vorkath" }, amounts: { bronze: 5, silver: 10, gold: 150000 },
            completionCounts: { bronze: 1, silver: 0, gold: 0 }, completedUserIds: ["100000000000000031"],
        });
        expect(await tasks.getTaskPollById(pollMessage)).toMatchObject({ votes: { "100000000000000032": "PVM001" }, options: [{ id: "PVM001", taskName: "Kill {amount} Vorkath" }, { id: "PVM002" }] });
        expect(discord.messageEdits(IDS.channel, eventMessage)).toHaveLength(1);
        expect(discord.messageEdits(IDS.channel, pollMessage)).toHaveLength(1);
    });

    test("leaves an event that hasn't started yet alone", async ({ discord, interact, services }) => {
        await storeRunningEvent(services, { startTime: new Date(Date.now() + DAY), endTime: new Date(Date.now() + 8 * DAY) });

        const submit = await interact(modalSubmitInteraction("update_task_modal_PVM001", form));

        expect(discord.originalEdits(submit)).toEqual([expect.objectContaining({ content: "Task **PVM001** updated successfully." })]);
        expect(await services.repos.taskRepo.getTaskEventById("PVM001-week")).toMatchObject({ task: { taskName: "Kill {amount} Zulrah" } });
    });

    test("changes nothing when the type isn't one the bot knows", async ({ discord, interact, services }) => {
        await storeRunningEvent(services);

        const submit = await interact(modalSubmitInteraction("update_task_modal_PVM001", { ...form, type: "Kills" }));

        expect(discord.originalEdits(submit)).toEqual([expect.objectContaining({
            content: "Type must be one of: XP, KC, Drop, Inventory, Points, Materials, Other. Nothing was changed.",
        })]);
        expect(await services.repos.taskRepo.getTaskById("PVM001")).toMatchObject({ taskName: "Kill {amount} Zulrah" });
    });

    test("changes nothing when an amount isn't a whole number", async ({ discord, interact, services }) => {
        await storeRunningEvent(services);

        const submit = await interact(modalSubmitInteraction("update_task_modal_PVM001", { ...form, silver: "lots", gold: "1.5" }));

        expect(discord.originalEdits(submit)).toEqual([expect.objectContaining({ content: "The silver, gold amount must be a whole number. Nothing was changed." })]);
        expect(await services.repos.taskRepo.getTaskById("PVM001")).toMatchObject({ amtGold: buildTask().amtGold });
    });

    test("answers when the task no longer exists", async ({ discord, interact }) => {
        const submit = await interact(modalSubmitInteraction("update_task_modal_PVM404", form));

        expect(discord.originalEdits(submit)).toEqual([expect.objectContaining({ content: "Could not find task with ID **PVM404**." })]);
    });
});
