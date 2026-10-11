import { ComponentType, type APIMessageTopLevelComponent } from "discord-api-types/v10";
import { afterEach, describe, expect, test, vi } from "../../../tests/fixtures.js";
import type { ServiceContainer } from "../../../core/services/ServiceContainer.js";
import { IDS, apiMember, apiMessage, apiUser, buttonInteraction } from "../../../tests/discord/payloads.js";
import { buildTask, buildTaskPoll } from "../../../tests/fakes/builders.js";
import { Skill, TaskCategory, type Task } from "../../../models/Task.js";
import type { TaskPoll } from "../../../models/TaskPoll.js";
import { postAllTaskPolls } from "../HandleTaskPoll.js";
import { startTaskEventForCategory } from "../HandleTaskStart.js";

const HOUR = 60 * 60 * 1000;
const options: Task[] = [buildTask({ id: "PVM001", shortName: "Zulrah" }), buildTask({ id: "PVM002", shortName: "Vorkath" }), buildTask({ id: "PVM003", shortName: "Hydra" })];

// The custom ids of the voting buttons on a poll message, if it has any
function voteButtons(components: APIMessageTopLevelComponent[] | null | undefined): string[] {
    return (components ?? []).flatMap((row) => (row.type === ComponentType.ActionRow ? row.components : []))
        .flatMap((button) => ("custom_id" in button ? [button.custom_id] : []));
}

// A poll that is open in the harness channel, as stored when it was posted
async function storeOpenPoll(services: ServiceContainer, overrides: Partial<TaskPoll> = {}): Promise<TaskPoll> {
    const messageId = overrides.messageId ?? "100000000000000500";
    const poll = buildTaskPoll({ id: messageId, messageId, options, createdAt: new Date(Date.now() - HOUR), endsAt: new Date(Date.now() + HOUR), ...overrides });
    await services.repos.taskRepo!.createTaskPoll(poll);
    return poll;
}

function vote(poll: TaskPoll, optionId: string, userId: string = IDS.user) {
    return buttonInteraction(`vote_${poll.category}_${optionId}`, apiMessage({ id: poll.messageId }), { member: apiMember({ user: apiUser({ id: userId }) }) });
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("posting the weekly task polls", () => {
    test("announces them and posts one open poll per category, each stored with its options", async ({ discord, services }) => {
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "warn").mockImplementation(() => {});
        await services.repos.taskRepo!.seedTasks([
            ...options,
            buildTask({ id: "SKL001", category: TaskCategory.Skilling, skill: Skill.Mining }),
            buildTask({ id: "SKL002", category: TaskCategory.Skilling, skill: Skill.Fishing }),
            buildTask({ id: "SKL003", category: TaskCategory.Skilling, skill: Skill.Cooking }),
            buildTask({ id: "MIN001", category: TaskCategory.MinigameMisc }),
            buildTask({ id: "MIN002", category: TaskCategory.MinigameMisc }),
            buildTask({ id: "MIN003", category: TaskCategory.MinigameMisc }),
        ]);
        discord.acceptMessages(IDS.channel);

        await postAllTaskPolls(discord.client, services);

        const [announcement, ...polls] = discord.messagesSentTo(IDS.channel);
        expect(announcement?.content).toContain("**New task polls are live!**");
        expect(polls).toHaveLength(3);
        for (const poll of polls) {
            expect(voteButtons(poll.components)).toHaveLength(3);
            expect(poll.files).toEqual(["category_icon.png"]);
        }
        for (const category of [TaskCategory.PvM, TaskCategory.Skilling, TaskCategory.MinigameMisc]) {
            const stored = await services.repos.taskRepo!.getActiveTaskPollByCategory(category);
            expect(stored?.options).toHaveLength(3);
            expect(stored!.endsAt.getTime() - stored!.createdAt.getTime()).toBe(24 * HOUR);
        }
    });
});

describe("voting in a task poll", () => {
    test("records the vote, redraws the poll with it and thanks the member", async ({ discord, interact, services }) => {
        const poll = await storeOpenPoll(services);
        discord.acceptMessageEdits(IDS.channel);

        const click = await interact(vote(poll, "PVM002"));

        expect(discord.originalEdits(click)).toEqual([expect.objectContaining({ content: "Thank you for your vote!" })]);
        expect((await services.repos.taskRepo!.getTaskPollById(poll.id))?.votes).toEqual({ [IDS.user]: "PVM002" });
        const [redrawn] = discord.messageEdits(IDS.channel, poll.messageId);
        expect(redrawn?.embeds?.[0]?.description).toContain("**1 vote**");
        expect(await services.repos.userRepo!.getUserById(IDS.user)).toMatchObject({ taskPollsVoted: 1 });
    });

    test("lets a member change their vote without counting them twice", async ({ discord, interact, services }) => {
        const poll = await storeOpenPoll(services);
        discord.acceptMessageEdits(IDS.channel);

        await interact(vote(poll, "PVM001"));
        await interact(vote(poll, "PVM003"));

        expect((await services.repos.taskRepo!.getTaskPollById(poll.id))?.votes).toEqual({ [IDS.user]: "PVM003" });
        expect(await services.repos.userRepo!.getUserById(IDS.user)).toMatchObject({ taskPollsVoted: 1 });
    });

    test("keeps counting every vote on a poll posted before the bot restarted", async ({ discord, interact, services }) => {
        const poll = await storeOpenPoll(services);
        discord.acceptMessageEdits(IDS.channel);
        const voters: string[] = ["100000000000000031", "100000000000000032", "100000000000000033"];

        for (const voter of voters) {
            const click = await interact(vote(poll, "PVM001", voter));
            expect(discord.originalEdits(click)).toEqual([expect.objectContaining({ content: "Thank you for your vote!" })]);
        }

        expect(Object.keys((await services.repos.taskRepo!.getTaskPollById(poll.id))?.votes ?? {})).toEqual(voters);
    });

    test("refuses votes once the poll has closed or its time is up", async ({ discord, interact, services }) => {
        const closed = await storeOpenPoll(services, { isActive: false });
        const expired = await storeOpenPoll(services, { messageId: "100000000000000501", endsAt: new Date(Date.now() - 1000) });

        for (const poll of [closed, expired]) {
            const click = await interact(vote(poll, "PVM001"));
            expect(discord.originalEdits(click)).toEqual([expect.objectContaining({ content: "This poll has closed." })]);
            expect((await services.repos.taskRepo!.getTaskPollById(poll.id))?.votes).toEqual({});
        }
    });

    test("refuses a vote from an outdated button or for an option the poll doesn't have", async ({ discord, interact, services }) => {
        const poll = await storeOpenPoll(services);

        const outdated = await interact(vote({ ...poll, category: TaskCategory.Skilling }, "PVM001"));
        const unknown = await interact(vote(poll, "PVM999"));

        expect(discord.originalEdits(outdated)).toEqual([expect.objectContaining({ content: "This poll message is outdated." })]);
        expect(discord.originalEdits(unknown)).toEqual([expect.objectContaining({ content: "Invalid vote option." })]);
    });
});

describe("closing a task poll", () => {
    test("happens when its winning task starts, and its message stops offering votes", async ({ discord, services }) => {
        vi.spyOn(console, "log").mockImplementation(() => {});
        await services.repos.taskRepo!.seedTasks(options);
        const poll = await storeOpenPoll(services, { votes: { "100000000000000031": "PVM002" } });
        discord.acceptMessages(IDS.channel);
        discord.acceptMessageEdits(IDS.channel);
        discord.api
            .intercept({ path: `/api/v10/channels/${IDS.channel}/messages/${poll.messageId}`, method: "GET" })
            .reply(200, apiMessage({ id: poll.messageId }), { headers: { "content-type": "application/json" } });

        await startTaskEventForCategory(discord.client, services, TaskCategory.PvM, "keyword");

        expect((await services.repos.taskRepo!.getTaskPollById(poll.id))?.isActive).toBe(false);
        const [closedMessage] = discord.messageEdits(IDS.channel, poll.messageId);
        expect(voteButtons(closedMessage?.components)).toEqual([]);
    });
});
