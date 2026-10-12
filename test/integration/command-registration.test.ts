import { describe, expect, test } from "../fixtures.js";
import { IDS } from "../discord/payloads.js";
import { registerGlobalCommands, slashCommandPayloads } from "../../src/utils/registerCommands.js";

describe("registering the slash commands globally", () => {
    test("sends every command to Discord's global list and clears the guild's own copies", async ({
        discord,
        commands,
    }) => {
        discord.acceptCommandSync();
        discord.acceptCommandSync(IDS.guild);

        await registerGlobalCommands(discord.client.rest, IDS.application, commands, IDS.guild);

        expect(discord.commandUpdates()).toEqual([slashCommandPayloads(commands)]);
        expect(discord.commandUpdates(IDS.guild)).toEqual([[]]);
    });

    test("leaves guild commands alone when no guild is given", async ({ discord, commands }) => {
        discord.acceptCommandSync();

        await registerGlobalCommands(discord.client.rest, IDS.application, commands, null);

        expect(discord.commandUpdates()).toHaveLength(1);
        expect(discord.commandUpdates(IDS.guild)).toEqual([]);
    });
});
