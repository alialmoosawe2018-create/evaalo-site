/**
 * The gate for the person/application separation.
 *
 * Its predecessor, verifyCandidateApplicationMigration.ts, asserted that the
 * person and the application AGREE — the right question during the migration,
 * and the wrong one now. Agreement is how one campaign's state reached the next:
 * a verdict passed for a different job, an interview link already spent. So the
 * meaning is inverted here — this asserts that each application stands alone.
 *
 * Violations fail the run. Everything else is printed as a progress reading for
 * the phases still ahead, because the person has not stopped carrying campaign
 * state yet — phase 3 drops those fields.
 *
 * Run: npx tsx src/scripts/verifyApplicationOwnership.ts
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectDatabase } from '../config/database.js';
import Candidate from '../models/Candidate.js';
import CandidateApplication from '../models/CandidateApplication.js';

dotenv.config();

/**
 * A comparable fingerprint of an evaluation, or '' when it is not distinctive.
 *
 * Both a score AND a recommendation are required. A run against production
 * showed why: "|Consider" and "|Incomplete" — a recommendation with no score —
 * collide constantly between two honest evaluations and say nothing about
 * copying. A shared score is the part that cannot happen twice by chance.
 */
function evaluationFingerprint(ev: unknown): string {
    if (!ev || typeof ev !== 'object') return '';
    const o = ev as Record<string, unknown>;
    const score = o.overall_score;
    const rec = o.recommendation;
    const hasScore = score !== undefined && score !== null && String(score).trim() !== '';
    const hasRec = typeof rec === 'string' && rec.trim().length > 0;
    if (!hasScore || !hasRec) return '';
    return `${String(score)}|${String(rec)}`;
}

const STAGES = [
    ['written', 'writtenInterviewEvaluation'],
    ['voice', 'voiceInterviewEvaluation'],
    ['video', 'videoInterviewEvaluation'],
] as const;

type Violation = { rule: string; detail: string };

/**
 * Two classes of finding, deliberately.
 *
 * `violations` are things the code must not do any more — they are fixed, so a
 * single one means a regression and fails the run.
 *
 * `legacy` is damage already sitting in the data from before the fix. It is
 * cleared by the phase-3 wipe, not by code, so it does not fail the run — a
 * gate that stays red for weeks is a gate people stop reading. Pass --strict
 * (which CI should do once phase 3 lands) to fail on it too.
 */
async function main(): Promise<void> {
    const strict = process.argv.includes('--strict');
    await connectDatabase();

    const apps = await CandidateApplication.find({ deletedAt: null }).lean();
    const violations: Violation[] = [];
    const legacy: Violation[] = [];

    // ── Rule 1: a stamp older than the row that carries it was inherited ──
    // An interview cannot have been taken before the application existed. This
    // is the one that told a candidate their brand-new campaign was "complete".
    for (const a of apps as any[]) {
        for (const kind of ['voice', 'video'] as const) {
            const stamp = a[`${kind}InterviewLinkConsumedAt`];
            if (stamp && a.createdAt && new Date(stamp) < new Date(a.createdAt)) {
                violations.push({
                    rule: 'inherited-link-stamp',
                    detail: `application ${a.applicationId} (campaign ${a.campaignId || 'none'}): ${kind} link stamped ${new Date(stamp).toISOString()}, ${Math.round((new Date(a.createdAt).getTime() - new Date(stamp).getTime()) / 60000)} min BEFORE the application existed`,
                });
            }
        }
    }

    // ── Rule 2: one person's two campaigns must not share a verdict ──
    // Identical score AND recommendation on the same stage across two campaigns
    // is the signature of a copied evaluation, not of two evaluations agreeing.
    const byPerson = new Map<string, any[]>();
    for (const a of apps as any[]) {
        const k = String(a.candidateId);
        if (!byPerson.has(k)) byPerson.set(k, []);
        byPerson.get(k)!.push(a);
    }
    for (const [personId, list] of byPerson) {
        if (list.length < 2) continue;
        for (const [label, key] of STAGES) {
            const seen = new Map<string, string>();
            for (const a of list) {
                const fp = evaluationFingerprint(a[key]);
                if (!fp) continue;
                const previous = seen.get(fp);
                if (previous) {
                    legacy.push({
                        rule: 'shared-evaluation',
                        detail: `person ${personId}: ${label} verdict "${fp}" appears on both ${previous} and ${a.applicationId}`,
                    });
                } else {
                    seen.set(fp, a.applicationId);
                }
            }
        }
    }

    // ── Rule 3: an application must carry its own identity ──
    for (const a of apps as any[]) {
        const missing: string[] = [];
        if (!a.applicationId) missing.push('applicationId');
        if (!Array.isArray(a.timeline) || a.timeline.length === 0) missing.push('timeline');
        if (!a.applicationSnapshot) missing.push('applicationSnapshot');
        if (missing.length) {
            violations.push({
                rule: 'incomplete-application',
                detail: `application ${a._id}: missing ${missing.join(', ')}`,
            });
        }
    }

    // ── Progress reading (not yet a failure) ──────────────────────────────
    // How much campaign state the person is still holding. Phase 3 drops these
    // fields; until then these numbers should only ever go down.
    const PERSON_CAMPAIGN_FIELDS = [
        'campaignId',
        'writtenInterviewEvaluation',
        'voiceInterviewEvaluation',
        'videoInterviewEvaluation',
        'aiEvaluation',
        'voiceRecording',
        'voiceInterviewLinkConsumedAt',
        'videoInterviewLinkConsumedAt',
        'entryStage',
        'status',
    ];
    const people = await Candidate.find({}).lean();
    const occupancy = PERSON_CAMPAIGN_FIELDS.map((f) => {
        const n = (people as any[]).filter((p) => {
            const v = p[f];
            if (v === undefined || v === null || v === '') return false;
            if (typeof v === 'object' && !(v instanceof Date)) return evaluationFingerprint(v) !== '' || Object.keys(v).length > 0;
            return true;
        }).length;
        return { field: f, people: n };
    });

    // Returning applicants whose person-level job no longer matches their latest
    // application: expected while the field still exists, gone after phase 3.
    let returning = 0;
    let staleJob = 0;
    for (const [personId, list] of byPerson) {
        if (list.length < 2) continue;
        returning += 1;
        const latest = [...list].sort(
            (x, y) => new Date(y.createdAt).getTime() - new Date(x.createdAt).getTime()
        )[0];
        const person = (people as any[]).find((p) => String(p._id) === personId);
        const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();
        if (person && norm(person.position_applied_for) !== norm(latest.position_applied_for)) {
            staleJob += 1;
        }
    }

    console.log(`\napplications (live): ${apps.length} | people: ${people.length} | returning applicants: ${returning}`);
    console.log('\nperson still holds campaign state in:');
    for (const o of occupancy) {
        if (o.people > 0) console.log(`  ${o.field.padEnd(32)} ${o.people} people`);
    }
    console.log(
        `\nreturning applicants whose person-level job is stale: ${staleJob}/${returning}` +
            ' (expected — the field is read from the application now, and disappears in phase 3)'
    );

    const report = (title: string, list: Violation[], mark: string) => {
        console.log(`\n${title}: ${list.length}`);
        const byRule = new Map<string, Violation[]>();
        for (const v of list) {
            if (!byRule.has(v.rule)) byRule.set(v.rule, []);
            byRule.get(v.rule)!.push(v);
        }
        for (const [rule, rows] of byRule) {
            console.log(`\n  ${mark} ${rule} (${rows.length})`);
            for (const v of rows.slice(0, 10)) console.log(`      ${v.detail}`);
            if (rows.length > 10) console.log(`      … and ${rows.length - 10} more`);
        }
    };

    report('violations (the code must not do these any more)', violations, '✗');
    if (!violations.length) console.log('  ✓ every application stands on its own');
    report('legacy damage (cleared by the phase-3 wipe, not by code)', legacy, '·');

    const failed = violations.length + (strict ? legacy.length : 0);
    if (legacy.length && !strict) {
        console.log('\n  (re-run with --strict once phase 3 has wiped the data)');
    }

    await mongoose.disconnect();
    process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
    console.error('[verifyApplicationOwnership] fatal:', err);
    process.exit(1);
});
