import { DateTime } from "luxon";
import { beforeEach, describe, expect, test, vi } from "../fixtures.js";
import { IDS } from "../discord/payloads.js";
import {
    getNextEventDate,
    getNextPollDate,
    getNextPrizeDrawDate,
    initTaskScheduler,
} from "../../src/modules/tasks/TaskScheduler.js";

const atMinute = (minute: number): Date =>
    DateTime.now().set({ hour: 12, minute, second: 0, millisecond: 0 }).toJSDate();

describe("the dev-mode task cycle", () => {
    beforeEach(() => {
        vi.stubEnv("BOT_MODE", "dev");
        vi.stubEnv("DISCORD_GUILD_ID_DEV", IDS.guild);
    });

    test("reports when its next poll, task start and prize draw come", async ({ discord, services }) => {
        vi.setSystemTime(atMinute(2));

        await initTaskScheduler(discord.client, services);

        expect([getNextPollDate(), getNextEventDate(), getNextPrizeDrawDate()]).toEqual([
            atMinute(6),
            atMinute(7),
            atMinute(15),
        ]);
    });
});
