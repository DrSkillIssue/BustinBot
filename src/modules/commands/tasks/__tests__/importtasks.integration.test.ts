import { ApplicationCommandOptionType } from "discord-api-types/v10";
import { describe, expect, test, vi } from "../../../../tests/fixtures.js";
import { mockAgent } from "../../../../tests/http.js";
import { IDS, apiMember, chatInputInteraction, nextId } from "../../../../tests/discord/payloads.js";
import { buildTask } from "../../../../tests/fakes/builders.js";

const admin = { member: apiMember({ roles: [IDS.roles.admin] }) };
const CSV = [
    "ID,Task Name,Category,Type,Skill,Bronze Amount,Silver Amount,Gold Amount,Weight,Short Name,Wilderness Required?",
    "PVM001,Kill {amount} Zulrah,PvM,KC,,10,25,50,,Zulrah,TRUE",
    "PVM002,Kill {amount} Vorkath,PvM,KC,,5,10,20,,Vorkath,FALSE",
].join("\n");

// /importtasks with an uploaded file, as Discord delivers it with the attachment resolved
function importWith(filename: string) {
    const id = nextId();
    const url = `https://cdn.discordapp.com/attachments/${IDS.channel}/${id}/${filename}`;
    const interaction = chatInputInteraction(
        "importtasks",
        [{ type: ApplicationCommandOptionType.Attachment, name: "file", value: id }],
        admin,
        { attachments: { [id]: { id, filename, size: CSV.length, url, proxy_url: url } } },
    );
    return { interaction, path: new URL(url).pathname };
}

describe("/importtasks", () => {
    test("adds the tasks in the uploaded file that aren't stored yet, leaving stored ones untouched", async ({ discord, interact, services }) => {
        const tasks = services.repos.taskRepo;
        await tasks.createTask(buildTask({ id: "PVM001", taskName: "Already stored" }));
        const upload = importWith("tasks.csv");
        mockAgent().get("https://cdn.discordapp.com").intercept({ path: upload.path, method: "GET" }).reply(200, CSV);

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

    test("reports a failed download", async ({ discord, interact }) => {
        const upload = importWith("tasks.csv");
        mockAgent().get("https://cdn.discordapp.com").intercept({ path: upload.path, method: "GET" }).reply(404, "Not Found");
        const error = vi.spyOn(console, "error").mockImplementation(() => {});

        const interaction = await interact(upload.interaction);

        expect(discord.originalEdits(interaction)).toEqual([expect.objectContaining({ content: "Import failed. Check logs for details." })]);
        expect(error).toHaveBeenCalledWith(new Error("Failed to download tasks.csv: HTTP 404"));
    });
});
