import { ApplicationCommandOptionType, ChannelType, InteractionContextType, InteractionResponseType, MessageFlags, type APIApplicationCommandAutocompleteDMInteraction, type APIApplicationCommandInteractionDataOption } from "discord-api-types/v10";
import { describe, expect, vi, type StoringFactories, test } from "../fixtures.js";
import { componentsIn, PRIVATE_DEFERRAL } from "../discord/harness.js";
import {
    apiMessage,
    apiUser,
    autocompleteInteraction,
    buttonInteraction,
    chatInputInteraction,
    AS,
    apiAttachment,
    IDS,
    modalSubmitInteraction,
} from "../discord/payloads.js";
import { Skill, TaskCategory, TaskType } from "../../src/models/Task.js";
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
const form = { taskName: "Kill {amount} Vorkath", shortName: "Vorkath", type: "kc", amounts: "5, 10/150000" };

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
        for (let number = 1; number <= 26; number++) {
            await factories.task.create({ id: `MIN${String(number).padStart(3, "0")}`, category: TaskCategory.MinigameMisc });
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
            footer: { text: "Page 1/2 • 26 tasks" },
        });
        expect(firstPage?.embeds?.[0]?.description).toContain("MIN025");
        expect(firstPage?.embeds?.[0]?.description).not.toContain("MIN026");
        expect(componentsIn(firstPage?.components).map((button) => button.customId)).toEqual([
            "listtasks|Minigame/Misc|start|0",
            "listtasks|Minigame/Misc|prev|-1",
            "listtasks|Minigame/Misc|next|1",
            "listtasks|Minigame/Misc|end|1",
        ]);
        expect(discord.callbacks(next)).toEqual([{ type: InteractionResponseType.DeferredMessageUpdate }]);
        const [secondPage] = discord.originalEdits(next);
        expect(secondPage?.embeds?.[0]).toMatchObject({ footer: { text: "Page 2/2 • 26 tasks" } });
        expect(secondPage?.embeds?.[0]?.description).toContain("MIN026");
        expect(secondPage?.embeds?.[0]?.description).not.toContain("MIN025");
        expect(
            componentsIn(secondPage?.components).find((button) => button.customId === "listtasks|Minigame/Misc|end|1"),
        ).toMatchObject({ disabled: true });
    });

    test("shows every category on one page without buttons when the tasks fit, in aligned columns", async ({
        discord,
        interact,
        factories,
    }) => {
        await factories.task.create({
            id: "PVM001",
            category: TaskCategory.PvM,
            shortName: "Zulrah",
            amtBronze: 10,
            amtSilver: 25,
            amtGold: 150,
        });
        await factories.task.create({
            id: "SKL001",
            category: TaskCategory.Skilling,
            taskName: "Chop {amount} logs at the Woodcutting Guild in Hosidius",
            amtBronze: 1000000,
            amtSilver: 2,
            amtGold: 3,
        });

        const command = await interact(chatInputInteraction("listtasks"));

        const [page] = discord.originalEdits(command);
        expect(page).toMatchObject({
            embeds: [
                {
                    title: "📋 Task List - All Categories",
                    description: [
                        "```",
                        "ID      Task Name                                       B   S    G",
                        "PVM001  Zulrah                                         10  25  150",
                        "SKL001  Chop {amount} logs at the Woodcutting...  1000000   2    3",
                        "```",
                    ].join("\n"),
                    footer: { text: "Page 1/1 • 2 tasks" },
                },
            ],
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
            shortName: "Vorkath",
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

    test("changes nothing when the amounts aren't three whole numbers", async ({ discord, interact, services, factories }) => {
        await storeRunningEvent(factories);

        const submit = await interact(
            modalSubmitInteraction("update_task_modal_PVM001", { ...form, amounts: "5, lots, 1.5" }),
        );

        expect(discord.originalEdits(submit)).toEqual([
            expect.objectContaining({
                content: "The amounts must be three whole numbers for bronze, silver and gold, e.g. 5, 10, 20. Nothing was changed.",
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
            shortName: "Zulrah",
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
            .flatMap((label) => ("component" in label ? [label.component] : []))
            .map((input) => ["custom_id" in input ? input.custom_id : "", "value" in input ? input.value : ""]);
        expect(Object.fromEntries(values ?? [])).toEqual({
            taskName: "Kill {amount} Zulrah",
            shortName: "Zulrah",
            type: "KC",
            amounts: "10, 25, 50",
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

    test("suggests tasks matching what the member types, each filling in its ID", async ({ discord, interact, factories }) => {
        await factories.task.create({ id: "PVM001", taskName: "Kill {amount} Zulrah", shortName: "Zulrah" });
        await factories.task.create({ id: "PVM002", taskName: "Kill {amount} Vorkath", shortName: "Vorkath" });

        const typing = await interact(
            autocompleteInteraction("updatetask", [
                { type: ApplicationCommandOptionType.String, name: "id", value: "vorkth", focused: true },
            ]),
        );

        expect(discord.callbacks(typing)).toEqual([
            {
                type: InteractionResponseType.ApplicationCommandAutocompleteResult,
                data: { choices: [{ name: "PVM002 · Kill {amount} Vorkath", value: "PVM002" }] },
            },
        ]);
    });

    test("suggests the first tasks before anything is typed", async ({ discord, interact, factories }) => {
        await factories.task.create({ id: "PVM001", taskName: "Kill {amount} Zulrah" });
        await factories.task.create({ id: "PVM002", taskName: "Kill {amount} Vorkath" });

        const typing = await interact(
            autocompleteInteraction("updatetask", [
                { type: ApplicationCommandOptionType.String, name: "id", value: " ", focused: true },
            ]),
        );

        expect(discord.callbacks(typing)).toEqual([
            {
                type: InteractionResponseType.ApplicationCommandAutocompleteResult,
                data: {
                    choices: [
                        { name: "PVM001 · Kill {amount} Zulrah", value: "PVM001" },
                        { name: "PVM002 · Kill {amount} Vorkath", value: "PVM002" },
                    ],
                },
            },
        ]);
    });

    test("suggests nothing in DMs, where the command doesn't run", async ({ discord, interact, factories }) => {
        await factories.task.create({ id: "PVM001" });
        const { guild_id: _guildId, member: _member, ...typing } = autocompleteInteraction("updatetask", [
            { type: ApplicationCommandOptionType.String, name: "id", value: "zulrah", focused: true },
        ]);
        const inDm: APIApplicationCommandAutocompleteDMInteraction = {
            ...typing,
            context: InteractionContextType.BotDM,
            user: apiUser(),
            channel: { id: IDS.dm, type: ChannelType.DM },
            channel_id: IDS.dm,
        };

        const interaction = await interact(inDm);

        expect(discord.callbacks(interaction)).toEqual([
            { type: InteractionResponseType.ApplicationCommandAutocompleteResult, data: { choices: [] } },
        ]);
    });
});

describe("/newtask", () => {
    const options = (category: TaskCategory, type: TaskType): APIApplicationCommandInteractionDataOption[] => [
        { type: ApplicationCommandOptionType.String, name: "category", value: category },
        { type: ApplicationCommandOptionType.String, name: "type", value: type },
    ];
    const form = { taskName: "Kill Vorkath", shortName: "Vorkath", amounts: "5 / 10 / 1000", id: "" };

    test("opens the form as its first response, offering one past the category's highest ID", async ({
        discord,
        interact,
        factories,
    }) => {
        await factories.task.create({ id: "PVM063", category: TaskCategory.PvM });

        const command = await interact(chatInputInteraction("newtask", [
            ...options(TaskCategory.PvM, TaskType.KC),
            { type: ApplicationCommandOptionType.String, name: "skill", value: Skill.Slayer },
        ], AS.taskAdmin));

        expect(discord.callbacks(command)).toHaveLength(1);
        const modal = discord.modal(command);
        expect(modal).toMatchObject({ custom_id: "new_task_modal|PvM|KC|Slayer", title: "New PvM task" });
        expect(modal?.components).toMatchObject([
            { component: { custom_id: "taskName" } },
            { component: { custom_id: "shortName" } },
            { component: { custom_id: "amounts" } },
            { label: "ID", description: "Leave blank to use PVM064", component: { custom_id: "id", required: false } },
        ]);
    });

    test("asks for an ID when the category has no tasks to number from", async ({ discord, interact }) => {
        const command = await interact(chatInputInteraction("newtask", options(TaskCategory.Leagues, TaskType.Other), AS.taskAdmin));

        expect(discord.modal(command)?.components[3]).toMatchObject({
            description: "No Leagues tasks to number from yet, so give one",
            component: { custom_id: "id", required: true },
        });
    });

    test("saves the task under the next ID, so it is found straight away", async ({ discord, interact, services, factories }) => {
        await factories.task.create({ id: "PVM063", category: TaskCategory.PvM });
        await services.repos.taskRepo.getTaskSearch();

        const submit = await interact(modalSubmitInteraction("new_task_modal|PvM|KC|Slayer", form));

        expect(discord.callbacks(submit)).toEqual([PRIVATE_DEFERRAL]);
        expect(discord.originalEdits(submit)).toEqual([
            expect.objectContaining({ content: "Task **PVM064** created successfully." }),
        ]);
        expect(await services.repos.taskRepo.getTaskById("PVM064")).toEqual({
            id: "PVM064",
            taskName: "Kill Vorkath",
            shortName: "Vorkath",
            category: TaskCategory.PvM,
            type: TaskType.KC,
            skill: Skill.Slayer,
            amtBronze: 5,
            amtSilver: 10,
            amtGold: 1000,
            weight: 50,
        });
        expect((await services.repos.taskRepo.getTaskSearch()).search("vorkath").map((result) => result.item.id)).toEqual(["PVM064"]);
    });

    test("saves the task under a typed ID", async ({ discord, interact, services }) => {
        const submit = await interact(modalSubmitInteraction("new_task_modal|Leagues|Other|", { ...form, id: " LEA001 " }));

        expect(discord.originalEdits(submit)).toEqual([
            expect.objectContaining({ content: "Task **LEA001** created successfully." }),
        ]);
        expect(await services.repos.taskRepo.getTaskById("LEA001")).toMatchObject({ category: TaskCategory.Leagues });
        expect(await services.repos.taskRepo.getTaskById("LEA001")).not.toHaveProperty("skill");
    });

    test("leaves a stored task alone when its ID is given", async ({ discord, interact, services, factories }) => {
        await factories.task.create({ id: "PVM001", taskName: "Kill {amount} Zulrah" });

        const submit = await interact(modalSubmitInteraction("new_task_modal|PvM|KC|", { ...form, id: "PVM001" }));

        expect(discord.originalEdits(submit)).toEqual([
            expect.objectContaining({ content: "Task **PVM001** already exists. Nothing was saved." }),
        ]);
        expect(await services.repos.taskRepo.getTaskById("PVM001")).toMatchObject({ taskName: "Kill {amount} Zulrah" });
    });

    test("saves nothing when the amounts aren't three whole numbers", async ({ discord, interact, services, factories }) => {
        await factories.task.create({ id: "PVM063", category: TaskCategory.PvM });

        const submit = await interact(modalSubmitInteraction("new_task_modal|PvM|KC|", { ...form, amounts: "5, lots, 1.5" }));

        expect(discord.originalEdits(submit)).toEqual([
            expect.objectContaining({
                content: "The amounts must be three whole numbers for bronze, silver and gold, e.g. 5, 10, 20. Nothing was saved.",
            }),
        ]);
        expect(await services.repos.taskRepo.getTaskById("PVM064")).toBeNull();
    });

    test("saves nothing when the ID is left blank for a category with no tasks", async ({ discord, interact, services }) => {
        const submit = await interact(modalSubmitInteraction("new_task_modal|Leagues|Other|", form));

        expect(discord.originalEdits(submit)).toEqual([
            expect.objectContaining({
                content: "There are no Leagues tasks to number from yet, so an ID is needed. Nothing was saved.",
            }),
        ]);
        expect(await services.repos.taskRepo.getAllTasks()).toEqual([]);
    });
});
