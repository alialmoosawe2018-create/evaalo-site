/**
 * The note a Head Hunter search ends with when it fell SHORT of what the recruiter
 * asked for — and only then (0 candidates included). A search that met its target
 * says nothing.
 *
 * ⚠️ The old sentence claimed "there are no further matches for this title in
 * this location". The page cannot know that: when SerpAPI gave no answer, or
 * Google ignored the site:linkedin.com/in/ filter, the shortfall says nothing
 * about the market. The opening sentence now states only what we hold — the
 * count and the target. With 0 candidates it does not say the search "widened
 * itself" either: the workflow widens only after phase 1 found someone.
 *
 * When the completion carries `serpHealth` (counts from the workflow, never query
 * text) and part of the search did not run normally, the note adds those counts
 * as plain facts. It names no cause for the shortfall and NEVER suggests searching
 * again: billing is per search, so a re-run can bill the same people twice.
 *
 * A search with 0 candidates usually ends 'failed' (the workflow sends a reason
 * with it), so a failed search gets the note too (owner decision 2026-10-03) —
 * but only when the workflow's counts came with it, i.e. the search engine was
 * actually asked (calls > 0). A failure without them (no callback, a crash before
 * any search request) keeps its own path's message: the note could not say what
 * happened.
 * A result read back from durable storage (the live record is gone) is not a
 * fresh completion and gets no note.
 *
 * Built from figures and translation keys on purpose, never from the workflow's
 * English errorMessage — that would reach Arabic and Kurdish recruiters verbatim.
 *
 * Both places that see a search end call this (the poll's last check and the
 * HeadHunterSearchCompleted socket handler), so whichever wins the race shows the
 * same note.
 */
import { fillI18nTemplate } from './i18nTemplate.js';

const isCount = (v) => Number.isInteger(v) && v >= 0;

/**
 * The backend validates `serpHealth` already; this re-checks so a malformed value
 * can only cost the extra detail, never produce a false or garbled sentence.
 *
 * @param {unknown} raw
 * @returns {{ calls: number, failed: number, ignoredFilter: number } | null}
 */
function readSerpHealth(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const { calls, failed, ignoredFilter } = /** @type {Record<string, unknown>} */ (raw);
    if (!isCount(calls) || !isCount(failed) || !isCount(ignoredFilter)) return null;
    if (failed + ignoredFilter > calls) return null;
    return { calls, failed, ignoredFilter };
}

/**
 * @param {{ status?: string | null, candidateCount?: number, wanted?: number | string, serpHealth?: unknown, source?: string | null }} input
 * @param {(key: string) => string} t
 * @returns {{ type: 'warn', text: string } | null}
 */
export function headHunterCompletionNotice({ status, candidateCount, wanted, serpHealth, source } = {}, t) {
    if (source === 'durable') return null;
    if (status !== 'completed' && status !== 'failed') return null;
    const target = Number(wanted);
    if (!Number.isFinite(target) || target <= 0) return null;
    const count = Math.max(0, Number(candidateCount) || 0);
    if (count >= target) return null;

    const health = readSerpHealth(serpHealth);
    const degraded = Boolean(health && (health.failed > 0 || health.ignoredFilter > 0));
    if (status === 'failed' && !(health && health.calls > 0)) return null;

    const opening = count === 0
        ? fillI18nTemplate(t('aiHeadHunterShortResultNone'), { target })
        : fillI18nTemplate(t('aiHeadHunterShortResult'), { count, target });
    if (!degraded) return { type: 'warn', text: opening };

    const { calls, failed, ignoredFilter } = health;
    // Only the non-zero parts appear; the separator only between two of them.
    const failedPart = failed > 0
        ? fillI18nTemplate(t('aiHeadHunterSerpFailedPart'), { failed, calls })
        : '';
    const ignoredPart = ignoredFilter > 0
        ? fillI18nTemplate(t('aiHeadHunterSerpIgnoredPart'), { ignored: ignoredFilter, calls })
        : '';
    const sep = failedPart && ignoredPart ? t('aiHeadHunterSerpPartSep') : '';
    const degradedText = fillI18nTemplate(t('aiHeadHunterSerpDegraded'), { failedPart, sep, ignoredPart });
    return { type: 'warn', text: `${opening} ${degradedText}` };
}
