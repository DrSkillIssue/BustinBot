import { SnowflakeUtil } from "discord.js";
import { DateTime } from "luxon";
import { describe, expect, type StoringFactories, storePollableTasks, test } from "../fixtures.js";
import { componentsIn } from "../discord/harness.js";
import { IDS, apiMessage, buttonInteraction, AS, chatInputInteraction } from "../discord/payloads.js";
import { taskFactory, taskPollFactory } from "../factories.js";
import { TaskCategory } from "../../src/models/Task.js";
import { type TaskPoll } from "../../src/models/TaskPoll.js";
import { startTaskEventForCategory } from "../../src/modules/tasks/HandleTaskStart.js";
import { CONCURRENT_TRANSACTION_TIMEOUT_MS } from "../firestoreEmulator.js";

async function storeOpenPoll(factories: StoringFactories, overrides: Partial<TaskPoll> = {}): Promise<TaskPoll> {
    const messageId = overrides.messageId ?? SnowflakeUtil.generate().toString();
    return factories.taskPoll.create({
        id: messageId,
        messageId,
        options: [
            taskFactory.build({ id: "PVM001", shortName: "Zulrah" }),
            taskFactory.build({ id: "PVM002", shortName: "Vorkath" }),
            taskFactory.build({ id: "PVM003", shortName: "Hydra" }),
        ],
        createdAt: DateTime.now().minus({ hours: 1 }).toJSDate(),
        endsAt: DateTime.now().plus({ hours: 1 }).toJSDate(),
        ...overrides,
    });
}

describe("voting in a task poll", () => {
    test("records the vote, redraws the poll with it and thanks the member", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        const poll = await storeOpenPoll(factories);
        discord.acceptMessageEdits(IDS.channel);

        const click = await interact(
            buttonInteraction(`vote_${poll.category}_PVM002`, apiMessage({ id: poll.messageId })),
        );

        expect(discord.originalEdits(click)).toEqual([
            expect.objectContaining({ content: "Thank you for your vote!" }),
        ]);
        expect((await services.repos.taskRepo.getTaskPollById(poll.id))?.votes).toEqual({ [IDS.user]: "PVM002" });
        const [redrawn] = discord.messageEdits(IDS.channel, poll.messageId);
        expect(redrawn?.embeds?.[0]?.description).toContain("**1 vote**");
        expect(await services.repos.userRepo.getUserById(IDS.user)).toMatchObject({ taskPollsVoted: 1 });
    });

    test("refuses a vote from an outdated button or for an option the poll doesn't have", async ({
        discord,
        interact,
        factories,
    }) => {
        const poll = await storeOpenPoll(factories);

        const outdated = await interact(
            buttonInteraction(`vote_${TaskCategory.Skilling}_PVM001`, apiMessage({ id: poll.messageId })),
        );
        const unknown = await interact(
            buttonInteraction(`vote_${poll.category}_PVM999`, apiMessage({ id: poll.messageId })),
        );

        expect(discord.originalEdits(outdated)).toEqual([
            expect.objectContaining({ content: "This poll message is outdated." }),
        ]);
        expect(discord.originalEdits(unknown)).toEqual([expect.objectContaining({ content: "Invalid vote option." })]);
    });
});

describe("closing a task poll", () => {
    test("happens when its winning task starts, and its message stops offering votes", async ({
        discord,
        services,
        factories,
    }) => {
        const poll = await storeOpenPoll(factories, { votes: { [SnowflakeUtil.generate().toString()]: "PVM002" } });
        for (const task of poll.options) await factories.task.create(task);
        discord.acceptMessages(IDS.channel);
        discord.acceptMessageEdits(IDS.channel);
        discord.message(apiMessage({ id: poll.messageId }));

        await startTaskEventForCategory(discord.client, services, TaskCategory.PvM, "keyword");

        expect((await services.repos.taskRepo.getTaskPollById(poll.id))?.isActive).toBe(false);
        const [closedMessage] = discord.messageEdits(IDS.channel, poll.messageId);
        expect(componentsIn(closedMessage?.components)).toEqual([]);
    });
});

describe("/taskpoll", () => {
    test("posts the task polls now", async ({ discord, interact, services, factories }) => {
        await storePollableTasks(factories);
        discord.acceptMessages(IDS.channel);

        const command = await interact(chatInputInteraction("taskpoll", [], AS.botAdmin));

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "Task poll posted successfully." }),
        ]);
        expect(await services.repos.taskRepo.getActiveTaskPollByCategory(TaskCategory.PvM)).toMatchObject({
            isActive: true,
            channelId: IDS.channel,
        });
    });
});

describe("TaskRepository polls", () => {
    test("finds the active poll and the latest poll for a category", async ({ services }) => {
        await services.repos.taskRepo.createTaskPoll(
            taskPollFactory.build({ id: "old", createdAt: new Date("2026-01-04T00:00:00.000Z"), isActive: false }),
        );
        await services.repos.taskRepo.createTaskPoll(
            taskPollFactory.build({ id: "new", createdAt: new Date("2026-01-11T00:00:00.000Z") }),
        );
        await services.repos.taskRepo.createTaskPoll(
            taskPollFactory.build({ id: "skilling", category: TaskCategory.Skilling }),
        );

        expect((await services.repos.taskRepo.getActiveTaskPollByCategory(TaskCategory.PvM))?.id).toBe("new");
        expect((await services.repos.taskRepo.getLatestTaskPollByCategory(TaskCategory.PvM))?.id).toBe("new");
        expect(await services.repos.taskRepo.getTaskPollById("old")).toMatchObject({ id: "old", isActive: false });
        expect(await services.repos.taskRepo.getActiveTaskPollByCategory(TaskCategory.MinigameMisc)).toBeNull();
    });

    test(
        "counts every vote when voters vote at the same time",
        async ({ services }) => {
            const poll = taskPollFactory.build();
            await services.repos.taskRepo.createTaskPoll(poll);

            await Promise.all(
                Array.from({ length: 5 }, () =>
                    services.repos.taskRepo.voteInPollOnce(poll.id, SnowflakeUtil.generate().toString(), "PVM001"),
                ),
            );

            expect(Object.keys((await services.repos.taskRepo.getTaskPollById(poll.id))?.votes ?? {})).toHaveLength(5);
        },
        CONCURRENT_TRANSACTION_TIMEOUT_MS,
    );
});
