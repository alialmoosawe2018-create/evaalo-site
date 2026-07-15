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

export function buildOverlayPromptBlock(level: string): string {
    const o = getCareerLevelOverlay(level);
    return [
        `Career level overlay (${level}):`,
        `- Question difficulty: ${o.questionDifficulty}`,
        `- Leadership expectations: ${o.leadershipExpectations}`,
        `- Strong answers should show: ${o.expectedEvidenceBias}`,
        `- Rubric emphasis: ${o.rubricEmphasis}`,
    ].join('\n');
}
