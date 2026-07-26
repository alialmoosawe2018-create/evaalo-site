#!/usr/bin/env python3
"""
Patch Stage 3 video evaluation workflow (dWJzDwAd4FiVPejl):
- EN-only LLM (both branches)
- Validate with score formats 63/100 and competency normalization
- Post-extractor translation from Webhook body.language
- Reject incomplete eval callback on validation failure (no silent stop)

Run on VPS:
  python3 patch-n8n-stage3-video-en-translate.py /root/n8n-data-old/database.sqlite
"""
from __future__ import annotations

import json
import re
import sqlite3
import sys
import uuid
from copy import deepcopy

WF_ID = 'dWJzDwAd4FiVPejl'

STRICT_BLOCK_RE = re.compile(
    r'\*\*Output Language \(STRICT — HIGHEST PRIORITY\):\*\*.*?(?=\*\*System Role:\*\*)',
    re.DOTALL,
)

EN_RULE = (
    '**Language rule (evaluation output):** Write the ENTIRE evaluation report in English only. '
    'The video interview transcript may be Arabic, English, or mixed — use all transcript content as evidence only. '
    'All narrative text (Summary, Role Understanding, Qualitative Narrative Analysis, Final HR Evaluation) must be in English. '
    'Structured competency fields must be numeric scores 0–10. Keep Recommendation as Hire / Consider / Reject (English tokens). '
    'Blueprint competency evidence strings must be in English.\n\n'
)

CHAIN_TEXT = (
    '=Evaluate this video interview transcript.\n\nTranscript:\n{{ $json.body.fullTranscript }}\n\n'
    'Job criteria (JSON):\n{{ JSON.stringify($json.body.jobCriteria || {}) }}\n\n'
    'Blueprint competencies (JSON, empty if none):\n'
    '{{ JSON.stringify($json.body.blueprintSnapshot?.competencies || $json.body.blueprintSnapshot || {}) }}'
)

CHAIN1_TEXT = (
    CHAIN_TEXT
    + '\n\nCustom evaluation criteria:\n{{ JSON.stringify($json.body.criteria || []) }}'
)

TRANSLATE_SYSTEM = """=You localize a Stage 3 video interview evaluation JSON for HR/candidate display.

Target output language code: {{ $('Webhook').item.json.body.language || 'ar' }}

Rules:
- If the target code is "en" (or starts with "en-"), return the input JSON unchanged.
- If the target is "ar", translate narrative fields to Modern Standard Arabic: summary, and every string in competencyScores[].evidence and competencyScores[].redFlags (when present).
- NEVER change numeric competency fields (role_understanding, professional_depth, problem_handling, decision_making, prioritization, process_thinking, responsibility, learning_ability, job_readiness, final_role_fit), overall_score (number), recommendation (Hire/Consider/Reject), or competencyScores[].score.
- Return ONE valid JSON object with exactly the same keys as input. No markdown."""

TRANSLATE_TEXT = '=Input evaluation JSON (English):\n{{ JSON.stringify($json.output) }}'

VALIDATE_JS = r"""const items = $input.all();
const COMPETENCY = [
  'role_understanding', 'professional_depth', 'problem_handling', 'decision_making',
  'prioritization', 'process_thinking', 'responsibility', 'learning_ability',
  'job_readiness', 'final_role_fit',
];
const WORD_TO_SCORE = { excellent: 9, good: 7, intermediate: 5, bad: 2 };

function parseOverallScore(raw) {
  if (raw == null) return NaN;
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, Math.min(100, raw));
  const s = String(raw).trim();
  const frac = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (frac) {
    const num = parseFloat(frac[1]);
    const den = parseFloat(frac[2]);
    if (den > 0 && Number.isFinite(num)) {
      if (den <= 10) return Math.max(0, Math.min(100, num * 10));
      return Math.max(0, Math.min(100, num));
    }
  }
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : NaN;
}

function parseCompetencyScore(raw) {
  if (raw == null) return NaN;
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, Math.min(10, raw));
  const s = String(raw).trim();
  const word = WORD_TO_SCORE[s.toLowerCase()];
  if (word != null) return word;
  const frac = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*10$/i);
  if (frac) return Math.max(0, Math.min(10, parseFloat(frac[1])));
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? Math.max(0, Math.min(10, n)) : NaN;
}

function isText(v) {
  if (v == null) return false;
  const s = String(v).trim();
  return s.length > 0 && !/^(undefined|null|nan|n\/a)$/i.test(s);
}

return items.map((item) => {
  const o = { ...(item.json.output ?? {}) };
  for (const f of COMPETENCY) {
    const n = parseCompetencyScore(o[f]);
    if (Number.isFinite(n)) o[f] = n;
  }
  const scoreNum = parseOverallScore(o.overall_score);
  const scoreOk = Number.isFinite(scoreNum);
  if (scoreOk) o.overall_score = scoreNum;
  const rec = String(o.recommendation ?? '').trim();
  const recOk = rec === 'Hire' || rec === 'Consider' || rec === 'Reject';
  let compOk = true;
  for (const f of COMPETENCY) {
    const n = o[f];
    if (!(typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 10)) compOk = false;
  }
  const valid = compOk && isText(o.summary) && scoreOk && recOk;
  return {
    json: {
      valid,
      errorCategory: valid ? null : 'stage3_evaluation_incomplete',
      output: o,
    },
    binary: item.binary,
  };
});"""

APPLY_LOCALIZATION_TEMPLATE = r"""const items = $input.all();
const VALIDATE_NODE = '%VALIDATE%';

function parseJsonLoose(raw) {{
  if (raw == null) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  s = s.replace(/^\`\`\`(?:json)?\s*/i, '').replace(/\s*\`\`\`$/i, '').trim();
  try {{ return JSON.parse(s); }} catch {{ return null; }}
}}

function targetLang() {{
  const raw = String($('Webhook').first().json.body?.language || 'ar').trim().toLowerCase();
  if (raw === 'en' || raw.startsWith('en-')) return 'en';
  return 'ar';
}}

return items.map((item) => {{
  const original = $(VALIDATE_NODE).first().json.output ?? {{}};
  if (targetLang() === 'en') {{
    return {{ json: {{ output: original }}, binary: item.binary }};
  }}
  let o = parseJsonLoose(item.json.output ?? item.json.text ?? item.json);
  if (o && o.output && typeof o.output === 'object') o = o.output;
  const merged = {{ ...original, ...(o && typeof o === 'object' ? o : {{}}) }};
  return {{ json: {{ output: merged }}, binary: item.binary }};
}});"""


def new_id() -> str:
    return str(uuid.uuid4())


def find(nodes, name: str):
    for n in nodes:
        if n.get('name') == name:
            return n
    return None


def clean_chain_message(msg: str) -> str:
    if not msg.startswith('='):
        msg = '=' + msg
    cleaned = STRICT_BLOCK_RE.sub('', msg[1:], count=1)
    return '=' + EN_RULE + cleaned.lstrip()


def ensure_validate_and_translate(
    nodes,
    connections,
    model_src,
    model_num: str,
    branch_suffix: str,
    extractor_name: str,
    http_name: str,
    reject_tpl,
):
    validate_name = f'Validate Stage 3 Output{branch_suffix}'
    if_name = f'If Stage 3 Eval Valid{branch_suffix}'
    llm_name = f'Stage 3 Translate LLM{branch_suffix}'
    apply_name = f'Apply Stage 3 Localization{branch_suffix}'
    reject_name = 'Reject Incomplete Stage3 Eval'
    model_name = f'OpenAI Chat Model{model_num}'

    ext = find(nodes, extractor_name)
    http = find(nodes, http_name)

    validate = find(nodes, validate_name)
    if not validate:
        validate = {
            'id': new_id(),
            'name': validate_name,
            'type': 'n8n-nodes-base.code',
            'typeVersion': 2,
            'position': [ext['position'][0] + 180, ext['position'][1]],
            'parameters': {'jsCode': VALIDATE_JS, 'mode': 'runOnceForAllItems'},
        }
        nodes.append(validate)
    else:
        validate['parameters']['jsCode'] = VALIDATE_JS

    if_node = find(nodes, if_name)
    if not if_node:
        if_node = {
            'id': new_id(),
            'name': if_name,
            'type': 'n8n-nodes-base.if',
            'typeVersion': 2.2,
            'position': [validate['position'][0] + 180, validate['position'][1]],
            'parameters': {
                'conditions': {
                    'options': {
                        'caseSensitive': True,
                        'leftValue': '',
                        'typeValidation': 'strict',
                        'version': 3,
                    },
                    'conditions': [
                        {
                            'id': 's3-valid',
                            'leftValue': '={{ $json.valid === true }}',
                            'rightValue': '',
                            'operator': {'type': 'boolean', 'operation': 'true', 'singleValue': True},
                        }
                    ],
                    'combinator': 'and',
                },
                'options': {},
            },
        }
        nodes.append(if_node)

    model = find(nodes, model_name)
    if not model:
        model = deepcopy(model_src)
        model['id'] = new_id()
        model['name'] = model_name
        model['position'] = [ext['position'][0] + 540, ext['position'][1] + 140]
        nodes.append(model)

    llm = find(nodes, llm_name)
    if not llm:
        llm = {
            'id': new_id(),
            'name': llm_name,
            'type': '@n8n/n8n-nodes-langchain.chainLlm',
            'typeVersion': 1.9,
            'position': [if_node['position'][0] + 180, if_node['position'][1]],
            'parameters': {
                'promptType': 'define',
                'text': TRANSLATE_TEXT,
                'hasOutputParser': False,
                'messages': {'messageValues': [{'message': TRANSLATE_SYSTEM}]},
                'batching': {},
            },
        }
        nodes.append(llm)
    else:
        llm['parameters']['messages']['messageValues'][0]['message'] = TRANSLATE_SYSTEM
        llm['parameters']['text'] = TRANSLATE_TEXT

    apply_js = APPLY_LOCALIZATION_TEMPLATE.replace('%VALIDATE%', validate_name)
    apply = find(nodes, apply_name)
    if not apply:
        apply = {
            'id': new_id(),
            'name': apply_name,
            'type': 'n8n-nodes-base.code',
            'typeVersion': 2,
            'position': [llm['position'][0] + 192, llm['position'][1]],
            'parameters': {'jsCode': apply_js, 'mode': 'runOnceForAllItems'},
        }
        nodes.append(apply)
    else:
        apply['parameters']['jsCode'] = apply_js

    if not find(nodes, reject_name):
        pos = find(nodes, 'Reject Stage3')['position']
        reject = deepcopy(reject_tpl)
        reject['id'] = new_id()
        reject['name'] = reject_name
        reject['position'] = [pos[0] + 240, pos[1] + 160]
        reject['parameters']['jsonBody'] = (
            "={{ JSON.stringify({ candidateId: $('Webhook').item.json.body.candidateId, "
            "sessionId: $('Webhook').item.json.body.sessionId || '', stage: 3, "
            "evaluationSource: 'video', ingress: 'stage3-reject', rejectCode: $json.errorCategory || 'stage3_evaluation_incomplete', "
            "videoInterviewEvaluation: { summary: 'Stage 3 evaluation incomplete', overall_score: 0, recommendation: 'Reject', competencyScores: [] } }) }}"
        )
        nodes.append(reject)

    connections[extractor_name] = {'main': [[{'node': validate_name, 'type': 'main', 'index': 0}]]}
    connections[validate_name] = {'main': [[{'node': if_name, 'type': 'main', 'index': 0}]]}
    connections[if_name] = {
        'main': [
            [{'node': llm_name, 'type': 'main', 'index': 0}],
            [{'node': reject_name, 'type': 'main', 'index': 0}],
        ]
    }
    connections[llm_name] = {'main': [[{'node': apply_name, 'type': 'main', 'index': 0}]]}
    connections[apply_name] = {'main': [[{'node': http_name, 'type': 'main', 'index': 0}]]}
    connections[model_name] = {
        'ai_languageModel': [[{'node': llm_name, 'type': 'ai_languageModel', 'index': 0}]]
    }
    connections.setdefault(reject_name, {'main': [[]]})


def main() -> None:
    db_path = sys.argv[1] if len(sys.argv) > 1 else '/root/n8n-data-old/database.sqlite'
    con = sqlite3.connect(db_path)
    cur = con.cursor()
    row = cur.execute(
        'SELECT nodes, connections, activeVersionId FROM workflow_entity WHERE id = ?',
        (WF_ID,),
    ).fetchone()
    if not row:
        raise SystemExit(f'workflow {WF_ID} not found')

    nodes = json.loads(row[0])
    connections = json.loads(row[1])
    active_version_id = row[2]

    chain = find(nodes, 'Basic LLM Chain')
    chain1 = find(nodes, 'Basic LLM Chain1')
    model3 = find(nodes, 'OpenAI Chat Model3')
    reject_tpl = find(nodes, 'Reject Stage3')
    if not all([chain, chain1, model3, reject_tpl]):
        raise SystemExit('missing required Stage 3 nodes')

    for n, text in ((chain, CHAIN_TEXT), (chain1, CHAIN1_TEXT)):
        msg = n['parameters']['messages']['messageValues'][0]['message']
        n['parameters']['messages']['messageValues'][0]['message'] = clean_chain_message(msg)
        n['parameters']['text'] = '=' + text.lstrip('=')

    ensure_validate_and_translate(
        nodes,
        connections,
        model3,
        '4',
        '',
        'Information Extractor',
        'HTTP Request',
        reject_tpl,
    )
    ensure_validate_and_translate(
        nodes, connections, model3, '5', '2', 'Information Extractor2', 'HTTP Request1', reject_tpl
    )

    nodes_json = json.dumps(nodes)
    connections_json = json.dumps(connections)
    cur.execute(
        'UPDATE workflow_entity SET nodes = ?, connections = ? WHERE id = ?',
        (nodes_json, connections_json, WF_ID),
    )
    if active_version_id:
        cur.execute(
            'UPDATE workflow_history SET nodes = ?, connections = ? WHERE versionId = ?',
            (nodes_json, connections_json, active_version_id),
        )
    con.commit()
    con.close()
    print('patched Stage 3 EN-eval + validate + translate', WF_ID)


if __name__ == '__main__':
    main()
