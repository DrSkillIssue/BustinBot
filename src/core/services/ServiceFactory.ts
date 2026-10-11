import { TaskRepository } from "../database/TaskRepo.js";
import { PrizeDrawRepository } from "../database/PrizeDrawRepo.js";
import { KeywordRepository } from "../database/KeywordRepo.js";
import type { BotStatsService } from "./BotStatsService.js";
import { TaskService } from "../../modules/tasks/TaskService.js";
import { TaskEventStore } from "../../modules/tasks/TaskEventStore.js";
import { KeywordSelector } from "../../modules/tasks/KeywordSelector.js";
import { MovieRepository } from "../database/MovieRepo.js";
import { GuildRepository } from "../database/GuildRepo.js";
import { GuildService } from "./GuildService.js";
import { SetupService } from "./SetupService.js";
import type { ServiceContainer } from "./ServiceContainer.js";
import type { Firestore } from "firebase-admin/firestore";
import { UserRepository } from "../database/UserRepo.js";
import { TaskLeaderboardRepository } from "../database/TaskLeaderboardRepo.js";

// Services for one guild. Bot-wide stats are shared across guilds, so the caller creates them once and passes them in.
export function createServiceContainer(db: Firestore, guildId: string, botStats: BotStatsService): ServiceContainer {
    const guildRepo = new GuildRepository(db);
    const taskRepo = new TaskRepository(db, guildId);
    const prizeRepo = new PrizeDrawRepository(db, guildId);
    const keywordRepo = new KeywordRepository(db, guildId);
    const movieRepo = new MovieRepository(db, guildId);
    const userRepo = new UserRepository(db, guildId);
    const taskLeaderboardRepo = new TaskLeaderboardRepository(db, guildId);

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
        setup: new SetupService(),
        repos: { taskRepo, prizeRepo, movieRepo, keywordRepo, guildRepo, userRepo, taskLeaderboardRepo },
    };

    return services;
}
