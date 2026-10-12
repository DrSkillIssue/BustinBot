import { describe, expect, test } from "vitest";
import { slashCommandPayloads } from "../../../src/utils/registerCommands.js";
import { commandFactory } from "../../factories.js";
import type { Command } from "../../../src/models/Command.js";

describe("slashCommandPayloads", () => {
    test("sends a command registered under aliases only once", () => {
        const bustin = commandFactory.build({ name: "bustin", aliases: ["ping"] });
        const commands = new Map([
            ["bustin", bustin],
            ["ping", bustin],
            ["goodbot", commandFactory.build({ name: "goodbot" })],
        ]);

        expect(slashCommandPayloads(commands).map((payload) => payload.name)).toEqual(["bustin", "goodbot"]);
    });

    test("leaves out prefix-only commands", () => {
        const { slashData: _, ...legacy } = commandFactory.build({ name: "legacy" });
        const commands = new Map<string, Command>([["legacy", legacy]]);

        expect(slashCommandPayloads(commands)).toEqual([]);
    });
});
