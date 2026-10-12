import { SnowflakeUtil } from "discord.js";
import { DateTime, Duration } from "luxon";
import { describe, expect, test, vi, type StoringFactories } from "../../../tests/fixtures.js";
import { IDS, apiMember } from "../../../tests/discord/payloads.js";
import { taskFactory } from "../../../tests/factories.js";
import { TaskCategory, type Task } from "../../../models/Task.js";
import type { TaskPoll } from "../../../models/TaskPoll.js";
import { startTaskEventForCategory } from "../HandleTaskStart.js";

const admin = { member: apiMember({ roles: [IDS.roles.admin] }) };

const tasksFor = (category: TaskCategory, prefix: string): Task[] =>
    [1, 2, 3].map((n) =>
        taskFactory.build({
            id: `${prefix}00${n}`,
            category,
            taskName: `${prefix} task ${n}`,
            amtBronze: n,
            amtSilver: n * 2,
            amtGold: n * 3,
        }),
    );

// A poll for a category whose voting has just ended, with the given votes
async function storePoll(
    factories: StoringFactories,
    category: TaskCategory,
    options: Task[],
    votes: Record<string, string>,
    overrides: Partial<TaskPoll> = {},
): Promise<void> {
    const messageId = SnowflakeUtil.generate().toString();
    for (const task of options) await factories.task.create(task);
    await factories.taskPoll.create({
        id: messageId,
        messageId,
        category,
        options,
        votes,
        endsAt: DateTime.now().minus({ seconds: 1 }).toJSDate(),
        ...overrides,
    });
}

describe("/taskstart", () => {
    test("announces the week's keyword and starts each category's most voted task", async ({
        discord,
        slash,
        services,
        db,
        factories,
    }) => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        await services.repos.keywordRepo.addKeyword("Bustin");
        await storePoll(factories, TaskCategory.PvM, tasksFor(TaskCategory.PvM, "PVM"), {
            [SnowflakeUtil.generate().toString()]: "PVM002",
            [SnowflakeUtil.generate().toString()]: "PVM002",
            [SnowflakeUtil.generate().toString()]: "PVM001",
        });
        await storePoll(factories, TaskCategory.Skilling, tasksFor(TaskCategory.Skilling, "SKL"), {
            [SnowflakeUtil.generate().toString()]: "SKL003",
        });
        await storePoll(factories, TaskCategory.MinigameMisc, tasksFor(TaskCategory.MinigameMisc, "MIN"), {
            [SnowflakeUtil.generate().toString()]: "MIN001",
        });
        discord.acceptMessages(IDS.channel);

        const interaction = await slash("taskstart", [], admin);

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Task event started successfully." }),
        ]);
        const [announcement, ...eventPosts] = discord.messagesSentTo(IDS.channel);
        expect(announcement?.content).toContain("Include the keyword **Bustin** in your screenshots");
        expect(eventPosts).toHaveLength(3);
        const events = (await db.collection(`guilds/${IDS.guild}/taskEvents`).get()).docs.map((doc) => doc.data());
        expect(events.map((event) => event.task.id).sort()).toEqual(["MIN001", "PVM002", "SKL003"]);
        for (const event of events) {
            expect(event).toMatchObject({ keyword: "Bustin", channelId: IDS.channel, messageId: expect.any(String) });
            expect(event.endTime.toMillis() - event.startTime.toMillis()).toBe(
                Duration.fromObject({ days: 7 }).toMillis(),
            );
        }
        for (const category of [TaskCategory.PvM, TaskCategory.Skilling, TaskCategory.MinigameMisc]) {
            expect(await services.repos.taskRepo.getActiveTaskPollByCategory(category)).toBeNull();
        }
    });
});

describe("starting a category's task", () => {
    test("breaks a tie in favour of the option listed first in the poll", async ({ discord, services, factories }) => {
        await storePoll(factories, TaskCategory.PvM, tasksFor(TaskCategory.PvM, "PVM"), {
            [SnowflakeUtil.generate().toString()]: "PVM003",
            [SnowflakeUtil.generate().toString()]: "PVM002",
        });
        discord.acceptMessages(IDS.channel);

        await startTaskEventForCategory(discord.client, services, TaskCategory.PvM, "Bustin");

        expect((await services.repos.taskRepo.getLatestTaskEvent())?.task.id).toBe("PVM002");
    });

    test("uses the poll that has just been closed, which is the usual case when polls end as tasks start", async ({
        discord,
        services,
        factories,
    }) => {
        await storePoll(
            factories,
            TaskCategory.PvM,
            tasksFor(TaskCategory.PvM, "PVM"),
            { [SnowflakeUtil.generate().toString()]: "PVM003" },
            { isActive: false },
        );
        discord.acceptMessages(IDS.channel);

        await startTaskEventForCategory(discord.client, services, TaskCategory.PvM, "Bustin");

        expect((await services.repos.taskRepo.getLatestTaskEvent())?.task.id).toBe("PVM003");
    });

    test("keeps both events when the same task starts twice in a day", async ({ discord, services, db, factories }) => {
        await storePoll(factories, TaskCategory.PvM, tasksFor(TaskCategory.PvM, "PVM"), {
            [SnowflakeUtil.generate().toString()]: "PVM001",
        });
        discord.acceptMessages(IDS.channel);

        await startTaskEventForCategory(discord.client, services, TaskCategory.PvM, "Bustin");
        await startTaskEventForCategory(discord.client, services, TaskCategory.PvM, "Bustin");

        const events = (await db.collection(`guilds/${IDS.guild}/taskEvents`).get()).docs;
        expect(events).toHaveLength(2);
        expect(new Set(events.map((doc) => doc.data().messageId)).size).toBe(2);
    });

    test("posts nothing for a category without a poll", async ({ discord, services }) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        await startTaskEventForCategory(discord.client, services, TaskCategory.PvM, "Bustin");

        expect(warn).toHaveBeenCalledWith(`[TaskStart] No active poll found for ${TaskCategory.PvM}.`);
        expect(discord.messagesSentTo(IDS.channel)).toEqual([]);
    });
});
