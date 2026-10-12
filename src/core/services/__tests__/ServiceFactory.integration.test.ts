import { describe, expect, test } from "../../../tests/fixtures.js";
import { IDS } from "../../../tests/discord/payloads.js";
import { createServiceContainer } from "../ServiceFactory.js";
import { BotStatsService } from "../BotStatsService.js";
import { BotRepository } from "../../database/BotRepo.js";
import { taskFactory, userStatsFactory } from "../../../tests/factories.js";

describe("createServiceContainer", () => {
    test("scopes every repository to its guild and shares the bot-wide stats", async ({ db }) => {
        const botStats = new BotStatsService(new BotRepository(db));
        const first = createServiceContainer(db, IDS.guild, botStats);
        const second = createServiceContainer(db, IDS.otherGuild, botStats);

        await first.repos.taskRepo.createTask(taskFactory.build({ id: "PVM001" }));
        await first.repos.userRepo.createUser(userStatsFactory.build({ userId: IDS.user }));

        expect(first.guildId).toBe(IDS.guild);
        expect((await db.doc(`guilds/${IDS.guild}/tasks/PVM001`).get()).exists).toBe(true);
        expect((await db.doc(`guilds/${IDS.guild}/userStats/${IDS.user}`).get()).exists).toBe(true);
        expect(await second.repos.taskRepo.getTaskById("PVM001")).toBeNull();
        expect(second.botStats).toBe(first.botStats);
    });
});
