import { ApplicationCommandOptionType, InteractionResponseType, MessageFlags } from "discord-api-types/v10";
import { describe, expect, test } from "../../../../tests/fixtures.js";
import { IDS, apiMember } from "../../../../tests/discord/payloads.js";

const admin = { member: apiMember({ roles: [IDS.roles.admin] }) };

describe("/taskdraw", () => {
    test("acknowledges privately before anything else, then asks for the snapshot to roll", async ({ discord, slash }) => {
        const interaction = await slash("taskdraw", [{ type: ApplicationCommandOptionType.String, name: "action", value: "roll" }], admin);

        expect(discord.callbacks(interaction)).toEqual([{ type: InteractionResponseType.DeferredChannelMessageWithSource, data: { flags: MessageFlags.Ephemeral } }]);
        expect(discord.originalEdits(interaction)).toEqual([expect.objectContaining({ content: "You must provide a snapshot ID to roll a winner." })]);
    });
});
