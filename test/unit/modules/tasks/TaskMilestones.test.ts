import { describe, expect, test } from "vitest";
import { getHighestMilestone, getTotalTaskCompletions } from "../../../../src/modules/tasks/TaskMilestones.js";
import { milestoneRoleFactory } from "../../../factories.js";

const participant = milestoneRoleFactory.build({ label: "Task Participant", requiredSubmissions: 5 });
const enthusiast = milestoneRoleFactory.build({ label: "Task Enthusiast", requiredSubmissions: 25 });
const expert = milestoneRoleFactory.build({ label: "Task Expert", requiredSubmissions: 50 });
const milestones = [participant, enthusiast, expert];

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
        expect(getHighestMilestone(milestones, 30)?.id).toBe(enthusiast.id);
    });

    test("skips disabled milestones", () => {
        expect(
            getHighestMilestone(
                milestones.map((milestone) => ({ ...milestone, enabled: milestone !== enthusiast })),
                30,
            )?.id,
        ).toBe(participant.id);
    });
});
