import { describe, expect, test } from "../../../tests/fixtures.js";
import { createServiceContainer } from "../ServiceFactory.js";
import { BotStatsService } from "../BotStatsService.js";
import { BotRepository } from "../../database/BotRepo.js";
import { buildTask, buildUserStats } from "../../../tests/fakes/builders.js";

describe("createServiceContainer", () => {
    test("scopes every repository to its guild and shares the bot-wide stats", async ({ db }) => {
        const botStats = new BotStatsService(new BotRepository(db));
        const first = createServiceContainer(db, "guild-a", botStats);
        const second = createServiceContainer(db, "guild-b", botStats);

        await first.repos.taskRepo!.createTask(buildTask({ id: "PVM001" }));
        await first.repos.userRepo!.createUser(buildUserStats({ userId: "user-1" }));

        expect(first.guildId).toBe("guild-a");
        expect((await db.doc("guilds/guild-a/tasks/PVM001").get()).exists).toBe(true);
        expect((await db.doc("guilds/guild-a/userStats/user-1").get()).exists).toBe(true);
        expect(await second.repos.taskRepo!.getTaskById("PVM001")).toBeNull();
        expect(second.botStats).toBe(first.botStats);
    });
});
