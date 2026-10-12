import { ApplicationCommandOptionType, InteractionResponseType, MessageFlags } from "discord-api-types/v10";
import { SnowflakeUtil } from "discord.js";
import { DateTime } from "luxon";
import { describe, expect, test, type StoringFactories } from "../../../fixtures.js";
import { PRIVATE_DEFERRAL } from "../../../discord/harness.js";
import { AS, IDS, apiMessage, modalSubmitInteraction } from "../../../discord/payloads.js";
import { taskFactory } from "../../../factories.js";
import { SubmissionStatus } from "../../../../src/models/TaskSubmission.js";
import { TaskCategory, TaskType } from "../../../../src/models/Task.js";

const eventMessage = SnowflakeUtil.generate().toString();
const pollMessage = SnowflakeUtil.generate().toString();
const completer = SnowflakeUtil.generate().toString();
const voter = SnowflakeUtil.generate().toString();
const form = { taskName: "Kill {amount} Vorkath", type: "kc", bronze: "5", silver: "10", gold: "150,000" };

async function storeRunningEvent(factories: StoringFactories, overrides = {}) {
    const task = await factories.task.create({
        id: "PVM001",
        category: TaskCategory.PvM,
        taskName: "Kill {amount} Zulrah",
    });
    return factories.taskEvent.running().create({
        id: "PVM001-week",
        task,
        messageId: eventMessage,
        channelId: IDS.channel,
        ...overrides,
    });
}

describe("the update task form", () => {
    test("saves the task and redraws its running event and open poll, keeping their completions and votes", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        const tasks = services.repos.taskRepo;
        await storeRunningEvent(factories);
        // A completion approved after the event was posted
        await factories.taskSubmission.create({ id: "approved", userId: completer, taskEventId: "PVM001-week" });
        await tasks.reviewSubmission({
            submissionId: "approved",
            reviewedBy: IDS.user,
            decision: SubmissionStatus.Bronze,
        });
        await factories.taskPoll.create({
            id: pollMessage,
            messageId: pollMessage,
            category: TaskCategory.PvM,
            options: [taskFactory.build({ id: "PVM001" }), taskFactory.build({ id: "PVM002" })],
            votes: { [voter]: "PVM001" },
            endsAt: DateTime.now().plus({ hours: 1 }).toJSDate(),
        });
        for (const id of [eventMessage, pollMessage]) discord.message(apiMessage({ id }));
        discord.acceptMessageEdits(IDS.channel);

        const submit = await interact(modalSubmitInteraction("update_task_modal_PVM001", form));

        expect(discord.callbacks(submit)).toEqual([PRIVATE_DEFERRAL]);
        expect(discord.originalEdits(submit)).toEqual([
            expect.objectContaining({ content: "Task **PVM001** updated successfully." }),
        ]);
        expect(await tasks.getTaskById("PVM001")).toMatchObject({
            taskName: "Kill {amount} Vorkath",
            type: TaskType.KC,
            amtBronze: 5,
            amtSilver: 10,
            amtGold: 150000,
        });
        expect(await tasks.getTaskEventById("PVM001-week")).toMatchObject({
            task: { taskName: "Kill {amount} Vorkath" },
            amounts: { bronze: 5, silver: 10, gold: 150000 },
            completionCounts: { bronze: 1, silver: 0, gold: 0 },
            completedUserIds: [completer],
        });
        expect(await tasks.getTaskPollById(pollMessage)).toMatchObject({
            votes: { [voter]: "PVM001" },
            options: [{ id: "PVM001", taskName: "Kill {amount} Vorkath" }, { id: "PVM002" }],
        });
        expect(discord.messageEdits(IDS.channel, eventMessage)).toHaveLength(1);
        expect(discord.messageEdits(IDS.channel, pollMessage)).toHaveLength(1);
    });

    test("leaves an event that hasn't started yet alone", async ({ discord, interact, services, factories }) => {
        await storeRunningEvent(factories, {
            startTime: DateTime.now().plus({ days: 1 }).toJSDate(),
            endTime: DateTime.now().plus({ days: 8 }).toJSDate(),
        });

        const submit = await interact(modalSubmitInteraction("update_task_modal_PVM001", form));

        expect(discord.originalEdits(submit)).toEqual([
            expect.objectContaining({ content: "Task **PVM001** updated successfully." }),
        ]);
        expect(await services.repos.taskRepo.getTaskEventById("PVM001-week")).toMatchObject({
            task: { taskName: "Kill {amount} Zulrah" },
        });
    });

    test("changes nothing when the type isn't one the bot knows", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        await storeRunningEvent(factories);

        const submit = await interact(modalSubmitInteraction("update_task_modal_PVM001", { ...form, type: "Kills" }));

        expect(discord.originalEdits(submit)).toEqual([
            expect.objectContaining({
                content: "Type must be one of: XP, KC, Drop, Inventory, Points, Materials, Other. Nothing was changed.",
            }),
        ]);
        expect(await services.repos.taskRepo.getTaskById("PVM001")).toMatchObject({ taskName: "Kill {amount} Zulrah" });
    });

    test("changes nothing when an amount isn't a whole number", async ({ discord, interact, services, factories }) => {
        await storeRunningEvent(factories);

        const submit = await interact(
            modalSubmitInteraction("update_task_modal_PVM001", { ...form, silver: "lots", gold: "1.5" }),
        );

        expect(discord.originalEdits(submit)).toEqual([
            expect.objectContaining({
                content: "The silver, gold amount must be a whole number. Nothing was changed.",
            }),
        ]);
        expect(await services.repos.taskRepo.getTaskById("PVM001")).toMatchObject({
            amtGold: taskFactory.build().amtGold,
        });
    });

    test("answers when the task no longer exists", async ({ discord, interact }) => {
        const submit = await interact(modalSubmitInteraction("update_task_modal_PVM404", form));

        expect(discord.originalEdits(submit)).toEqual([
            expect.objectContaining({ content: "Could not find task with ID **PVM404**." }),
        ]);
    });
});

describe("/updatetask", () => {
    test("opens the edit form pre-filled from the stored task as its first response", async ({
        discord,
        slash,
        factories,
    }) => {
        await factories.task.create({
            id: "PVM001",
            taskName: "Kill {amount} Zulrah",
            amtBronze: 10,
            amtSilver: 25,
            amtGold: 50,
        });

        const interaction = await slash(
            "updatetask",
            [{ type: ApplicationCommandOptionType.String, name: "id", value: "PVM001" }],
            AS.taskAdmin,
        );

        expect(discord.callbacks(interaction)).toHaveLength(1);
        const modal = discord.modal(interaction);
        expect(modal?.custom_id).toBe("update_task_modal_PVM001");
        const values = modal?.components
            .flatMap((row) => ("components" in row ? row.components : []))
            .map((input) => ["custom_id" in input ? input.custom_id : "", "value" in input ? input.value : ""]);
        expect(Object.fromEntries(values ?? [])).toEqual({
            taskName: "Kill {amount} Zulrah",
            type: "KC",
            bronze: "10",
            silver: "25",
            gold: "50",
        });
    });

    test("replies privately when the task does not exist", async ({ discord, slash }) => {
        const interaction = await slash(
            "updatetask",
            [{ type: ApplicationCommandOptionType.String, name: "id", value: "NOPE" }],
            AS.taskAdmin,
        );

        expect(discord.callbacks(interaction)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({
                    content: "No task found with ID **NOPE**.",
                    flags: MessageFlags.Ephemeral,
                }),
            },
        ]);
    });
});
