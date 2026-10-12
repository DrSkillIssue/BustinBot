import { describe, expect, test } from "../../../../fixtures.js";
import { AS, IDS } from "../../../../discord/payloads.js";

describe("/testtask", () => {
    test("posts a week-long test task event in the channel and stores it", async ({ discord, slash, services }) => {
        discord.acceptMessages(IDS.channel);

        const command = await slash("testtask", [], AS.botAdmin);

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "Test task event posted!" }),
        ]);
        const event = await services.repos.taskRepo.getLatestTaskEvent();
        expect(event?.id).toMatch(new RegExp(`^test-${event?.task.id}-\\d+$`));
        expect(event!.endTime.getTime() - event!.startTime.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
        expect(discord.messagesSentTo(IDS.channel)).toEqual([
            expect.objectContaining({
                embeds: [
                    expect.objectContaining({
                        footer: { text: `Ends ${event!.endTime.toUTCString()} • ${event!.id}` },
                    }),
                ],
            }),
        ]);
    });
});
