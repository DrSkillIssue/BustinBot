import { ApplicationCommandOptionType, InteractionResponseType, MessageFlags } from "discord-api-types/v10";
import { describe, expect, test } from "../fixtures.js";
import {
    chatInputInteraction,
    AS,
    apiAttachment,
    modalSubmitInteraction,
} from "../discord/payloads.js";
import { TaskCategory } from "../../src/models/Task.js";

const CSV = [
    "ID,Task Name,Category,Type,Skill,Bronze Amount,Silver Amount,Gold Amount,Weight,Short Name,Wilderness Required?",
    "PVM001,Kill {amount} Zulrah,PvM,KC,,10,25,50,,Zulrah,TRUE",
    "PVM002,Kill {amount} Vorkath,PvM,KC,,5,10,20,,Vorkath,FALSE",
].join("\n");

const form = { taskName: "Kill {amount} Vorkath", shortName: "Vorkath", type: "kc", amounts: "5, 10/150000" };

describe("/listtasks", () => {
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
});

describe("the update task form", () => {
    test("answers when the task no longer exists", async ({ discord, interact }) => {
        const submit = await interact(modalSubmitInteraction("update_task_modal_PVM404", form));

        expect(discord.originalEdits(submit)).toEqual([
            expect.objectContaining({ content: "Could not find task with ID **PVM404**." }),
        ]);
    });
});

describe("/updatetask", () => {
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

