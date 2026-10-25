import { Routes } from "discord-api-types/v10";
import { describe, expect, test } from "../fixtures.js";
import { IDS } from "../discord/payloads.js";
import { registerGlobalCommands, slashCommandPayloads } from "../../src/utils/registerCommands.js";

const globalCommands = Routes.applicationCommands(IDS.application);
const guildCommands = Routes.applicationGuildCommands(IDS.application, IDS.guild);

describe("registering the slash commands globally", () => {
    test("sends every command to Discord's global list and clears the guild's own copies", async ({
        discord,
        commands,
    }) => {
        discord.acceptCommandSync(globalCommands);
        discord.acceptCommandSync(guildCommands);

        await registerGlobalCommands(discord.client.rest, IDS.application, commands, IDS.guild);

        expect(discord.commandUpdates(globalCommands)).toEqual([slashCommandPayloads(commands)]);
        expect(discord.commandUpdates(guildCommands)).toEqual([[]]);
    });

    test("leaves guild commands alone when no guild is given", async ({ discord, commands }) => {
        discord.acceptCommandSync(globalCommands);

        await registerGlobalCommands(discord.client.rest, IDS.application, commands, null);

        expect(discord.commandUpdates(globalCommands)).toHaveLength(1);
        expect(discord.commandUpdates(guildCommands)).toEqual([]);
    });
});
