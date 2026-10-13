import { ApplicationCommandOptionType, InteractionResponseType, MessageFlags } from "discord-api-types/v10";
import { describe, expect, vi, type StoringFactories, test } from "../fixtures.js";
import { componentsIn, PRIVATE_DEFERRAL } from "../discord/harness.js";
import {
    apiMessage,
    buttonInteraction,
    chatInputInteraction,
    AS,
    apiAttachment,
    IDS,
    modalSubmitInteraction,
} from "../discord/payloads.js";
import { TaskCategory, TaskType } from "../../src/models/Task.js";
import { SnowflakeUtil } from "discord.js";
import { DateTime } from "luxon";
import { taskFactory } from "../factories.js";
import { SubmissionStatus } from "../../src/models/TaskSubmission.js";

const CSV = [
    "ID,Task Name,Category,Type,Skill,Bronze Amount,Silver Amount,Gold Amount,Weight,Short Name,Wilderness Required?",
    "PVM001,Kill {amount} Zulrah,PvM,KC,,10,25,50,,Zulrah,TRUE",
    "PVM002,Kill {amount} Vorkath,PvM,KC,,5,10,20,,Vorkath,FALSE",
].join("\n");

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

describe("/listtasks", () => {
    test("pages through a category's tasks with buttons that keep working", async ({
        discord,
        interact,
        factories,
    }) => {
        for (let number = 1; number <= 9; number++) {
            await factories.task.create({ id: `MIN00${number}`, category: TaskCategory.MinigameMisc });
        }
        await factories.task.create({ id: "PVM001", category: TaskCategory.PvM });

        const command = await interact(
            chatInputInteraction("listtasks", [
                { type: ApplicationCommandOptionType.String, name: "category", value: TaskCategory.MinigameMisc },
            ]),
        );
        const [firstPage] = discord.originalEdits(command);
        const next = await interact(
            buttonInteraction("listtasks|Minigame/Misc|next|1", apiMessage({ flags: MessageFlags.Ephemeral })),
        );

        expect(firstPage?.embeds?.[0]).toMatchObject({
            title: "📋 Task List - Minigame/Misc",
            footer: { text: "Page 1/2 • 9 tasks" },
        });
        expect(firstPage?.embeds?.[0]?.description).toContain("MIN008");
        expect(firstPage?.embeds?.[0]?.description).not.toContain("MIN009");
        expect(componentsIn(firstPage?.components).map((button) => button.customId)).toEqual([
            "listtasks|Minigame/Misc|start|0",
            "listtasks|Minigame/Misc|prev|-1",
            "listtasks|Minigame/Misc|next|1",
            "listtasks|Minigame/Misc|end|1",
        ]);
        expect(discord.callbacks(next)).toEqual([{ type: InteractionResponseType.DeferredMessageUpdate }]);
        const [secondPage] = discord.originalEdits(next);
        expect(secondPage?.embeds?.[0]).toMatchObject({ footer: { text: "Page 2/2 • 9 tasks" } });
        expect(secondPage?.embeds?.[0]?.description).toContain("MIN009");
        expect(secondPage?.embeds?.[0]?.description).not.toContain("MIN008");
        expect(
            componentsIn(secondPage?.components).find((button) => button.customId === "listtasks|Minigame/Misc|end|1"),
        ).toMatchObject({ disabled: true });
    });

    test("shows every category on one page without buttons when the tasks fit", async ({
        discord,
        interact,
        factories,
    }) => {
        await factories.task.create({ id: "PVM001", category: TaskCategory.PvM });
        await factories.task.create({ id: "SKL001", category: TaskCategory.Skilling });

        const command = await interact(chatInputInteraction("listtasks"));

        const [page] = discord.originalEdits(command);
        expect(page).toMatchObject({
            embeds: [{ title: "📋 Task List - All Categories", footer: { text: "Page 1/1 • 2 tasks" } }],
            components: [],
        });
    });

    test("says so when a category has no tasks", async ({ discord, interact, factories }) => {
        await factories.task.create({ id: "PVM001", category: TaskCategory.PvM });

        const command = await interact(
            chatInputInteraction("listtasks", [
                { type: ApplicationCommandOptionType.String, name: "category", value: TaskCategory.Leagues },
            ]),
        );

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "No tasks were found for **Leagues**." }),
        ]);
    });

    test("shows every category for a page button whose category it doesn't know", async ({
        discord,
        interact,
        factories,
    }) => {
        await factories.task.create({ id: "PVM001", category: TaskCategory.PvM });
        await factories.task.create({ id: "SKL001", category: TaskCategory.Skilling });

        const press = await interact(
            buttonInteraction("listtasks|Raids|start|0", apiMessage({ flags: MessageFlags.Ephemeral })),
        );

        expect(discord.originalEdits(press)).toEqual([
            expect.objectContaining({
                embeds: [expect.objectContaining({ title: "📋 Task List - All Categories" })],
            }),
        ]);
    });
});

describe("/viewtask", () => {
    test("shows the task found by its id, with its tier amounts", async ({ discord, interact, factories }) => {
        const task = await factories.task.create({
            id: "PVM007",
            taskName: "Kill {amount} Vorkath",
            category: TaskCategory.PvM,
            amtBronze: 5,
            amtSilver: 10,
            amtGold: 20,
        });

        const command = await interact(
            chatInputInteraction("viewtask", [
                { type: ApplicationCommandOptionType.String, name: "search", value: task.id },
            ]),
        );

        const [reply] = discord.originalEdits(command);
        expect(reply?.embeds?.[0]).toMatchObject({ title: "PvM Task", footer: { text: task.id } });
        expect(reply?.embeds?.[0]?.description).toContain("**Kill {amount} Vorkath**");
        expect(reply?.embeds?.[0]?.description).toContain("🥉 **5** 🥈 **10** 🥇 **20**");
    });

    test("finds a task by a misspelt name", async ({ discord, interact, factories }) => {
        await factories.task.create({ id: "PVM001", taskName: "Kill {amount} Zulrah" });
        const vorkath = await factories.task.create({ id: "PVM002", taskName: "Kill {amount} Vorkath" });

        const command = await interact(
            chatInputInteraction("viewtask", [
                { type: ApplicationCommandOptionType.String, name: "search", value: "vorkth" },
            ]),
        );

        expect(discord.originalEdits(command)[0]?.embeds?.[0]?.footer?.text).toBe(vorkath.id);
    });

    test("says so when nothing matches", async ({ discord, interact, factories }) => {
        await factories.task.create({ id: "PVM001", taskName: "Kill {amount} Zulrah" });

        const command = await interact(
            chatInputInteraction("viewtask", [
                { type: ApplicationCommandOptionType.String, name: "search", value: "Tempoross" },
            ]),
        );

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "No task found matching `Tempoross`." }),
        ]);
    });

    test("says so when no tasks are stored", async ({ discord, interact }) => {
        const command = await interact(
            chatInputInteraction("viewtask", [
                { type: ApplicationCommandOptionType.String, name: "search", value: "PVM001" },
            ]),
        );

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "No tasks were found in the database." }),
        ]);
    });
});

describe("/importtasks", () => {
    test("adds the tasks in the uploaded file that aren't stored yet, leaving stored ones untouched", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        const tasks = services.repos.taskRepo;
        await factories.task.create({ id: "PVM001", taskName: "Already stored" });
        const attachment = apiAttachment({ filename: "tasks.csv", size: CSV.length, content_type: "text/csv" });
        discord.serveAttachment(attachment, Buffer.from(CSV));

        const interaction = await interact(
            chatInputInteraction(
                "importtasks",
                [{ type: ApplicationCommandOptionType.Attachment, name: "file", value: attachment.id }],
                AS.botAdmin,
                { attachments: { [attachment.id]: attachment } },
            ),
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({
                content: "✅ Import complete.\n• 1 new tasks added\n• 1 skipped (existing)\n• 2 total in file.",
            }),
        ]);
        expect(await tasks.getTaskById("PVM001")).toMatchObject({ taskName: "Already stored" });
        expect(await tasks.getTaskById("PVM002")).toMatchObject({ taskName: "Kill {amount} Vorkath", amtGold: 20 });
    });

    test("refuses a file that isn't a CSV", async ({ discord, interact }) => {
        const attachment = apiAttachment({ filename: "tasks.xlsx", size: CSV.length, content_type: "text/csv" });

        const interaction = await interact(
            chatInputInteraction(
                "importtasks",
                [{ type: ApplicationCommandOptionType.Attachment, name: "file", value: attachment.id }],
                AS.botAdmin,
                { attachments: { [attachment.id]: attachment } },
            ),
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Please upload a valid CSV file." }),
        ]);
    });

    test("reports a failed download", async ({ discord, interact, http }) => {
        const attachment = apiAttachment({ filename: "tasks.csv", size: CSV.length, content_type: "text/csv" });
        http.get("https://cdn.discordapp.com")
            .intercept({ path: new URL(attachment.url).pathname, method: "GET" })
            .reply(404, "Not Found");
        const error = vi.spyOn(console, "error").mockImplementation(() => {});

        const interaction = await interact(
            chatInputInteraction(
                "importtasks",
                [{ type: ApplicationCommandOptionType.Attachment, name: "file", value: attachment.id }],
                AS.botAdmin,
                { attachments: { [attachment.id]: attachment } },
            ),
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Import failed. Check logs for details." }),
        ]);
        expect(error).toHaveBeenCalledWith(new Error("Failed to download tasks.csv: HTTP 404"));
    });
});

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
        interact,
        factories,
    }) => {
        await factories.task.create({
            id: "PVM001",
            taskName: "Kill {amount} Zulrah",
            amtBronze: 10,
            amtSilver: 25,
            amtGold: 50,
        });

        const interaction = await interact(
            chatInputInteraction(
                "updatetask",
                [{ type: ApplicationCommandOptionType.String, name: "id", value: "PVM001" }],
                AS.taskAdmin,
            ),
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

    test("replies privately when the task does not exist", async ({ discord, interact }) => {
        const interaction = await interact(
            chatInputInteraction(
                "updatetask",
                [{ type: ApplicationCommandOptionType.String, name: "id", value: "NOPE" }],
                AS.taskAdmin,
            ),
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

describe("TaskRepository tasks", () => {
    test("seeds more tasks than fit in one Firestore batch", async ({ services }) => {
        const tasks = Array.from({ length: 501 }, (_, index) => taskFactory.build({ id: `TASK${index}` }));

        await services.repos.taskRepo.seedTasks(tasks);

        expect(await services.repos.taskRepo.getAllTasks()).toHaveLength(501);
    });
});
