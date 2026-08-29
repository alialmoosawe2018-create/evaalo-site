import type { CareerLevel, CareerLevelOverlay } from './types.js';

/** One Deep Pack per roleKey; interview depth shifts via career level overlay. */
export const CAREER_LEVEL_OVERLAYS: Record<CareerLevel, CareerLevelOverlay> = {
    intern: {
        questionDifficulty: 'foundational',
        leadershipExpectations: 'Learning mindset; supervised tasks; basic terminology.',
        expectedEvidenceBias: 'Coursework, internships, guided projects.',
        rubricEmphasis: 'Willingness to learn, follow instructions, basic understanding.',
    },
    graduate: {
        questionDifficulty: 'foundational',
        leadershipExpectations: 'Structured graduate program; rotation exposure.',
        expectedEvidenceBias: 'Academic projects, graduate assignments, mentorship.',
        rubricEmphasis: 'Potential, structured learning, adaptability.',
    },
    junior: {
        questionDifficulty: 'foundational',
        leadershipExpectations: 'Individual contributor; executes defined tasks.',
        expectedEvidenceBias: 'Hands-on examples with guidance; small scoped deliverables.',
        rubricEmphasis: 'Correct execution, basic tools, following standards.',
    },
    mid: {
        questionDifficulty: 'intermediate',
        leadershipExpectations: 'Independent IC; owns workstream deliverables.',
        expectedEvidenceBias: 'Concrete examples with metrics, steps, and outcomes.',
        rubricEmphasis: 'Practical competence, reliability, domain basics.',
    },
    senior: {
        questionDifficulty: 'advanced',
        leadershipExpectations: 'Senior IC; trade-offs, production incidents, scalability.',
        expectedEvidenceBias: 'Trade-offs, debugging, cross-team impact, measurable results.',
        rubricEmphasis: 'Depth, judgment, production awareness.',
    },
    lead: {
        questionDifficulty: 'advanced',
        leadershipExpectations: 'Technical direction, code review, mentoring, architecture choices.',
        expectedEvidenceBias: 'Design decisions, mentoring examples, technical leadership.',
        rubricEmphasis: 'Architecture, quality bar, team uplift.',
    },
    supervisor: {
        questionDifficulty: 'intermediate',
        leadershipExpectations: 'Supervises field/operational teams; safety and execution.',
        expectedEvidenceBias: 'Team coordination, safety compliance, operational examples.',
        rubricEmphasis: 'Operational control, safety, team supervision.',
    },
    manager: {
        questionDifficulty: 'strategic',
        leadershipExpectations: 'Delivery planning, hiring, team performance, stakeholder management.',
        expectedEvidenceBias: 'Team outcomes, hiring, planning, budget or KPI ownership.',
        rubricEmphasis: 'People leadership, delivery, accountability.',
    },
    head: {
        questionDifficulty: 'strategic',
        leadershipExpectations: 'Function leadership; strategy within domain.',
        expectedEvidenceBias: 'Org-level initiatives, multi-team outcomes, policy decisions.',
        rubricEmphasis: 'Strategic impact, function building.',
    },
    director: {
        questionDifficulty: 'strategic',
        leadershipExpectations: 'Directorate scope; long-range planning.',
        expectedEvidenceBias: 'Portfolio outcomes, executive alignment, transformation.',
        rubricEmphasis: 'Vision, scale, organizational impact.',
    },
    executive: {
        questionDifficulty: 'strategic',
        leadershipExpectations: 'Enterprise strategy, vision, board-level stakeholder management.',
        expectedEvidenceBias: 'Company-level decisions, market strategy, org transformation.',
        rubricEmphasis: 'Strategic leadership, enterprise impact.',
    },
};

export function getCareerLevelOverlay(level: string): CareerLevelOverlay {
    const key = level as CareerLevel;
    return CAREER_LEVEL_OVERLAYS[key] ?? CAREER_LEVEL_OVERLAYS.mid;
}

/**
 * Interview seniority for a role, which can differ from its CATALOG level.
 *
 * Some support/entry roles are stored at `mid` on purpose — `mid` is the hidden
 * "base" UI level, so the role shows as e.g. "HR Assistant" (no level suffix)
 * rather than "Senior HR Assistant". But an Assistant/Clerk/Trainee executes and
 * supports; it does not own processes/KPIs. Interviewing it at `mid` produced
 * over-senior competencies (process ownership, KPI analysis, stakeholder
 * management) the candidate can't speak to. So for INTERVIEW purposes only (the
 * career-level overlay), treat clear support titles as `junior` — the catalog
 * level and UI are untouched.
 */
/**
 * Roles that are execution/support scope even though the catalog stores them at
 * `mid` (the hidden base level). Keyed by STABLE roleKey — more reliable than a
 * title regex, and independent of how the display title is worded. Extend this set
 * as support roles are added; the title heuristic below still catches ones whose
 * title self-identifies (…assistant/clerk/receptionist/…).
 */
export const SUPPORT_ROLE_KEYS = new Set<string>([
    'hr_assistant',
    'administrative_assistant',
    'office_assistant',
    'receptionist',
    'data_entry_clerk',
    'data_entry_operator',
    'secretary',
    'cashier',
    'bank_teller',
]);

/**
 * True when a role should be interviewed at execution/support scope: either its
 * stable roleKey is flagged, or the title reads as a support role.
 */
export function isSupportScopeRole(jobTitle: string, roleKey?: string | null): boolean {
    const key = String(roleKey || '').trim().toLowerCase();
    if (key && SUPPORT_ROLE_KEYS.has(key)) return true;
    const t = String(jobTitle || '').toLowerCase();
    return (
        /\b(assistant|aide|clerk|trainee|apprentice|receptionist|secretary|cashier|teller|operator|data[ _-]?entry)\b/.test(
            t,
        ) ||
        /مساعد|كاتب\b|متدرّ?ب|مبتدئ|استقبال|سكرتير|أمين\s*صندوق|صرّ?اف|مدخل\s*بيانات|مشغّ?ل/.test(
            String(jobTitle || ''),
        )
    );
}

export function deriveInterviewLevel(
    jobTitle: string,
    catalogLevel: string,
    roleKey?: string | null,
): string {
    const level = String(catalogLevel || 'mid');
    if (level === 'intern' || level === 'graduate' || level === 'junior') return level;
    // Only the hidden `mid` default is ever corrected; an explicit senior/manager/…
    // pick is honored as-is (never upgrade, never override a real choice).
    if (level !== 'mid') return level;
    return isSupportScopeRole(jobTitle, roleKey) ? 'junior' : level;
}

export function buildOverlayPromptBlock(level: string): string {
    const o = getCareerLevelOverlay(level);
    const lines = [
        `Career level overlay (${level}):`,
        `- Question difficulty: ${o.questionDifficulty}`,
        `- Leadership expectations: ${o.leadershipExpectations}`,
        `- Strong answers should show: ${o.expectedEvidenceBias}`,
        `- Rubric emphasis: ${o.rubricEmphasis}`,
    ];
    // Entry/support roles: steer competency SELECTION toward the role's real scope,
    // not just question difficulty. Without this the LLM tends to reuse mid-level
    // competencies (owning processes/KPIs, "stakeholder management") that a support
    // role cannot evidence, and the candidate scores as "insufficient".
    if (o.questionDifficulty === 'foundational') {
        lines.push(
            '- Competency scope: choose competencies that reflect EXECUTION and SUPPORT within ' +
                'defined processes — e.g. accuracy and attention to detail, following procedures ' +
                'and policies, coordination and scheduling, tool/data-entry basics, responsiveness, ' +
                'and confidentiality. Do NOT frame competencies around owning processes, owning ' +
                'KPIs/targets, strategic decisions, data-driven decision ownership, or "managing ' +
                'stakeholder expectations" — this role supports and executes, it does not own ' +
                'outcomes. For relationship skills prefer plain, role-fit phrasing such as ' +
                '"coordinating with colleagues and managers" (التنسيق مع الزملاء والمديرين) rather ' +
                'than the corporate term "stakeholder management" (إدارة أصحاب المصلحة).',
        );
    }
    return lines.join('\n');
}
