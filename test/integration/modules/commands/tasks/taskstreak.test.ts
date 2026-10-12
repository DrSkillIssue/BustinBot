import { TimestampStyles, time } from "discord.js";
import { DateTime } from "luxon";
import { describe, expect, test } from "../../../../fixtures.js";
import { IDS, chatInputInteraction } from "../../../../discord/payloads.js";
import { SubmissionStatus } from "../../../../../src/models/TaskSubmission.js";

describe("/taskstreak", () => {
    test("shows a streak kept for this week once the week's task is approved", async ({
        discord,
        interact,
        factories,
    }) => {
        const event = await factories.taskEvent.running().create({
            id: "week-1",
        });
        await factories.taskSubmission.create({
            taskEventId: event.id,
            userId: IDS.user,
            status: SubmissionStatus.Bronze,
            submittedAt: DateTime.now().minus({ hours: 1 }).toJSDate(),
        });

        const command = await interact(chatInputInteraction("taskstreak"));

        expect(discord.originalEdits(command)[0]?.embeds?.[0]?.fields).toEqual([
            { name: "🔥 Current Streak", value: "1", inline: true },
            { name: "🏅 Longest Streak", value: "1", inline: true },
            {
                name: "⏰ Deadline",
                value: expect.stringMatching(
                    new RegExp(
                        `^✅ Streak kept active for this period\\. Period ends ${time(event.endTime, TimestampStyles.LongDateTime)}`,
                    ),
                ),
                inline: false,
            },
        ]);
    });

    test("tells a member who hasn't submitted this week when the period ends", async ({
        discord,
        interact,
        factories,
    }) => {
        const event = await factories.taskEvent.running().create({
            id: "week-1",
        });

        const command = await interact(chatInputInteraction("taskstreak"));

        expect(discord.originalEdits(command)[0]?.embeds?.[0]?.fields?.[2]?.value).toMatch(
            new RegExp(`^⏳ Submit before ${time(event.endTime, TimestampStyles.LongDateTime)}`),
        );
    });

    test("shows the streak stored for the member, and no deadline outside a task period", async ({
        discord,
        interact,
        factories,
    }) => {
        await factories.userStats.create({ userId: IDS.user, taskStreak: 7, longestTaskStreak: 9 });

        const command = await interact(chatInputInteraction("taskstreak"));

        expect(discord.originalEdits(command)[0]?.embeds?.[0]?.fields).toEqual([
            { name: "🔥 Current Streak", value: "7", inline: true },
            { name: "🏅 Longest Streak", value: "9", inline: true },
            { name: "⏰ Deadline", value: "No active task period right now.", inline: false },
        ]);
    });
});
