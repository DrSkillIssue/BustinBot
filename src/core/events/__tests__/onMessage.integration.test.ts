import { describe, expect, test, vi } from "../../../tests/fixtures.js";
import { DiscordError } from "../../../tests/discord/harness.js";
import { handleMessage } from "../onMessage.js";
import { CommandModule, CommandRole, type Command } from "../../../models/Command.js";
import { IDS, apiMember, apiUser, messageCreate } from "../../../tests/discord/payloads.js";

// A prefix command that always throws
const failing: Command = {
    name: "fail",
    description: "Always fails",
    module: CommandModule.Core,
    allowedRoles: [CommandRole.Everyone],
    execute: async () => { throw new Error("boom"); },
};
const { user: _user, permissions: _permissions, ...botAdmin } = apiMember({ roles: [IDS.roles.admin] });

describe("prefix commands", () => {
    test("!goodbot replies with an emoji then posts the praise count", async ({ discord, prefix }) => {
        discord.acceptMessages(IDS.channel);
        const message = await prefix("!goodbot");

        expect(discord.messagesSentTo(IDS.channel)).toEqual([
            expect.objectContaining({ content: "🥹", message_reference: expect.objectContaining({ message_id: message.id }) }),
            expect.objectContaining({ content: "*BustinBot has been called a good bot 1 time!*" }),
        ]);
    });

    test("ignores messages without the prefix, from bots, or for unknown commands", async ({ discord, prefix }) => {
        await prefix("goodbot");
        await prefix("!goodbot", { author: apiUser({ id: IDS.bot, bot: true }) });
        await prefix("!unknown");

        expect(discord.requests()).toEqual([]);
    });

    test("refuses a restricted command to members without the role", async ({ discord, prefix }) => {
        discord.acceptMessages(IDS.channel);
        await prefix("!sendas");

        expect(discord.messagesSentTo(IDS.channel)).toEqual([
            expect.objectContaining({ content: "You don't have permission to use this command." }),
        ]);
    });

    test("runs a restricted command for members with the role", async ({ discord, prefix }) => {
        discord.acceptMessages(IDS.channel);
        await prefix("!sendas", { member: botAdmin });

        expect(discord.messagesSentTo(IDS.channel)).toEqual([
            expect.objectContaining({ content: expect.stringContaining("replaced with a slash command") }),
        ]);
    });

    test("tells the member when a command fails", async ({ discord, services }) => {
        discord.acceptMessages(IDS.channel);
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const message = await discord.sendMessage(messageCreate("!fail"));

        await handleMessage(message, new Map([["fail", failing]]), services);

        expect(discord.messagesSentTo(IDS.channel)).toEqual([
            expect.objectContaining({ content: "There was an error executing that command." }),
        ]);
        expect(error).toHaveBeenCalledWith("[Command Error]: fail", expect.objectContaining({ message: "boom" }));
    });

    test("survives Discord rejecting the error reply", async ({ discord, services }) => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        discord.refuse("POST", `/channels/${IDS.channel}/messages`, DiscordError.missingPermissions);
        const message = await discord.sendMessage(messageCreate("!fail"));

        await expect(handleMessage(message, new Map([["fail", failing]]), services)).resolves.toBeUndefined();
        expect(error).toHaveBeenCalledWith("[Command Error]: fail", expect.any(Error));
        expect(error).toHaveBeenCalledWith("[Command Error]: fail: could not send the error reply", expect.objectContaining({ status: 403 }));
    });
});
