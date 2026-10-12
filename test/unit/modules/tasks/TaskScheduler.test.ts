import { describe, expect, test } from "vitest";
import { DateTime } from "luxon";
import { isPrizeDrawWeek } from "../../../../src/modules/tasks/TaskScheduler.js";

// Every Tuesday, when the prize draw job runs, from the first given for the given number of years
function tuesdays(from: string, years: number): DateTime[] {
    const first = DateTime.fromISO(from, { zone: "utc" });
    return Array.from({ length: years * 53 }, (_, week) => first.plus({ weeks: week }));
}

describe("prize draw weeks", () => {
    test("keep the draws a fortnight apart across new years", () => {
        // 2026-01-06 is a draw Tuesday
        const everyTuesday = tuesdays("2026-01-06", 15);

        expect(everyTuesday.filter((tuesday) => isPrizeDrawWeek(tuesday.toJSDate()))).toEqual(
            everyTuesday.filter((_, week) => week % 2 === 0),
        );
    });

    test("fall on the same Tuesdays as the calendar-week rule they replaced", () => {
        expect(
            ["2026-09-29", "2026-10-06", "2026-10-13", "2026-10-20", "2026-10-27"].map((date) =>
                isPrizeDrawWeek(new Date(`${date}T00:00:00Z`)),
            ),
        ).toEqual([true, false, true, false, true]);
    });
});
