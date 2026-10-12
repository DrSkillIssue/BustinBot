import { DateTime } from "luxon";
import { ApplicationCommandOptionType } from "discord-api-types/v10";
import { describe, expect, test, vi } from "../../../../fixtures.js";
import { PRIVATE_DEFERRAL } from "../../../../discord/harness.js";
import { AS, IDS, apiUser } from "../../../../discord/payloads.js";
import { SubmissionStatus } from "../../../../../src/models/TaskSubmission.js";

describe("/taskdraw", () => {
    test("acknowledges privately before anything else, then asks for the snapshot to roll", async ({
        discord,
        slash,
    }) => {
        const interaction = await slash(
            "taskdraw",
            [{ type: ApplicationCommandOptionType.String, name: "action", value: "roll" }],
            AS.botAdmin,
        );

        expect(discord.callbacks(interaction)).toEqual([PRIVATE_DEFERRAL]);
        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "You must provide a snapshot ID to roll a winner." }),
        ]);
    });

    test("snapshots the entries of the last fortnight's finished tasks", async ({
        discord,
        slash,
        services,
        factories,
    }) => {
        const event = await factories.taskEvent.create({
            id: "pvm",
            startTime: DateTime.now().minus({ days: 9 }).toJSDate(),
            endTime: DateTime.now().minus({ days: 2 }).toJSDate(),
        });
        await factories.taskSubmission.create({ taskEventId: event.id, status: SubmissionStatus.Gold });

        const interaction = await slash(
            "taskdraw",
            [{ type: ApplicationCommandOptionType.String, name: "action", value: "snapshot" }],
            AS.botAdmin,
        );

        const [draw] = await services.repos.prizeRepo.getAllPrizeDraws();
        expect(draw).toMatchObject({ participants: { [IDS.user]: 1 }, totalEntries: 1 });
        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: `Snapshot created for period **${draw?.id}** with **1** entries.` }),
        ]);
    });

    test("rolls the winner of a snapshot", async ({ discord, slash, factories }) => {
        const draw = await factories.prizeDraw.create({
            participants: { [IDS.user]: 1 },
            entries: [IDS.user],
            totalEntries: 1,
        });

        const interaction = await slash(
            "taskdraw",
            [
                { type: ApplicationCommandOptionType.String, name: "action", value: "roll" },
                { type: ApplicationCommandOptionType.String, name: "snapshot_id", value: draw.id },
            ],
            AS.botAdmin,
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: `Winner rolled for **${draw.id}**: <@${IDS.user}>` }),
        ]);
    });

    test("says so when a snapshot has no entries to roll", async ({ discord, slash, factories }) => {
        const draw = await factories.prizeDraw.create();

        const interaction = await slash(
            "taskdraw",
            [
                { type: ApplicationCommandOptionType.String, name: "action", value: "roll" },
                { type: ApplicationCommandOptionType.String, name: "snapshot_id", value: draw.id },
            ],
            AS.botAdmin,
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: `No eligible entries found for **${draw.id}**.` }),
        ]);
    });

    test("announces a rolled winner", async ({ discord, slash, factories }) => {
        const draw = await factories.prizeDraw.create({ entries: [IDS.user], totalEntries: 1, winnerId: IDS.user });
        discord.acceptMessages(IDS.channel);
        discord.acceptDirectMessages(apiUser({ id: IDS.user }));

        const interaction = await slash(
            "taskdraw",
            [
                { type: ApplicationCommandOptionType.String, name: "action", value: "announce" },
                { type: ApplicationCommandOptionType.String, name: "snapshot_id", value: draw.id },
            ],
            AS.botAdmin,
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: `Announcement sent for **${draw.id}**.` }),
        ]);
        expect(discord.messagesSentTo(IDS.channel)).toHaveLength(1);
    });

    test("says so when the winner can't be announced", async ({ discord, slash, factories }) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const draw = await factories.prizeDraw.create();

        const interaction = await slash(
            "taskdraw",
            [
                { type: ApplicationCommandOptionType.String, name: "action", value: "announce" },
                { type: ApplicationCommandOptionType.String, name: "snapshot_id", value: draw.id },
            ],
            AS.botAdmin,
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({
                content: `Unable to announce winner for **${draw.id}**. Ensure a winner has been rolled and the announcement channel exists.`,
            }),
        ]);
        expect(warn).toHaveBeenCalledWith("[PrizeDraw] Cannot announce winner - snapshot or winner not found.");
    });
});
