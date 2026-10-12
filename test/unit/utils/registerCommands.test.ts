import { SlashCommandBuilder } from "discord.js";
import { describe, expect, test } from "vitest";
import { slashCommandPayloads } from "../../../src/utils/registerCommands.js";
import { CommandModule, CommandRole, type Command } from "../../../src/models/Command.js";

function command(name: string, overrides: Partial<Command> = {}): Command {
    return {
        name,
        description: name,
        module: CommandModule.Core,
        allowedRoles: [CommandRole.Everyone],
        slashData: new SlashCommandBuilder().setName(name).setDescription(name),
        execute: async () => {},
        ...overrides,
    };
}

describe("slashCommandPayloads", () => {
    test("sends a command registered under aliases only once", () => {
        const bustin = command("bustin", { aliases: ["ping"] });
        const commands = new Map([
            ["bustin", bustin],
            ["ping", bustin],
            ["goodbot", command("goodbot")],
        ]);

        expect(slashCommandPayloads(commands).map((payload) => payload.name)).toEqual(["bustin", "goodbot"]);
    });

    test("leaves out prefix-only commands", () => {
        const { slashData: _, ...legacy } = command("legacy");
        const commands = new Map<string, Command>([["legacy", legacy]]);

        expect(slashCommandPayloads(commands)).toEqual([]);
    });
});
