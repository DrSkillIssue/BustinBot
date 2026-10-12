import { SnowflakeUtil } from "discord.js";
import { DateTime } from "luxon";
import { describe, expect, test, vi } from "../../../tests/fixtures.js";
import { DiscordError } from "../../../tests/discord/harness.js";
import type { ServiceContainer } from "../../../core/services/ServiceContainer.js";
import { IDS, apiRole, apiUser } from "../../../tests/discord/payloads.js";
import { buildPrizeDraw, buildTaskEvent, buildTaskSubmission } from "../../../tests/fakes/builders.js";
import { SubmissionStatus } from "../../../models/TaskSubmission.js";
import type { PrizeDraw } from "../../../models/PrizeDraw.js";
import { announcePrizeDrawWinner, generatePrizeDrawSnapshot, rollWinnerForSnapshot } from "../HandlePrizeDraw.js";

const [winner, second, third, fourth] = [SnowflakeUtil.generate().toString(), SnowflakeUtil.generate().toString(), SnowflakeUtil.generate().toString(), SnowflakeUtil.generate().toString()];

// A finished task event and the submissions made for it
async function storeEvent(services: ServiceContainer, id: string, endTime: DateTime, submissions: Array<{ userId: string; status: SubmissionStatus; submittedAt?: Date; reviewedAt?: Date }>) {
    const repo = services.repos.taskRepo;
    await repo.createTaskEvent(buildTaskEvent({ id, startTime: endTime.minus({ days: 7 }).toJSDate(), endTime: endTime.toJSDate(), createdAt: endTime.minus({ days: 7 }).toJSDate() }));
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
        start: DateTime.now().minus({ days: 14 }).toUTC().toISO(),
        end: DateTime.now().minus({ days: 1 }).toUTC().toISO(),
        snapshotTakenAt: DateTime.now().minus({ days: 1 }).toUTC().toISO(),
        participants: { [winner]: 2, [second]: 1 },
        entries: [winner, winner, second],
        totalEntries: 3,
        tierCounts: { bronze: 1, silver: 1, gold: 1 },
        ...overrides,
    });
}

describe("a prize draw snapshot", () => {
    test("gives one entry per task however many times the member upgraded their submission", async ({ services }) => {
        await storeEvent(services, "pvm", DateTime.now().minus({ days: 2 }), [
            { userId: winner, status: SubmissionStatus.Bronze },
            { userId: winner, status: SubmissionStatus.Silver },
            { userId: winner, status: SubmissionStatus.Gold },
        ]);

        expect(await snapshot(services)).toMatchObject({ participants: { [winner]: 1 }, totalEntries: 1, tierCounts: { bronze: 0, silver: 0, gold: 1 } });
    });

    test("gives one entry for each task the member completed", async ({ services }) => {
        for (const id of ["pvm", "skilling", "minigame"]) {
            await storeEvent(services, id, DateTime.now().minus({ days: 2 }), [{ userId: winner, status: SubmissionStatus.Gold }]);
        }

        expect(await snapshot(services)).toMatchObject({ participants: { [winner]: 3 }, totalEntries: 3 });
    });

    test("leaves out submissions that are pending or rejected", async ({ services }) => {
        await storeEvent(services, "pvm", DateTime.now().minus({ days: 2 }), [
            { userId: winner, status: SubmissionStatus.Pending },
            { userId: second, status: SubmissionStatus.Rejected },
        ]);

        expect(await snapshot(services)).toMatchObject({ participants: {}, totalEntries: 0 });
    });

    test("leaves out a task event that is still running", async ({ services }) => {
        await storeEvent(services, "finished", DateTime.now().minus({ days: 2 }), [{ userId: winner, status: SubmissionStatus.Gold }]);
        await storeEvent(services, "running", DateTime.now().plus({ hours: 1 }), [{ userId: second, status: SubmissionStatus.Gold }]);

        expect(await snapshot(services)).toMatchObject({ participants: { [winner]: 1 }, taskEventIds: ["finished"] });
    });

    test("carries over approvals the previous draw's snapshot missed", async ({ services }) => {
        const previousEnd = DateTime.now().minus({ days: 21 });
        const previousSnapshot = previousEnd.plus({ days: 1 });
        await services.repos.prizeRepo.createPrizeDraw(storedDraw({
            id: "previous",
            start: previousEnd.minus({ days: 14 }).toUTC().toISO(),
            end: previousEnd.toUTC().toISO(),
            snapshotTakenAt: previousSnapshot.toUTC().toISO(),
            rolledAt: previousSnapshot.plus({ days: 1 }).toUTC().toISO(),
            taskEventIds: ["previous-event"],
        }));
        await storeEvent(services, "previous-event", previousEnd, [
            // Approved after the previous snapshot, before its roll: in neither draw until carried over
            { userId: second, status: SubmissionStatus.Silver, submittedAt: previousEnd.minus({ days: 1 }).toJSDate(), reviewedAt: previousSnapshot.plus({ hours: 1 }).toJSDate() },
            // Approved before the previous snapshot: already counted there
            { userId: third, status: SubmissionStatus.Gold, submittedAt: previousEnd.minus({ days: 1 }).toJSDate(), reviewedAt: previousEnd.minus({ hours: 1 }).toJSDate() },
            // Made after the previous period ended
            { userId: fourth, status: SubmissionStatus.Bronze, submittedAt: previousEnd.plus({ days: 1 }).toJSDate(), reviewedAt: previousEnd.plus({ days: 2 }).toJSDate() },
        ]);
        await storeEvent(services, "current-event", DateTime.now().minus({ days: 2 }), [{ userId: winner, status: SubmissionStatus.Gold }]);

        const draw = await snapshot(services);

        expect(draw.participants).toEqual({ [winner]: 1, [second]: 1 });
        expect(draw.taskEventIds).toEqual(expect.arrayContaining(["current-event", "previous-event"]));
    });

    test("carries over only from the most recent rolled draw", async ({ services }) => {
        const members = { older: SnowflakeUtil.generate().toString(), latest: SnowflakeUtil.generate().toString() };
        for (const [id, endDaysAgo] of [["older", 42], ["latest", 21]] as const) {
            const end = DateTime.now().minus({ days: endDaysAgo });
            await services.repos.prizeRepo.createPrizeDraw(storedDraw({
                id,
                start: end.minus({ days: 14 }).toUTC().toISO(),
                end: end.toUTC().toISO(),
                snapshotTakenAt: end.plus({ days: 1 }).toUTC().toISO(),
                rolledAt: end.plus({ days: 2 }).toUTC().toISO(),
                taskEventIds: [`${id}-event`],
            }));
            await storeEvent(services, `${id}-event`, end, [
                { userId: members[id], status: SubmissionStatus.Bronze, submittedAt: end.minus({ days: 1 }).toJSDate(), reviewedAt: end.plus({ hours: 36 }).toJSDate() },
            ]);
        }
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        expect((await snapshot(services)).participants).toEqual({ [members.latest]: 1 });
        expect(warn).toHaveBeenCalledWith("[PrizeDraw] No task events found in range for snapshot.");
    });
});

describe("rolling a prize draw", () => {
    test("finds no winner without entries", async ({ services }) => {
        await services.repos.prizeRepo.createPrizeDraw(storedDraw({ participants: {}, entries: [], totalEntries: 0 }));

        expect(await rollWinnerForSnapshot(services.repos.prizeRepo, "draw-1", services)).toBeNull();
    });

    test("keeps the winner already rolled", async ({ services }) => {
        await services.repos.prizeRepo.createPrizeDraw(storedDraw({ winnerId: second, rolledAt: DateTime.now().minus({ days: 1 }).toUTC().toISO() }));

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
