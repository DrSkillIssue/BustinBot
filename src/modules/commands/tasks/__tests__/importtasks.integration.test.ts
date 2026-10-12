import { ApplicationCommandOptionType } from "discord-api-types/v10";
import { describe, expect, test, vi } from "../../../../tests/fixtures.js";
import { IDS, apiAttachment, chatInputInteraction, apiMember } from "../../../../tests/discord/payloads.js";

const admin = { member: apiMember({ roles: [IDS.roles.admin] }) };
const CSV = [
    "ID,Task Name,Category,Type,Skill,Bronze Amount,Silver Amount,Gold Amount,Weight,Short Name,Wilderness Required?",
    "PVM001,Kill {amount} Zulrah,PvM,KC,,10,25,50,,Zulrah,TRUE",
    "PVM002,Kill {amount} Vorkath,PvM,KC,,5,10,20,,Vorkath,FALSE",
].join("\n");

// /importtasks with an uploaded file, as Discord delivers it with the attachment resolved
function importWith(filename: string) {
    const attachment = apiAttachment({ filename, size: CSV.length, content_type: "text/csv" });
    const interaction = chatInputInteraction(
        "importtasks",
        [{ type: ApplicationCommandOptionType.Attachment, name: "file", value: attachment.id }],
        admin,
        { attachments: { [attachment.id]: attachment } },
    );
    return { interaction, attachment };
}

describe("/importtasks", () => {
    test("adds the tasks in the uploaded file that aren't stored yet, leaving stored ones untouched", async ({ discord, interact, services, factories }) => {
        const tasks = services.repos.taskRepo;
        await factories.task.create({ id: "PVM001", taskName: "Already stored" });
        const upload = importWith("tasks.csv");
        discord.serveAttachment(upload.attachment, Buffer.from(CSV));

        const interaction = await interact(upload.interaction);

        expect(discord.originalEdits(interaction)).toEqual([expect.objectContaining({
            content: "✅ Import complete.\n• 1 new tasks added\n• 1 skipped (existing)\n• 2 total in file.",
        })]);
        expect(await tasks.getTaskById("PVM001")).toMatchObject({ taskName: "Already stored" });
        expect(await tasks.getTaskById("PVM002")).toMatchObject({ taskName: "Kill {amount} Vorkath", amtGold: 20 });
    });

    test("refuses a file that isn't a CSV", async ({ discord, interact }) => {
        const interaction = await interact(importWith("tasks.xlsx").interaction);

        expect(discord.originalEdits(interaction)).toEqual([expect.objectContaining({ content: "Please upload a valid CSV file." })]);
    });

    test("reports a failed download", async ({ discord, interact, http }) => {
        const upload = importWith("tasks.csv");
        http.get("https://cdn.discordapp.com").intercept({ path: new URL(upload.attachment.url).pathname, method: "GET" }).reply(404, "Not Found");
        const error = vi.spyOn(console, "error").mockImplementation(() => {});

        const interaction = await interact(upload.interaction);

        expect(discord.originalEdits(interaction)).toEqual([expect.objectContaining({ content: "Import failed. Check logs for details." })]);
        expect(error).toHaveBeenCalledWith(new Error("Failed to download tasks.csv: HTTP 404"));
    });
});
