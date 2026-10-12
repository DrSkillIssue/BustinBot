import { ApplicationCommandOptionType } from "discord-api-types/v10";
import { SnowflakeUtil } from "discord.js";
import { DateTime } from "luxon";
import { describe, expect, test } from "../../../../fixtures.js";
import { TaskCategory } from "../../../../../src/models/Task.js";
import { SubmissionStatus } from "../../../../../src/models/TaskSubmission.js";

describe("/mytask", () => {
    test("lists the member's submissions for the running task events, newest first", async ({
        discord,
        slash,
        factories,
    }) => {
        const running = {
            startTime: DateTime.now().minus({ days: 1 }).toJSDate(),
            endTime: DateTime.now().plus({ days: 6 }).toJSDate(),
        };
        const pvm = await factories.taskEvent.create({
            id: "pvm-week",
            task: { id: "PVM001", category: TaskCategory.PvM },
            ...running,
        });
        const skilling = await factories.taskEvent.create({
            id: "skilling-week",
            task: { id: "SKL001", category: TaskCategory.Skilling },
            ...running,
        });
        await factories.taskSubmission.create({
            id: "older",
            taskEventId: pvm.id,
            taskName: "Kill 50 Zulrah",
            status: SubmissionStatus.Gold,
            createdAt: DateTime.now().minus({ hours: 5 }).toJSDate(),
        });
        await factories.taskSubmission.create({
            id: "newer",
            taskEventId: skilling.id,
            taskName: "Gain 100k Mining XP",
            status: SubmissionStatus.Pending,
            createdAt: DateTime.now().minus({ hours: 1 }).toJSDate(),
        });
        await factories.taskSubmission.create({
            id: "someone-elses",
            taskEventId: pvm.id,
            userId: SnowflakeUtil.generate().toString(),
        });

        const command = await slash("mytask");

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({
                content: [
                    "**Your Active Task Submissions:**",
                    "",
                    "• Gain 100k Mining XP: **Pending** ⏳",
                    "• Kill 50 Zulrah: **Approved for Gold** 🥇",
                ].join("\n"),
            }),
        ]);
    });

    test("says so when the member has nothing for the chosen category's running task", async ({
        discord,
        slash,
        factories,
    }) => {
        await factories.taskEvent.create({
            id: "pvm-week",
            task: { category: TaskCategory.PvM },
            startTime: DateTime.now().minus({ days: 1 }).toJSDate(),
            endTime: DateTime.now().plus({ days: 6 }).toJSDate(),
        });

        const command = await slash("mytask", [
            { type: ApplicationCommandOptionType.String, name: "task_event", value: "current_pvm" },
        ]);

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "You have no submissions for the current PvM task event." }),
        ]);
    });

    test("says so when no task event is running", async ({ discord, slash, factories }) => {
        await factories.taskEvent.create({
            endTime: DateTime.now().minus({ days: 1 }).toJSDate(),
            startTime: DateTime.now().minus({ days: 8 }).toJSDate(),
        });

        const command = await slash("mytask");

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "There are no active task events at the moment." }),
        ]);
    });
});
