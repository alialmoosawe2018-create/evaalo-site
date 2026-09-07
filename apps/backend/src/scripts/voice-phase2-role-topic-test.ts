import { PHASE2_TOPIC_KEYS } from '../evaalo-only-voice/interviewConfig.js';
import { buildPhase2TopicPrompt } from '../evaalo-only-voice/questionEngine.js';

/**
 * Regression for the defect found in voice session 6afff73c (2026-09-07).
 *
 * A petroleum engineer at Halliburton applied for Senior HR Specialist. Every
 * phase-2 topic was derived from her CV — skill, certification, education,
 * company — so five of thirteen questions went into drilling tools and firmware
 * faults, and the role itself was asked about once, twelfth. The evaluation that
 * followed judged a job the interview had never examined.
 *
 * What this pins is the ordering, not the wording: the role must be the first
 * topic in the rotation, and its prompt must carry the applied-for position.
 *
 * Run: npm run test:voice-phase2-role
 */

let failures = 0;

function check(label: string, ok: boolean, detail?: string): void {
    if (!ok) failures += 1;
    console.log(`${ok ? '✅' : '❌'} ${label}${ok || !detail ? '' : `\n   ${detail}`}`);
}

const HR_PROFILE = {
    // The real record from that session: nothing here relates to the job.
    skills: ['MWD', 'drilling operation', 'well logging'],
    current_company: 'Halliburton',
    highest_education_level: 'Bachelor',
    position_applied_for: 'Senior HR Specialist',
};

console.log('— rotation order —');
check('role is a known topic', PHASE2_TOPIC_KEYS.includes('role' as never));
check(
    'role comes first, so it is asked before any CV topic',
    PHASE2_TOPIC_KEYS[0] === 'role',
    `order: ${PHASE2_TOPIC_KEYS.join(' → ')}`,
);

console.log('\n— the role prompt —');
const ar = buildPhase2TopicPrompt('role' as never, true, HR_PROFILE);
const en = buildPhase2TopicPrompt('role' as never, false, HR_PROFILE);
check('Arabic prompt names the applied-for role', ar.includes('Senior HR Specialist'), ar);
check('English prompt names the applied-for role', en.includes('Senior HR Specialist'), en);
check(
    'it does not drag the CV in — no drilling tools, no employer',
    !/MWD|drilling|Halliburton/i.test(ar + en),
    ar + ' | ' + en,
);
check(
    'it asks about the work, not about prior experience in it',
    /مهمّة|task/i.test(ar + en) && !/سنوات خبرة|years of experience/i.test(ar + en),
    ar,
);

console.log('\n— no position on the record —');
const bare = buildPhase2TopicPrompt('role' as never, true, { skills: ['MWD'] });
check('still asks about the applied-for role, not the CV', !/MWD/.test(bare) && bare.length > 0, bare);

console.log('\n— the CV topics still work —');
const skill = buildPhase2TopicPrompt('skill' as never, true, HR_PROFILE);
check('skill still uses the first skill', skill.includes('MWD'), skill);

console.log(`\n${failures === 0 ? '✅ all passed' : `❌ ${failures} failed`}`);
process.exit(failures === 0 ? 0 : 1);
