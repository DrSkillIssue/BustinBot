import { ApplicationCommandOptionType } from "discord-api-types/v10";
import { describe, expect, test } from "../../../../fixtures.js";
import { AS, IDS } from "../../../../discord/payloads.js";
import { SubmissionStatus } from "../../../../../src/models/TaskSubmission.js";

describe("/testtaskapproval", () => {
    test("posts a test submission for the latest task event for review, with the chosen tier as a hint", async ({
        discord,
        slash,
        services,
        factories,
    }) => {
        const event = await factories.taskEvent.create({ id: "test-PVM001-1" });
        discord.acceptMessages(IDS.channel);

        const command = await slash(
            "testtaskapproval",
            [{ type: ApplicationCommandOptionType.String, name: "tier", value: SubmissionStatus.Silver }],
            AS.botAdmin,
        );

        const [submission, ...others] = await services.repos.taskRepo.getSubmissionsByUser(IDS.user);
        expect(others).toEqual([]);
        expect(submission).toMatchObject({
            taskEventId: event.id,
            status: SubmissionStatus.Pending,
            notes: "[Test] Tier hint: silver",
            message: expect.any(String),
        });
        expect(discord.messagesSentTo(IDS.channel)).toHaveLength(1);
        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({
                content: [
                    `✅ Test submission posted to <#${IDS.channel}>.`,
                    "**Task:** Kill {amount} Zulrah",
                    `**User:** <@${IDS.user}>`,
                    "**Tier hint:** silver",
                    `**Submission ID:** \`${submission!.id}\``,
                ].join("\n"),
            }),
        ]);
    });

    test("says so when the given task event doesn't exist", async ({ discord, slash }) => {
        const command = await slash(
            "testtaskapproval",
            [{ type: ApplicationCommandOptionType.String, name: "taskid", value: "PVM001" }],
            AS.botAdmin,
        );

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({
                content:
                    "❌ Task event `PVM001` not found. This expects an event ID (e.g. `test-PVM001-123456`), not a task ID. Run `/testtask` first, then use the ID from the embed footer.",
            }),
        ]);
    });

    test("says so when there are no task events", async ({ discord, slash }) => {
        const command = await slash("testtaskapproval", [], AS.botAdmin);

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "❌ No task events found. Run `/testtask` first to create one." }),
        ]);
    });
});
