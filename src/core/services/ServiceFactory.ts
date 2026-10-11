import { BotRepository } from "../database/BotRepo.js";
import { TaskRepository } from "../database/TaskRepo.js";
import { PrizeDrawRepository } from "../database/PrizeDrawRepo.js";
import { KeywordRepository } from "../database/KeywordRepo.js";
import { BotStatsService } from "./BotStatsService.js";
import { TaskService } from "../../modules/tasks/TaskService.js";
import { TaskEventStore } from "../../modules/tasks/TaskEventStore.js";
import { KeywordSelector } from "../../modules/tasks/KeywordSelector.js";
import { MovieRepository } from "../database/MovieRepo.js";
import { GuildRepository } from "../database/GuildRepo.js";
import { GuildService } from "./GuildService.js";
import type { ServiceContainer } from "./ServiceContainer.js";
import type { Firestore } from "firebase-admin/firestore";
import { UserRepository } from "../database/UserRepo.js";
import { TaskLeaderboardRepository } from "../database/TaskLeaderboardRepo.js";

export async function createServiceContainer(db: Firestore, guildId: string): Promise<ServiceContainer> {
    const botRepo = new BotRepository(db);
    const guildRepo = new GuildRepository(db);
    const taskRepo = new TaskRepository(db, guildId);
    const prizeRepo = new PrizeDrawRepository(db, guildId);
    const keywordRepo = new KeywordRepository(db, guildId);
    const movieRepo = new MovieRepository(db, guildId);
    const userRepo = new UserRepository(db, guildId);
    const taskLeaderboardRepo = new TaskLeaderboardRepository(db, guildId);

    const botStats = new BotStatsService(botRepo);
    await botStats.init();

    const guilds = new GuildService(guildRepo);
    const tasks = new TaskService(taskRepo);
    const taskEvents = new TaskEventStore(taskRepo);
    const keywords = new KeywordSelector(keywordRepo);

    const services: ServiceContainer = {
        guildId,
        botStats,
        tasks,
        taskEvents,
        keywords,
        guilds,
        repos: { taskRepo, prizeRepo, movieRepo, keywordRepo, guildRepo, userRepo, taskLeaderboardRepo },
    };

    return services;
}
