import type { IKeywordRepository } from "../../core/database/interfaces/IKeywordRepo.js";
import type { Keyword } from "../../models/Keyword.js";

const HISTORY_LIMIT = 26;

export class KeywordSelector {
    constructor(private repo: IKeywordRepository) { }

    async selectKeyword(currentEventId: string): Promise<string> {
        const allKeywords: Keyword[] = await this.repo.getAllKeywords();
        if (allKeywords.length === 0) {
            console.warn("[KeywordSelector] No keywords found in Firestore.");
            return "keyword";
        }

        // Sort by lastUsedAt descending to exclude recent keywords
        const sorted = [...allKeywords].sort((a, b) => {
            return b.lastUsedAt.getTime() - a.lastUsedAt.getTime();
        });

        // Leave out the most recently used, but always keep at least one keyword to pick from, so with few keywords
        // the one used last is never picked again straight away
        const excludeCount = Math.min(HISTORY_LIMIT, sorted.length - 1);
        const recent = sorted.slice(0, excludeCount).map(k => k.id);
        const pool = allKeywords.filter(k => !recent.includes(k.id));
        const chosen = pool[Math.floor(Math.random() * pool.length)]!;

        // Mark as used
        await this.repo.markKeywordUsed(chosen.id, currentEventId);

        console.log(`[KeywordSelector] Selected keyword: ${chosen.word}`);
        return chosen.word;
    }
}

