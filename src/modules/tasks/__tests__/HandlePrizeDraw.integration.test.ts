import { describe, expect, test, vi } from "../../../tests/fixtures.js";
import { DiscordError } from "../../../tests/discord/harness.js";
import type { ServiceContainer } from "../../../core/services/ServiceContainer.js";
import { IDS, apiRole, apiUser, nextId } from "../../../tests/discord/payloads.js";
import { buildPrizeDraw, buildTaskEvent, buildTaskSubmission } from "../../../tests/fakes/builders.js";
import { SubmissionStatus } from "../../../models/TaskSubmission.js";
import type { PrizeDraw } from "../../../models/PrizeDraw.js";
import { announcePrizeDrawWinner, generatePrizeDrawSnapshot, rollWinnerForSnapshot } from "../HandlePrizeDraw.js";

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY);
const [winner, second, third, fourth] = [nextId(), nextId(), nextId(), nextId()];

// A finished task event and the submissions made for it
async function storeEvent(services: ServiceContainer, id: string, endTime: Date, submissions: Array<{ userId: string; status: SubmissionStatus; submittedAt?: Date; reviewedAt?: Date }>) {
    const repo = services.repos.taskRepo;
    await repo.createTaskEvent(buildTaskEvent({ id, startTime: new Date(endTime.getTime() - 7 * DAY), endTime, createdAt: new Date(endTime.getTime() - 7 * DAY) }));
    for (const [index, submission] of submissions.entries()) {
        await repo.createSubmission(buildTaskSubmission({ id: `${id}-${index}`, taskEventId: id, ...submission }));
    }
}

async function snapshot(services: ServiceContainer): Promise<PrizeDraw> {
    return generatePrizeDrawSnapshot(services.repos.prizeRepo, services.repos.taskRepo);
}

// A draw whose snapshot was taken yesterday, the winner holding two of its three entries
function storedDraw(overrides: Partial<PrizeDraw> = {}): PrizeDraw {
    return buildPrizeDraw({
        id: "draw-1",
        start: daysAgo(14).toISOString(),
        end: daysAgo(1).toISOString(),
        snapshotTakenAt: daysAgo(1).toISOString(),
        participants: { [winner]: 2, [second]: 1 },
        entries: [winner, winner, second],
        totalEntries: 3,
        tierCounts: { bronze: 1, silver: 1, gold: 1 },
        ...overrides,
    });
}

describe("a prize draw snapshot", () => {
    test("gives one entry per task however many times the member upgraded their submission", async ({ services }) => {
        await storeEvent(services, "pvm", daysAgo(2), [
            { userId: winner, status: SubmissionStatus.Bronze },
            { userId: winner, status: SubmissionStatus.Silver },
            { userId: winner, status: SubmissionStatus.Gold },
        ]);

        expect(await snapshot(services)).toMatchObject({ participants: { [winner]: 1 }, totalEntries: 1, tierCounts: { bronze: 0, silver: 0, gold: 1 } });
    });

    test("gives one entry for each task the member completed", async ({ services }) => {
        for (const id of ["pvm", "skilling", "minigame"]) {
            await storeEvent(services, id, daysAgo(2), [{ userId: winner, status: SubmissionStatus.Gold }]);
        }

        expect(await snapshot(services)).toMatchObject({ participants: { [winner]: 3 }, totalEntries: 3 });
    });

    test("leaves out submissions that are pending or rejected", async ({ services }) => {
        await storeEvent(services, "pvm", daysAgo(2), [
            { userId: winner, status: SubmissionStatus.Pending },
            { userId: second, status: SubmissionStatus.Rejected },
        ]);

        expect(await snapshot(services)).toMatchObject({ participants: {}, totalEntries: 0 });
    });

    test("leaves out a task event that is still running", async ({ services }) => {
        await storeEvent(services, "finished", daysAgo(2), [{ userId: winner, status: SubmissionStatus.Gold }]);
        await storeEvent(services, "running", new Date(Date.now() + 60 * 60 * 1000), [{ userId: second, status: SubmissionStatus.Gold }]);

        expect(await snapshot(services)).toMatchObject({ participants: { [winner]: 1 }, taskEventIds: ["finished"] });
    });

    test("carries over approvals the previous draw's snapshot missed", async ({ services }) => {
        const previousEnd = daysAgo(21);
        const previousSnapshot = new Date(previousEnd.getTime() + 1 * DAY);
        await services.repos.prizeRepo.createPrizeDraw(storedDraw({
            id: "previous",
            start: new Date(previousEnd.getTime() - 14 * DAY).toISOString(),
            end: previousEnd.toISOString(),
            snapshotTakenAt: previousSnapshot.toISOString(),
            rolledAt: new Date(previousSnapshot.getTime() + 1 * DAY).toISOString(),
            taskEventIds: ["previous-event"],
        }));
        await storeEvent(services, "previous-event", previousEnd, [
            // Approved after the previous snapshot, before its roll: in neither draw until carried over
            { userId: second, status: SubmissionStatus.Silver, submittedAt: new Date(previousEnd.getTime() - DAY), reviewedAt: new Date(previousSnapshot.getTime() + 60 * 60 * 1000) },
            // Approved before the previous snapshot: already counted there
            { userId: third, status: SubmissionStatus.Gold, submittedAt: new Date(previousEnd.getTime() - DAY), reviewedAt: new Date(previousEnd.getTime() - 60 * 60 * 1000) },
            // Made after the previous period ended
            { userId: fourth, status: SubmissionStatus.Bronze, submittedAt: new Date(previousEnd.getTime() + DAY), reviewedAt: new Date(previousEnd.getTime() + 2 * DAY) },
        ]);
        await storeEvent(services, "current-event", daysAgo(2), [{ userId: winner, status: SubmissionStatus.Gold }]);

        const draw = await snapshot(services);

        expect(draw.participants).toEqual({ [winner]: 1, [second]: 1 });
        expect(draw.taskEventIds).toEqual(expect.arrayContaining(["current-event", "previous-event"]));
    });

    test("carries over only from the most recent rolled draw", async ({ services }) => {
        for (const [id, endDaysAgo] of [["older", 42], ["latest", 21]] as const) {
            const end = daysAgo(endDaysAgo);
            await services.repos.prizeRepo.createPrizeDraw(storedDraw({
                id,
                start: new Date(end.getTime() - 14 * DAY).toISOString(),
                end: end.toISOString(),
                snapshotTakenAt: new Date(end.getTime() + DAY).toISOString(),
                rolledAt: new Date(end.getTime() + 2 * DAY).toISOString(),
                taskEventIds: [`${id}-event`],
            }));
            await storeEvent(services, `${id}-event`, end, [
                { userId: `${id}-member`, status: SubmissionStatus.Bronze, submittedAt: new Date(end.getTime() - DAY), reviewedAt: new Date(end.getTime() + 1.5 * DAY) },
            ]);
        }
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        expect((await snapshot(services)).participants).toEqual({ "latest-member": 1 });
        expect(warn).toHaveBeenCalledWith("[PrizeDraw] No task events found in range for snapshot.");
    });
});

describe("rolling a prize draw", () => {
    test("finds no winner without entries", async ({ services }) => {
        await services.repos.prizeRepo.createPrizeDraw(storedDraw({ participants: {}, entries: [], totalEntries: 0 }));

        expect(await rollWinnerForSnapshot(services.repos.prizeRepo, "draw-1", services)).toBeNull();
    });

    test("keeps the winner already rolled", async ({ services }) => {
        await services.repos.prizeRepo.createPrizeDraw(storedDraw({ winnerId: second, rolledAt: daysAgo(1).toISOString() }));

        expect(await rollWinnerForSnapshot(services.repos.prizeRepo, "draw-1", services)).toBe(second);
    });

    test("picks a winner by entries, stores them and counts the win", async ({ services }) => {
        vi.spyOn(Math, "random").mockReturnValue(0);
        await services.repos.prizeRepo.createPrizeDraw(storedDraw());

        expect(await rollWinnerForSnapshot(services.repos.prizeRepo, "draw-1", services)).toBe(winner);
        expect(await services.repos.prizeRepo.getPrizeDrawById("draw-1")).toMatchObject({ winnerId: winner, rolledAt: expect.any(String) });
        expect(await services.repos.userRepo.getUserById(winner)).toMatchObject({ taskPrizesWon: 1 });
    });
});

describe("announcing a prize draw winner", () => {
    test("posts one message mentioning the task role with the winner's embed, and congratulates the winner", async ({ discord, services }) => {
        const taskUser = apiRole({ name: "Task User" });
        await discord.addRole(IDS.guild, taskUser);
        await services.guilds.update(IDS.guild, { roles: { taskUser: taskUser.id } });
        await services.repos.prizeRepo.createPrizeDraw(storedDraw({ winnerId: winner }));
        discord.user(apiUser({ id: winner, username: "lucky" }));
        discord.acceptMessages(IDS.channel);
        const dm = discord.acceptDirectMessages(winner);

        expect(await announcePrizeDrawWinner(discord.client, services, services.repos.prizeRepo, "draw-1")).toBe(true);

        expect(discord.messagesSentTo(IDS.channel)).toEqual([expect.objectContaining({
            content: `<@&${taskUser.id}>`,
            embeds: [expect.objectContaining({ thumbnail: { url: "attachment://task_prize.png" } })],
            files: ["task_prize.png"],
        })]);
        expect(discord.messagesSentTo(dm)).toEqual([expect.objectContaining({ content: expect.stringContaining("You've won the latest OSRS community tasks prize draw in **Test Guild**") })]);
    });

    test("still posts the winner's embed when no task role is configured", async ({ discord, services }) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        await services.repos.prizeRepo.createPrizeDraw(storedDraw({ winnerId: winner }));
        discord.user(apiUser({ id: winner, username: "lucky" }));
        discord.acceptMessages(IDS.channel);
        discord.acceptDirectMessages(winner);

        expect(await announcePrizeDrawWinner(discord.client, services, services.repos.prizeRepo, "draw-1")).toBe(true);

        const [posted] = discord.messagesSentTo(IDS.channel);
        expect(posted?.embeds).toHaveLength(1);
        expect(posted).not.toHaveProperty("content");
        expect(warn).toHaveBeenCalledWith("[PrizeDraw] Task user role not configured or not found.");
    });

    test("reports that the task channel can't be reached instead of posting anywhere else", async ({ discord, services }) => {
        await services.guilds.update(IDS.guild, { channels: { taskChannel: IDS.missingChannel } });
        await services.repos.prizeRepo.createPrizeDraw(storedDraw({ winnerId: winner }));
        discord.user(apiUser({ id: winner, username: "lucky" }));
        discord.refuse("GET", `/channels/${IDS.missingChannel}`, DiscordError.unknownChannel);
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        expect(await announcePrizeDrawWinner(discord.client, services, services.repos.prizeRepo, "draw-1")).toBe(false);

        expect(warn).toHaveBeenCalledWith("[PrizeDraw] Announcement channel not found.");
        expect(discord.requests().filter((request) => request.method === "POST")).toEqual([]);
    });
});
