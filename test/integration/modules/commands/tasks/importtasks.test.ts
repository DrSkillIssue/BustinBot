import { ApplicationCommandOptionType } from "discord-api-types/v10";
import { describe, expect, test, vi } from "../../../../fixtures.js";
import { AS, apiAttachment, chatInputInteraction } from "../../../../discord/payloads.js";

const CSV = [
    "ID,Task Name,Category,Type,Skill,Bronze Amount,Silver Amount,Gold Amount,Weight,Short Name,Wilderness Required?",
    "PVM001,Kill {amount} Zulrah,PvM,KC,,10,25,50,,Zulrah,TRUE",
    "PVM002,Kill {amount} Vorkath,PvM,KC,,5,10,20,,Vorkath,FALSE",
].join("\n");

describe("/importtasks", () => {
    test("adds the tasks in the uploaded file that aren't stored yet, leaving stored ones untouched", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        const tasks = services.repos.taskRepo;
        await factories.task.create({ id: "PVM001", taskName: "Already stored" });
        const attachment = apiAttachment({ filename: "tasks.csv", size: CSV.length, content_type: "text/csv" });
        discord.serveAttachment(attachment, Buffer.from(CSV));

        const interaction = await interact(
            chatInputInteraction(
                "importtasks",
                [{ type: ApplicationCommandOptionType.Attachment, name: "file", value: attachment.id }],
                AS.botAdmin,
                { attachments: { [attachment.id]: attachment } },
            ),
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({
                content: "✅ Import complete.\n• 1 new tasks added\n• 1 skipped (existing)\n• 2 total in file.",
            }),
        ]);
        expect(await tasks.getTaskById("PVM001")).toMatchObject({ taskName: "Already stored" });
        expect(await tasks.getTaskById("PVM002")).toMatchObject({ taskName: "Kill {amount} Vorkath", amtGold: 20 });
    });

    test("refuses a file that isn't a CSV", async ({ discord, interact }) => {
        const attachment = apiAttachment({ filename: "tasks.xlsx", size: CSV.length, content_type: "text/csv" });

        const interaction = await interact(
            chatInputInteraction(
                "importtasks",
                [{ type: ApplicationCommandOptionType.Attachment, name: "file", value: attachment.id }],
                AS.botAdmin,
                { attachments: { [attachment.id]: attachment } },
            ),
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Please upload a valid CSV file." }),
        ]);
    });

    test("reports a failed download", async ({ discord, interact, http }) => {
        const attachment = apiAttachment({ filename: "tasks.csv", size: CSV.length, content_type: "text/csv" });
        http.get("https://cdn.discordapp.com")
            .intercept({ path: new URL(attachment.url).pathname, method: "GET" })
            .reply(404, "Not Found");
        const error = vi.spyOn(console, "error").mockImplementation(() => {});

        const interaction = await interact(
            chatInputInteraction(
                "importtasks",
                [{ type: ApplicationCommandOptionType.Attachment, name: "file", value: attachment.id }],
                AS.botAdmin,
                { attachments: { [attachment.id]: attachment } },
            ),
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Import failed. Check logs for details." }),
        ]);
        expect(error).toHaveBeenCalledWith(new Error("Failed to download tasks.csv: HTTP 404"));
    });
});
