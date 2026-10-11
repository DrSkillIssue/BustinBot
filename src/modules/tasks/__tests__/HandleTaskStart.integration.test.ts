import { describe, expect, test, vi } from "../../../tests/fixtures.js";
import type { ServiceContainer } from "../../../core/services/ServiceContainer.js";
import { IDS, withRoles } from "../../../tests/discord/payloads.js";
import { buildTask, buildTaskPoll } from "../../../tests/fakes/builders.js";
import { TaskCategory, type Task } from "../../../models/Task.js";
import type { TaskPoll } from "../../../models/TaskPoll.js";
import { startTaskEventForCategory } from "../HandleTaskStart.js";

const DAY = 24 * 60 * 60 * 1000;
const admin = withRoles(IDS.roles.admin);

const tasksFor = (category: TaskCategory, prefix: string): Task[] =>
    [1, 2, 3].map((n) => buildTask({ id: `${prefix}00${n}`, category, taskName: `${prefix} task ${n}`, amtBronze: n, amtSilver: n * 2, amtGold: n * 3 }));

// A poll for a category whose voting has just ended, with the given votes
async function storePoll(services: ServiceContainer, category: TaskCategory, options: Task[], votes: Record<string, string>, overrides: Partial<TaskPoll> = {}): Promise<void> {
    const messageId = `${600000000000000000n + BigInt(Object.values(TaskCategory).indexOf(category))}`;
    await services.repos.taskRepo.seedTasks(options);
    await services.repos.taskRepo.createTaskPoll(buildTaskPoll({ id: messageId, messageId, category, options, votes, endsAt: new Date(Date.now() - 1000), ...overrides }));
}

describe("/taskstart", () => {
    test("announces the week's keyword and starts each category's most voted task", async ({ discord, slash, services, db }) => {
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "warn").mockImplementation(() => {});
        await services.repos.keywordRepo.addKeyword("Bustin");
        await storePoll(services, TaskCategory.PvM, tasksFor(TaskCategory.PvM, "PVM"), { a: "PVM002", b: "PVM002", c: "PVM001" });
        await storePoll(services, TaskCategory.Skilling, tasksFor(TaskCategory.Skilling, "SKL"), { a: "SKL003" });
        await storePoll(services, TaskCategory.MinigameMisc, tasksFor(TaskCategory.MinigameMisc, "MIN"), { a: "MIN001" });
        discord.acceptMessages(IDS.channel);

        const interaction = await slash("taskstart", [], admin);

        expect(discord.originalEdits(interaction)).toEqual([expect.objectContaining({ content: "Task event started successfully." })]);
        const [announcement, ...eventPosts] = discord.messagesSentTo(IDS.channel);
        expect(announcement?.content).toContain("Include the keyword **Bustin** in your screenshots");
        expect(eventPosts).toHaveLength(3);
        const events = (await db.collection(`guilds/${IDS.guild}/taskEvents`).get()).docs.map((doc) => doc.data());
        expect(events.map((event) => event.task.id).sort()).toEqual(["MIN001", "PVM002", "SKL003"]);
        for (const event of events) {
            expect(event).toMatchObject({ keyword: "Bustin", channelId: IDS.channel, messageId: expect.any(String) });
            expect(event.endTime.toMillis() - event.startTime.toMillis()).toBe(7 * DAY);
        }
        for (const category of [TaskCategory.PvM, TaskCategory.Skilling, TaskCategory.MinigameMisc]) {
            expect(await services.repos.taskRepo.getActiveTaskPollByCategory(category)).toBeNull();
        }
    });
});

describe("starting a category's task", () => {
    test("breaks a tie in favour of the option listed first in the poll", async ({ discord, services }) => {
        vi.spyOn(console, "log").mockImplementation(() => {});
        await storePoll(services, TaskCategory.PvM, tasksFor(TaskCategory.PvM, "PVM"), { a: "PVM003", b: "PVM002" });
        discord.acceptMessages(IDS.channel);

        await startTaskEventForCategory(discord.client, services, TaskCategory.PvM, "Bustin");

        expect((await services.repos.taskRepo.getLatestTaskEvent())?.task.id).toBe("PVM002");
    });

    test("uses the poll that has just been closed, which is the usual case when polls end as tasks start", async ({ discord, services }) => {
        vi.spyOn(console, "log").mockImplementation(() => {});
        await storePoll(services, TaskCategory.PvM, tasksFor(TaskCategory.PvM, "PVM"), { a: "PVM003" }, { isActive: false });
        discord.acceptMessages(IDS.channel);

        await startTaskEventForCategory(discord.client, services, TaskCategory.PvM, "Bustin");

        expect((await services.repos.taskRepo.getLatestTaskEvent())?.task.id).toBe("PVM003");
    });

    test("keeps both events when the same task starts twice in a day", async ({ discord, services, db }) => {
        vi.spyOn(console, "log").mockImplementation(() => {});
        await storePoll(services, TaskCategory.PvM, tasksFor(TaskCategory.PvM, "PVM"), { a: "PVM001" });
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
