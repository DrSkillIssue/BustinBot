import { describe, expect, test } from "vitest";
import { getHighestMilestone, getTotalTaskCompletions } from "../../../../src/modules/tasks/TaskMilestones.js";
import { milestoneRoleFactory } from "../../../factories.js";

describe("TaskMilestones helpers", () => {
    test("counts legacy completions toward totals", () => {
        expect(
            getTotalTaskCompletions({
                tasksCompletedBronze: 2,
                tasksCompletedSilver: 1,
                tasksCompletedGold: 0,
                legacyTasksCompleted: 8,
            }),
        ).toBe(11);
    });

    test("returns the highest milestone reached", () => {
        const participant = milestoneRoleFactory.build({ requiredSubmissions: 5 });
        const enthusiast = milestoneRoleFactory.build({ requiredSubmissions: 25 });
        const expert = milestoneRoleFactory.build({ requiredSubmissions: 50 });

        expect(getHighestMilestone([participant, enthusiast, expert], 30)?.id).toBe(enthusiast.id);
    });

    test("skips disabled milestones", () => {
        const participant = milestoneRoleFactory.build({ requiredSubmissions: 5 });
        const disabled = milestoneRoleFactory.build({ requiredSubmissions: 25, enabled: false });

        expect(getHighestMilestone([participant, disabled], 30)?.id).toBe(participant.id);
    });
});
