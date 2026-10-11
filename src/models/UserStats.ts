export interface UserStats {
    // Discord user ID
    userId: string;

    // General participation
    // First bot interaction
    joinedAt: Date;

    // Last time they used a command or feature
    lastActiveAt: Date;

    // Total commands run
    commandsRun: number;

    // Movie module stats
    // How many movies they've added to the pool
    moviesAdded: number;

    // How many movies they've added that have been watched
    moviesWatched: number;

    // How many movie nights they've attended
    moviesAttended: number;

    // How many movie polls they've voted in
    moviePollsVoted: number;

    // Task module stats
    // Total number of tasks they've completed for each tier
    tasksCompletedBronze: number;
    tasksCompletedSilver: number;
    tasksCompletedGold: number;

    // Current completion streak
    taskStreak: number;

    // Longest completion streak
    longestTaskStreak: number;

    // How many task polls they've voted in
    taskPollsVoted: number;

    // How many prizes they've won
    taskPrizesWon: number;

    // Periodic leaderboard champion placements
    taskChampionFirsts?: number;
    taskChampionSeconds?: number;
    taskChampionThirds?: number;

    // Completed task count from v1 task system
    legacyTasksCompleted: number;

    // Total XP for leaderboards
    totalXP?: number;

    // Cached leaderboard rank
    leaderboardRank?: number;
}

// A member's stats before they have done anything
export function newUserStats(userId: string, joinedAt: Date): UserStats {
    return {
        userId,
        joinedAt,
        lastActiveAt: joinedAt,
        commandsRun: 0,
        moviesAdded: 0,
        moviesWatched: 0,
        moviesAttended: 0,
        moviePollsVoted: 0,
        tasksCompletedBronze: 0,
        tasksCompletedSilver: 0,
        tasksCompletedGold: 0,
        taskStreak: 0,
        longestTaskStreak: 0,
        taskPollsVoted: 0,
        taskPrizesWon: 0,
        taskChampionFirsts: 0,
        taskChampionSeconds: 0,
        taskChampionThirds: 0,
        legacyTasksCompleted: 0,
        totalXP: 0,
        leaderboardRank: 0,
    };
}
