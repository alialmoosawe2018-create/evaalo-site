/**
 * Patches the CV Comparison n8n workflow to skip non-CV uploads before ranking.
 *
 * Source: evaalo-backend-prod-review/.tmp-cv-comp.json (export baseline)
 * Output: docs/n8n-workflows/cv-comparison.workflow.json
 *
 * Run: npm run build:cv-comparison-workflow
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SOURCE = join(ROOT, '..', '..', 'evaalo-backend-prod-review', '.tmp-cv-comp.json');
const OUT_DIR = join(ROOT, 'docs', 'n8n-workflows');
const OUT_FILE = join(OUT_DIR, 'cv-comparison.workflow.json');

function n8nId() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let out = '';
    for (let i = 0; i < 16; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
}

const FILTER_CV_CODE = `const items = $input.all();

function isLikelyCv(text, fileName) {
  const t = String(text || '').replace(/\\s+/g, ' ').trim();
  if (t.length < 80) return { ok: false, reason: 'insufficient_text' };

  const lower = t.toLowerCase();
  const cvSignals = [
    'experience', 'education', 'skills', 'employment', 'university', 'bachelor', 'master',
    'resume', 'curriculum vitae', 'objective', 'certification', 'qualified', 'position',
    'career', 'profile', 'languages', 'internship', 'degree',
    'خبرة', 'تعليم', 'مهارات', 'السيرة', 'جامعة', 'مؤهل', 'وظيفة', 'عمل', 'تخصص', 'شهادة'
  ];
  const hits = cvSignals.filter((s) => lower.includes(s)).length;
  const hasEmail = /@[\\w.-]+\\.\\w{2,}/.test(t);
  const hasPhone = /(\\+?\\d[\\d\\s\\-().]{7,}\\d)/.test(t);

  if (hits >= 2) return { ok: true };
  if (hasEmail && (hasPhone || hits >= 1)) return { ok: true };
  if (t.length >= 400 && hits >= 1) return { ok: true };

  const nameHint = String(fileName || '').toLowerCase();
  if (
    (nameHint.includes('cv') || nameHint.includes('resume') || nameHint.includes('سيرة') || nameHint.includes('curriculum')) &&
    t.length >= 120 &&
    hits >= 1
  ) {
    return { ok: true };
  }

  return { ok: false, reason: 'not_cv_like' };
}

const valid = [];
const skipped = [];

for (const item of items) {
  const text = item.json.text ?? item.json.data ?? '';
  const fileName =
    item.json.fileName ||
    item.binary?.data?.fileName ||
    item.binary?.data?.fileName ||
    'unknown.pdf';
  const verdict = isLikelyCv(text, fileName);
  if (verdict.ok) {
    valid.push({
      json: {
        ...item.json,
        fileName,
        text: String(text).trim(),
        isCv: true,
      },
      binary: item.binary,
    });
  } else {
    skipped.push({ fileName, reason: verdict.reason });
  }
}

const webhook = $('Webhook').first().json.body || {};

if (!valid.length) {
  return [{
    json: {
      noValidCvs: true,
      comparisonId: webhook.comparisonId,
      callbackUrl: webhook.callbackUrl,
      skippedFiles: skipped,
      comparisons: [],
      candidates: [],
      ranking: [],
      recommendation: '',
      comparisonSummary:
        skipped.length
          ? 'No valid CV documents were found. Non-CV or unreadable files were ignored.'
          : 'No CV files were provided.',
    },
  }];
}

return valid.map((row, idx) => ({
  json: {
    ...row.json,
    skippedFiles: idx === 0 ? skipped : [],
  },
  binary: row.binary,
}));`;

const FORMAT_RESULTS_CODE = `const agentOut = $input.first().json;
let raw = agentOut.output ?? agentOut.text ?? agentOut.response ?? agentOut;
let parsed = {};

if (typeof raw === 'string') {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { parsed = JSON.parse(raw.slice(start, end + 1)); } catch (e) { parsed = {}; }
  }
} else if (raw && typeof raw === 'object') {
  if (raw.candidates) parsed = raw;
  else if (raw.parsed && typeof raw.parsed === 'object') parsed = raw.parsed;
  else if (typeof raw.output === 'string') {
    const start = raw.output.indexOf('{');
    const end = raw.output.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { parsed = JSON.parse(raw.output.slice(start, end + 1)); } catch (e) { parsed = {}; }
    }
  }
}

const webhook = $('Webhook').first().json.body || {};
const filterItems = $('Filter CV Documents').all();
const skippedFromFilter = filterItems.find((i) => Array.isArray(i.json.skippedFiles))?.json.skippedFiles || [];
const validCvFiles = filterItems.filter((i) => i.json.isCv).map((i) => i.json.fileName);

const candidates = Array.isArray(parsed.candidates) ? parsed.candidates : [];

function looksLikeNonCvCandidate(c) {
  const name = String(c?.name || '').toLowerCase();
  const summary = String(c?.summary || '').toLowerCase();
  if (name.includes('no text') || name.includes('(no text)')) return true;
  if (summary.includes('no extractable text') || summary.includes('not a cv') || summary.includes('not a resume')) return true;
  if (summary.includes('little or no') && summary.includes('text')) return true;
  return false;
}

const filteredCandidates = candidates.filter((c) => !looksLikeNonCvCandidate(c));

const comparisons = filteredCandidates.map((c, idx) => ({
  fileName: c.name || validCvFiles[idx] || \`CV \${idx + 1}\`,
  name: c.name || validCvFiles[idx] || \`CV \${idx + 1}\`,
  rank: idx + 1,
  score: c.overallScore ?? c.score ?? null,
  matchScore: c.overallScore ?? c.score ?? null,
  summary: c.summary || '',
  finalHrReport:
    c.finalHrReport ||
    c.finalHrEvaluation ||
    c.final_hr_report ||
    c.hrReport ||
    '',
  skills: Array.isArray(c.skills) ? c.skills : [],
  experienceYears: c.experienceYears ?? null,
  education: c.education || '',
  strengths: Array.isArray(c.strengths) ? c.strengths : [],
  weaknesses: Array.isArray(c.weaknesses) ? c.weaknesses : [],
  isCv: true,
}));

return [{
  json: {
    comparisonId: webhook.comparisonId,
    callbackUrl: webhook.callbackUrl,
    comparisons,
    candidates: filteredCandidates,
    ranking: (parsed.ranking || []).filter((name) =>
      comparisons.some((c) => c.name === name || c.fileName === name)
    ),
    recommendation: parsed.recommendation || '',
    comparisonSummary: parsed.comparisonSummary || '',
    skippedFiles: skippedFromFilter,
  },
}];`;

const AGENT_SYSTEM_MESSAGE = `You are an expert HR recruiter and CV analyst. Compare only valid CV/resume documents against the job requirements.

Return ONLY valid JSON (no markdown fences):
{
  "candidates": [
    {
      "name": "string",
      "overallScore": 0,
      "skills": ["string"],
      "experienceYears": 0,
      "education": "string",
      "strengths": ["string"],
      "weaknesses": ["string"],
      "summary": "string (1-2 sentences for ranking table)",
      "finalHrReport": "string (full HR report: candidate identity, personal background, experience, education, role fit)"
    }
  ],
  "ranking": ["name1", "name2"],
  "recommendation": "string",
  "comparisonSummary": "string"
}

Rules:
- Only include real CVs/resumes in "candidates". Omit any document that is not a CV (forms, invoices, blank pages, random PDFs).
- Never invent a candidate for a non-CV file.
- "summary" = brief match overview for the results table (max ~2 sentences).
- "finalHrReport" = complete Final HR Report paragraph per candidate: name, personal/profile context, years of experience, education, and evidence-based hiring assessment. Write in clear professional English unless the CV is Arabic-only (then Arabic is OK).
- Score 0-100 based on fit for the role and location.
- Be evidence-based; support Arabic and English CVs.
- Do not invent facts not in the CV text.
- Use the provided fileName for each candidate "name" when available.`;

const AGENT_TEXT = `={{ (() => {
  const body = $('Webhook').first().json.body || {};
  let criteria = {};
  try {
    criteria = typeof body.criteria === 'string' ? JSON.parse(body.criteria) : (body.criteria || {});
  } catch (e) {}
  const job = [
    'Position: ' + (body.position || criteria.position || 'Not specified'),
    'Location: ' + (body.location || criteria.location || 'Not specified'),
    criteria.yearsOfExperience ? 'Years of experience: ' + criteria.yearsOfExperience : '',
    criteria.ageRange ? 'Age range: ' + criteria.ageRange : '',
    criteria.query ? 'Notes: ' + criteria.query : '',
    criteria.optionsSummaryEn || criteria.optionsSummaryAr || '',
  ].filter(Boolean).join('\\n');

  const filterRows = $('Filter CV Documents').all().filter((i) => i.json.isCv);
  const cvPayload = filterRows.map((i) => ({
    fileName: i.json.fileName,
    text: i.json.text,
  }));

  return 'Job requirements:\\n' + job + '\\n\\nValid CVs to compare (non-CV uploads were already removed):\\n' + JSON.stringify(cvPayload, null, 2);
})() }}`;

const SEND_JSON_BODY =
    '={{ JSON.stringify({ comparisons: $json.comparisons, candidates: $json.candidates, ranking: $json.ranking, recommendation: $json.recommendation, comparisonSummary: $json.comparisonSummary, comparisonId: $json.comparisonId, skippedFiles: $json.skippedFiles || [] }) }}';

function loadWorkflow() {
    const raw = JSON.parse(readFileSync(SOURCE, 'utf8'));
    return Array.isArray(raw) ? raw[0] : raw;
}

function patchWorkflow(wf) {
    const filterId = n8nId();
    const hasValidId = n8nId();

    const filterNode = {
        parameters: { mode: 'runOnceForAllItems', jsCode: FILTER_CV_CODE },
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [860, 0],
        id: filterId,
        name: 'Filter CV Documents',
    };

    const hasValidNode = {
        parameters: {
            conditions: {
                combinator: 'and',
                conditions: [
                    {
                        id: 'cvcomp-has-valid-cv',
                        leftValue: '={{ $json.noValidCvs }}',
                        operator: {
                            operation: 'false',
                            singleValue: true,
                            type: 'boolean',
                        },
                        rightValue: '',
                    },
                ],
                options: {
                    caseSensitive: true,
                    leftValue: '',
                    typeValidation: 'strict',
                    version: 3,
                },
            },
            options: {},
        },
        type: 'n8n-nodes-base.if',
        typeVersion: 2.2,
        position: [1060, 0],
        id: hasValidId,
        name: 'Has Valid CVs',
    };

    const names = new Set(wf.nodes.map((n) => n.name));
    if (!names.has('Filter CV Documents')) wf.nodes.push(filterNode);
    if (!names.has('Has Valid CVs')) wf.nodes.push(hasValidNode);

    for (const node of wf.nodes) {
        if (node.name === 'Format Comparison Results') {
            node.parameters.jsCode = FORMAT_RESULTS_CODE;
        }
        if (node.name === 'Compare CVs Agent') {
            node.parameters.text = AGENT_TEXT;
            node.parameters.options = node.parameters.options || {};
            node.parameters.options.systemMessage = AGENT_SYSTEM_MESSAGE;
        }
        if (node.name === 'Send Results to Evaalo') {
            node.parameters.jsonBody = SEND_JSON_BODY;
        }
        if (node.name === 'Filter CV Documents') {
            node.parameters.jsCode = FILTER_CV_CODE;
        }
        if (node.name === 'Aggregate CVs') {
            node.position = [1280, -80];
        }
        if (node.name === 'Compare CVs Agent') {
            node.position = [1500, -80];
        }
        if (node.name === 'Format Comparison Results') {
            node.position = [1720, -80];
        }
    }

    wf.connections['Extract from File'] = {
        main: [[{ node: 'Filter CV Documents', type: 'main', index: 0 }]],
    };
    wf.connections['Filter CV Documents'] = {
        main: [[{ node: 'Has Valid CVs', type: 'main', index: 0 }]],
    };
    wf.connections['Has Valid CVs'] = {
        main: [
            [{ node: 'Aggregate CVs', type: 'main', index: 0 }],
            [{ node: 'Send Results to Evaalo', type: 'main', index: 0 }],
        ],
    };

    wf.description =
        'Compare multiple CV PDFs with AI. Non-CV or unreadable PDFs are filtered out before ranking and omitted from results.';
    wf.updatedAt = new Date().toISOString();

    return wf;
}

const wf = patchWorkflow(loadWorkflow());
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, JSON.stringify([wf], null, 2), 'utf8');
console.log('Wrote', OUT_FILE);
