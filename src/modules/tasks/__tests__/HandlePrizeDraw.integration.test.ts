import { SnowflakeUtil } from "discord.js";
import { DateTime } from "luxon";
import { describe, expect, test, vi, type StoringFactories } from "../../../tests/fixtures.js";
import { DiscordError } from "../../../tests/discord/harness.js";
import { IDS, apiRole, apiUser } from "../../../tests/discord/payloads.js";
import { SubmissionStatus } from "../../../models/TaskSubmission.js";
import { announcePrizeDrawWinner, generatePrizeDrawSnapshot, rollWinnerForSnapshot } from "../HandlePrizeDraw.js";

const [winner, second, third, fourth] = [SnowflakeUtil.generate().toString(), SnowflakeUtil.generate().toString(), SnowflakeUtil.generate().toString(), SnowflakeUtil.generate().toString()];

// A finished task event and the submissions made for it
async function storeEvent(factories: StoringFactories, id: string, endTime: DateTime, submissions: Array<{ userId: string; status: SubmissionStatus; submittedAt?: Date; reviewedAt?: Date }>) {
    await factories.taskEvent.create({ id, startTime: endTime.minus({ days: 7 }).toJSDate(), endTime: endTime.toJSDate(), createdAt: endTime.minus({ days: 7 }).toJSDate() });
    for (const [index, submission] of submissions.entries()) {
        await factories.taskSubmission.create({ id: `${id}-${index}`, taskEventId: id, ...submission });
    }
}

// A draw whose snapshot was taken yesterday, the winner holding two of its three entries
const yesterdaysDraw = {
    id: "draw-1",
    start: DateTime.now().minus({ days: 14 }).toUTC().toISO(),
    end: DateTime.now().minus({ days: 1 }).toUTC().toISO(),
    snapshotTakenAt: DateTime.now().minus({ days: 1 }).toUTC().toISO(),
    participants: { [winner]: 2, [second]: 1 },
    entries: [winner, winner, second],
    totalEntries: 3,
    tierCounts: { bronze: 1, silver: 1, gold: 1 },
};

describe("a prize draw snapshot", () => {
    test("gives one entry per task however many times the member upgraded their submission", async ({ services, factories }) => {
        await storeEvent(factories, "pvm", DateTime.now().minus({ days: 2 }), [
            { userId: winner, status: SubmissionStatus.Bronze },
            { userId: winner, status: SubmissionStatus.Silver },
            { userId: winner, status: SubmissionStatus.Gold },
        ]);

        expect(await generatePrizeDrawSnapshot(services.repos.prizeRepo, services.repos.taskRepo)).toMatchObject({ participants: { [winner]: 1 }, totalEntries: 1, tierCounts: { bronze: 0, silver: 0, gold: 1 } });
    });

    test("gives one entry for each task the member completed", async ({ services, factories }) => {
        for (const id of ["pvm", "skilling", "minigame"]) {
            await storeEvent(factories, id, DateTime.now().minus({ days: 2 }), [{ userId: winner, status: SubmissionStatus.Gold }]);
        }

        expect(await generatePrizeDrawSnapshot(services.repos.prizeRepo, services.repos.taskRepo)).toMatchObject({ participants: { [winner]: 3 }, totalEntries: 3 });
    });

    test("leaves out submissions that are pending or rejected", async ({ services, factories }) => {
        await storeEvent(factories, "pvm", DateTime.now().minus({ days: 2 }), [
            { userId: winner, status: SubmissionStatus.Pending },
            { userId: second, status: SubmissionStatus.Rejected },
        ]);

        expect(await generatePrizeDrawSnapshot(services.repos.prizeRepo, services.repos.taskRepo)).toMatchObject({ participants: {}, totalEntries: 0 });
    });

    test("leaves out a task event that is still running", async ({ services, factories }) => {
        await storeEvent(factories, "finished", DateTime.now().minus({ days: 2 }), [{ userId: winner, status: SubmissionStatus.Gold }]);
        await storeEvent(factories, "running", DateTime.now().plus({ hours: 1 }), [{ userId: second, status: SubmissionStatus.Gold }]);

        expect(await generatePrizeDrawSnapshot(services.repos.prizeRepo, services.repos.taskRepo)).toMatchObject({ participants: { [winner]: 1 }, taskEventIds: ["finished"] });
    });

    test("carries over approvals the previous draw's snapshot missed", async ({ services, factories }) => {
        const previousEnd = DateTime.now().minus({ days: 21 });
        const previousSnapshot = previousEnd.plus({ days: 1 });
        await factories.prizeDraw.create({
            ...yesterdaysDraw,
            id: "previous",
            start: previousEnd.minus({ days: 14 }).toUTC().toISO(),
            end: previousEnd.toUTC().toISO(),
            snapshotTakenAt: previousSnapshot.toUTC().toISO(),
            rolledAt: previousSnapshot.plus({ days: 1 }).toUTC().toISO(),
            taskEventIds: ["previous-event"],
        });
        await storeEvent(factories, "previous-event", previousEnd, [
            // Approved after the previous snapshot, before its roll: in neither draw until carried over
            { userId: second, status: SubmissionStatus.Silver, submittedAt: previousEnd.minus({ days: 1 }).toJSDate(), reviewedAt: previousSnapshot.plus({ hours: 1 }).toJSDate() },
            // Approved before the previous snapshot: already counted there
            { userId: third, status: SubmissionStatus.Gold, submittedAt: previousEnd.minus({ days: 1 }).toJSDate(), reviewedAt: previousEnd.minus({ hours: 1 }).toJSDate() },
            // Made after the previous period ended
            { userId: fourth, status: SubmissionStatus.Bronze, submittedAt: previousEnd.plus({ days: 1 }).toJSDate(), reviewedAt: previousEnd.plus({ days: 2 }).toJSDate() },
        ]);
        await storeEvent(factories, "current-event", DateTime.now().minus({ days: 2 }), [{ userId: winner, status: SubmissionStatus.Gold }]);

        const draw = await generatePrizeDrawSnapshot(services.repos.prizeRepo, services.repos.taskRepo);

        expect(draw.participants).toEqual({ [winner]: 1, [second]: 1 });
        expect(draw.taskEventIds).toEqual(expect.arrayContaining(["current-event", "previous-event"]));
    });

    test("carries over only from the most recent rolled draw", async ({ services, factories }) => {
        const members = { older: SnowflakeUtil.generate().toString(), latest: SnowflakeUtil.generate().toString() };
        for (const [id, endDaysAgo] of [["older", 42], ["latest", 21]] as const) {
            const end = DateTime.now().minus({ days: endDaysAgo });
            await factories.prizeDraw.create({
                ...yesterdaysDraw,
                id,
                start: end.minus({ days: 14 }).toUTC().toISO(),
                end: end.toUTC().toISO(),
                snapshotTakenAt: end.plus({ days: 1 }).toUTC().toISO(),
                rolledAt: end.plus({ days: 2 }).toUTC().toISO(),
                taskEventIds: [`${id}-event`],
            });
            await storeEvent(factories, `${id}-event`, end, [
                { userId: members[id], status: SubmissionStatus.Bronze, submittedAt: end.minus({ days: 1 }).toJSDate(), reviewedAt: end.plus({ hours: 36 }).toJSDate() },
            ]);
        }
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        expect((await generatePrizeDrawSnapshot(services.repos.prizeRepo, services.repos.taskRepo)).participants).toEqual({ [members.latest]: 1 });
        expect(warn).toHaveBeenCalledWith("[PrizeDraw] No task events found in range for snapshot.");
    });
});

describe("rolling a prize draw", () => {
    test("finds no winner without entries", async ({ services, factories }) => {
        await factories.prizeDraw.create({ ...yesterdaysDraw, participants: {}, entries: [], totalEntries: 0 });

        expect(await rollWinnerForSnapshot(services.repos.prizeRepo, "draw-1", services)).toBeNull();
    });

    test("keeps the winner already rolled", async ({ services, factories }) => {
        await factories.prizeDraw.create({ ...yesterdaysDraw, winnerId: second, rolledAt: DateTime.now().minus({ days: 1 }).toUTC().toISO() });

        expect(await rollWinnerForSnapshot(services.repos.prizeRepo, "draw-1", services)).toBe(second);
    });

    test("picks a winner by entries, stores them and counts the win", async ({ services, factories }) => {
        vi.spyOn(Math, "random").mockReturnValue(0);
        await factories.prizeDraw.create(yesterdaysDraw);

        expect(await rollWinnerForSnapshot(services.repos.prizeRepo, "draw-1", services)).toBe(winner);
        expect(await services.repos.prizeRepo.getPrizeDrawById("draw-1")).toMatchObject({ winnerId: winner, rolledAt: expect.any(String) });
        expect(await services.repos.userRepo.getUserById(winner)).toMatchObject({ taskPrizesWon: 1 });
    });
});

describe("announcing a prize draw winner", () => {
    test("posts one message mentioning the task role with the winner's embed, and congratulates the winner", async ({ discord, services, factories }) => {
        const taskUser = apiRole({ name: "Task User" });
        await discord.addRole(IDS.guild, taskUser);
        await services.guilds.update(IDS.guild, { roles: { taskUser: taskUser.id } });
        await factories.prizeDraw.create({ ...yesterdaysDraw, winnerId: winner });
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

    test("still posts the winner's embed when no task role is configured", async ({ discord, services, factories }) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        await factories.prizeDraw.create({ ...yesterdaysDraw, winnerId: winner });
        discord.user(apiUser({ id: winner, username: "lucky" }));
        discord.acceptMessages(IDS.channel);
        discord.acceptDirectMessages(winner);

        expect(await announcePrizeDrawWinner(discord.client, services, services.repos.prizeRepo, "draw-1")).toBe(true);

        const [posted] = discord.messagesSentTo(IDS.channel);
        expect(posted?.embeds).toHaveLength(1);
        expect(posted).not.toHaveProperty("content");
        expect(warn).toHaveBeenCalledWith("[PrizeDraw] Task user role not configured or not found.");
    });

    test("reports that the task channel can't be reached instead of posting anywhere else", async ({ discord, services, factories }) => {
        await services.guilds.update(IDS.guild, { channels: { taskChannel: IDS.missingChannel } });
        await factories.prizeDraw.create({ ...yesterdaysDraw, winnerId: winner });
        discord.user(apiUser({ id: winner, username: "lucky" }));
        discord.refuse("GET", `/channels/${IDS.missingChannel}`, DiscordError.unknownChannel);
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        expect(await announcePrizeDrawWinner(discord.client, services, services.repos.prizeRepo, "draw-1")).toBe(false);

        expect(warn).toHaveBeenCalledWith("[PrizeDraw] Announcement channel not found.");
        expect(discord.requests().filter((request) => request.method === "POST")).toEqual([]);
    });
});
