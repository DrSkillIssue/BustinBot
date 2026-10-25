import { SnowflakeUtil } from "discord.js";
import { DateTime } from "luxon";
import { describe, expect, vi, type StoringFactories, test } from "../fixtures.js";
import { PRIVATE_DEFERRAL } from "../discord/harness.js";
import { IDS, AS, chatInputInteraction } from "../discord/payloads.js";
import { SubmissionStatus } from "../../src/models/TaskSubmission.js";
import { generatePrizeDrawSnapshot, rollWinnerForSnapshot } from "../../src/modules/tasks/HandlePrizeDraw.js";
import assert from "node:assert";
import { ApplicationCommandOptionType } from "discord-api-types/v10";

const [winner, second] = [SnowflakeUtil.generate().toString(), SnowflakeUtil.generate().toString()];

async function storeEvent(
    factories: StoringFactories,
    id: string,
    endTime: DateTime,
    submissions: Array<{ userId: string; status: SubmissionStatus; submittedAt?: Date; reviewedAt?: Date }>,
) {
    await factories.taskEvent.create({
        id,
        endTime: endTime.toJSDate(),
    });
    for (const [index, submission] of submissions.entries()) {
        await factories.taskSubmission.create({ id: `${id}-${index}`, taskEventId: id, ...submission });
    }
}

const yesterdaysDraw = {
    id: "draw-1",
    start: DateTime.now().minus({ days: 14 }).toJSDate().toISOString(),
    end: DateTime.now().minus({ days: 1 }).toJSDate().toISOString(),
    snapshotTakenAt: DateTime.now().minus({ days: 1 }).toJSDate().toISOString(),
    participants: { [winner]: 2, [second]: 1 },
    entries: [winner, winner, second],
    totalEntries: 3,
    tierCounts: { bronze: 1, silver: 1, gold: 1 },
};

describe("a prize draw snapshot", () => {
    test("gives one entry per task however many times the member upgraded their submission", async ({
        services,
        factories,
    }) => {
        await storeEvent(factories, "pvm", DateTime.now().minus({ days: 2 }), [
            { userId: winner, status: SubmissionStatus.Bronze },
            { userId: winner, status: SubmissionStatus.Silver },
            { userId: winner, status: SubmissionStatus.Gold },
        ]);

        expect(await generatePrizeDrawSnapshot(services.repos.prizeRepo, services.repos.taskRepo)).toMatchObject({
            participants: { [winner]: 1 },
            totalEntries: 1,
            tierCounts: { bronze: 0, silver: 0, gold: 1 },
        });
    });

    test("gives one entry for each task the member completed", async ({ services, factories }) => {
        for (const id of ["pvm", "skilling", "minigame"]) {
            await storeEvent(factories, id, DateTime.now().minus({ days: 2 }), [
                { userId: winner, status: SubmissionStatus.Gold },
            ]);
        }

        expect(await generatePrizeDrawSnapshot(services.repos.prizeRepo, services.repos.taskRepo)).toMatchObject({
            participants: { [winner]: 3 },
            totalEntries: 3,
        });
    });

    test("leaves out submissions that are pending or rejected", async ({ services, factories }) => {
        await storeEvent(factories, "pvm", DateTime.now().minus({ days: 2 }), [
            { userId: winner, status: SubmissionStatus.Pending },
            { userId: second, status: SubmissionStatus.Rejected },
        ]);

        expect(await generatePrizeDrawSnapshot(services.repos.prizeRepo, services.repos.taskRepo)).toMatchObject({
            participants: {},
            totalEntries: 0,
        });
    });
});

describe("rolling a prize draw", () => {
    test("keeps the winner already rolled", async ({ services, factories }) => {
        await factories.prizeDraw.create({
            ...yesterdaysDraw,
            winnerId: second,
            rolledAt: DateTime.now().minus({ days: 1 }).toJSDate().toISOString(),
        });

        expect(await rollWinnerForSnapshot(services.repos.prizeRepo, "draw-1", services)).toBe(second);
    });

    test("picks a winner by entries, stores them and counts the win", async ({ services, factories }) => {
        vi.spyOn(Math, "random").mockReturnValue(0);
        await factories.prizeDraw.create(yesterdaysDraw);

        expect(await rollWinnerForSnapshot(services.repos.prizeRepo, "draw-1", services)).toBe(winner);
        expect(await services.repos.prizeRepo.getPrizeDrawById("draw-1")).toMatchObject({
            winnerId: winner,
            rolledAt: expect.any(String),
        });
        expect(await services.repos.userRepo.getUserById(winner)).toMatchObject({ taskPrizesWon: 1 });
    });
});

describe("/taskdraw", () => {
    test("acknowledges privately before anything else, then asks for the snapshot to roll", async ({
        discord,
        interact,
    }) => {
        const interaction = await interact(
            chatInputInteraction(
                "taskdraw",
                [{ type: ApplicationCommandOptionType.String, name: "action", value: "roll" }],
                AS.botAdmin,
            ),
        );

        expect(discord.callbacks(interaction)).toEqual([PRIVATE_DEFERRAL]);
        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "You must provide a snapshot ID to roll a winner." }),
        ]);
    });

    test("snapshots the entries of the last fortnight's finished tasks", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        await storeEvent(factories, "pvm", DateTime.now().minus({ days: 2 }), [
            { userId: IDS.user, status: SubmissionStatus.Gold },
        ]);

        const interaction = await interact(
            chatInputInteraction(
                "taskdraw",
                [{ type: ApplicationCommandOptionType.String, name: "action", value: "snapshot" }],
                AS.botAdmin,
            ),
        );

        const [draw] = await services.repos.prizeRepo.getAllPrizeDraws();
        assert(draw);
        expect(draw).toMatchObject({ participants: { [IDS.user]: 1 }, totalEntries: 1 });
        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: `Snapshot created for period **${draw.id}** with **1** entries.` }),
        ]);
    });

    test("rolls the winner of a snapshot", async ({ discord, interact, factories }) => {
        const draw = await factories.prizeDraw.create({
            participants: { [IDS.user]: 1 },
            entries: [IDS.user],
            totalEntries: 1,
        });

        const interaction = await interact(
            chatInputInteraction(
                "taskdraw",
                [
                    { type: ApplicationCommandOptionType.String, name: "action", value: "roll" },
                    { type: ApplicationCommandOptionType.String, name: "snapshot_id", value: draw.id },
                ],
                AS.botAdmin,
            ),
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: `Winner rolled for **${draw.id}**: <@${IDS.user}>` }),
        ]);
    });

    test("says so when a snapshot has no entries to roll", async ({ discord, interact, factories }) => {
        const draw = await factories.prizeDraw.create({ participants: {}, entries: [], totalEntries: 0 });

        const interaction = await interact(
            chatInputInteraction(
                "taskdraw",
                [
                    { type: ApplicationCommandOptionType.String, name: "action", value: "roll" },
                    { type: ApplicationCommandOptionType.String, name: "snapshot_id", value: draw.id },
                ],
                AS.botAdmin,
            ),
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: `No eligible entries found for **${draw.id}**.` }),
        ]);
    });

    test("says so when the winner can't be announced", async ({ discord, interact, factories }) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const draw = await factories.prizeDraw.create({
            participants: { [IDS.user]: 1 },
            entries: [IDS.user],
            totalEntries: 1,
        });

        const interaction = await interact(
            chatInputInteraction(
                "taskdraw",
                [
                    { type: ApplicationCommandOptionType.String, name: "action", value: "announce" },
                    { type: ApplicationCommandOptionType.String, name: "snapshot_id", value: draw.id },
                ],
                AS.botAdmin,
            ),
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({
                content: `Unable to announce winner for **${draw.id}**. Ensure a winner has been rolled and the announcement channel exists.`,
            }),
        ]);
        expect(warn).toHaveBeenCalledWith("[PrizeDraw] Cannot announce winner - snapshot or winner not found.");
    });
});
