#!/usr/bin/env python3
"""
Patch live Stage 1 written evaluation workflow (93b459bc-4db3-4829-822a-1b9e4c39ac00):
- Remove all language-mixing instructions from evaluation LLM
- Require summary + fit_for_role in validation
- Insert EN→locale translation LLM before callback HTTP Request

Run on VPS:
  python3 patch-n8n-stage1-written-en-translate.py /root/n8n-data-old/database.sqlite
"""
from __future__ import annotations

import json
import sqlite3
import sys
import uuid
from copy import deepcopy

WF_ID = '93b459bc-4db3-4829-822a-1b9e4c39ac00'

STAGE1_EVAL_LLM_SYSTEM = """=You are an Expert HR Screener and Senior Recruiter.

Target Job Role: {{ $('Webhook').item.json.body.position_applied_for }}
Employer's Campaign Criteria: {{ $('Webhook').item.json.body.criteria }}

Write the ENTIRE evaluation in English only. Do not use Arabic, Kurdish, or mixed languages in any narrative field.

Return ONE JSON object only. No markdown, no code fences, no prose outside JSON.

Required keys (all mandatory — never omit or leave empty):
- overall_score: number 0-100
- recommendation: exactly one of Hire, Consider, Reject (English token)
- strengths: non-empty array of English strings
- weaknesses: non-empty array of English strings
- red_flags: array of strings (use [] when none)
- summary: non-empty English string (2–4 sentences)
- fit_for_role: non-empty English string describing suitability for the role
- final_hr_evaluation: non-empty English string (HR decision paragraph)

Never output N/A, null, placeholder text, or empty strings for required fields."""

STAGE1_EVAL_LLM_TEXT = """=criteria:
{{ $('Webhook').item.json.body.criteria }}

candidate info:
full name: {{ $('Webhook').item.json.body.full_name }}
position applied for: {{ $('Webhook').item.json.body.position_applied_for }}
years of experience: {{ $('Webhook').item.json.body.years_of_experience }}
current company: {{ $('Webhook').item.json.body.current_company }}
location: {{ $('Webhook').item.json.body.location }}
highest education: {{ $('Webhook').item.json.body.highest_education_level }}
skills: {{ $('Webhook').item.json.body.skills }}
languages: {{ $('Webhook').item.json.body.languages }}
certifications: {{ $('Webhook').item.json.body.certifications }}
salary: {{ $('Webhook').item.json.body.salaryMin }}-{{ $('Webhook').item.json.body.salaryMax }} {{ $('Webhook').item.json.body.salaryCurrency }}
availability: {{ $('Webhook').item.json.body.availability }}
cover letter: {{ $('Webhook').item.json.body.coverLetter }}
linkedin: {{ $('Webhook').item.json.body.linkedin }}

CV:
{{ $('Message a model').item.json.output[0].content[0].text }}"""

VALIDATE_STAGE1_EVAL_CODE = """const items = $input.all();
const INVALID_TEXT = new Set(['', 'undefined', 'null', 'nan', 'n/a']);
function isValidHrText(v) {
  if (v === undefined || v === null) return false;
  const s = String(v).trim();
  return s.length > 0 && !INVALID_TEXT.has(s.toLowerCase());
}
function isNonEmptyTextArray(arr) {
  return Array.isArray(arr) && arr.length > 0 && arr.some((x) => isValidHrText(x));
}
return items.map((item) => {
  let o = item.json.output ?? item.json.text ?? item.json;
  if (typeof o === 'string') {
    try { o = JSON.parse(o); } catch { o = {}; }
  }
  if (o && typeof o === 'object' && o.output && typeof o.output === 'object') {
    o = o.output;
  }
  const REC = new Set(['Hire', 'Consider', 'Reject']);
  const score = Number(o.overall_score);
  const scoreOk = Number.isFinite(score) && score >= 0 && score <= 100;
  const rec = typeof o.recommendation === 'string' ? o.recommendation.trim() : '';
  const recOk = REC.has(rec);
  const strOk = isNonEmptyTextArray(o.strengths);
  const weakOk = isNonEmptyTextArray(o.weaknesses);
  const finalHrOk = isValidHrText(o.final_hr_evaluation);
  const summaryOk = isValidHrText(o.summary);
  const fitOk = isValidHrText(o.fit_for_role);
  const valid = scoreOk && recOk && strOk && weakOk && finalHrOk && summaryOk && fitOk;
  return {
    json: {
      valid,
      errorCategory: valid ? null : 'stage1_evaluation_incomplete',
      evaluation: {
        overall_score: scoreOk ? score : undefined,
        recommendation: recOk ? rec : undefined,
        strengths: strOk ? o.strengths : [],
        weaknesses: weakOk ? o.weaknesses : [],
        summary: summaryOk ? String(o.summary).trim() : undefined,
        fit_for_role: fitOk ? String(o.fit_for_role).trim() : undefined,
        final_hr_evaluation: finalHrOk ? String(o.final_hr_evaluation).trim() : undefined,
        red_flags: Array.isArray(o.red_flags) ? o.red_flags : [],
      },
    },
    binary: item.binary,
  };
});"""

STAGE1_TRANSLATE_LLM_SYSTEM = """=You localize a Stage 1 written HR evaluation JSON for display to the candidate/recruiter.

Target output language code: {{ $('Webhook').item.json.body.evaluationLanguage || 'ar' }}

Rules:
- If the target code is "en", return the input JSON unchanged (identical keys and English values).
- If the target is "ar" (Arabic UI, including Kurdish users mapped to ar), translate every narrative string and every item in strengths, weaknesses, and red_flags to Modern Standard Arabic.
- NEVER change overall_score (keep as number).
- NEVER change recommendation — it must stay exactly one of: Hire, Consider, Reject (English tokens only).
- Return ONE valid JSON object with keys: overall_score, recommendation, strengths, weaknesses, red_flags, summary, fit_for_role, final_hr_evaluation.
- No markdown, no commentary, no extra keys."""

STAGE1_TRANSLATE_LLM_TEXT = """=Input evaluation JSON (English):
{{ JSON.stringify($('Validate Stage 1 Evaluation Output').item.json.evaluation) }}"""

APPLY_STAGE1_LOCALIZATION_CODE = """const items = $input.all();

function parseJsonLoose(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  s = s.replace(/^\\`\\`\\`(?:json)?\\s*/i, '').replace(/\\s*\\`\\`\\`$/i, '').trim();
  try { return JSON.parse(s); } catch { return null; }
}

function pickEval(item) {
  const validated = $('Validate Stage 1 Evaluation Output').first().json.evaluation;
  let o = parseJsonLoose(item.json.output ?? item.json.text ?? item.json);
  if (o && o.output && typeof o.output === 'object') o = o.output;
  if (!o || typeof o !== 'object') o = validated;
  const lang = String($('Webhook').first().json.body?.evaluationLanguage || 'ar').trim().toLowerCase();
  if (lang === 'en') return validated;
  const merged = { ...validated, ...o };
  return {
    overall_score: merged.overall_score,
    recommendation: merged.recommendation,
    strengths: merged.strengths,
    weaknesses: merged.weaknesses,
    red_flags: merged.red_flags ?? [],
    summary: merged.summary,
    fit_for_role: merged.fit_for_role,
    final_hr_evaluation: merged.final_hr_evaluation,
  };
}

return items.map((item) => ({
  json: {
    valid: true,
    evaluation: pickEval(item),
  },
  binary: item.binary,
}));"""


def new_id() -> str:
    return str(uuid.uuid4())


def find(nodes, name: str):
    for n in nodes:
        if n.get('name') == name:
            return n
    return None


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

    eval_llm = find(nodes, 'Stage 1 Evaluation LLM')
    validate = find(nodes, 'Validate Stage 1 Evaluation Output')
    model3 = find(nodes, 'OpenAI Chat Model3')
    if not eval_llm or not validate or not model3:
        raise SystemExit('missing Stage 1 Evaluation LLM / Validate / OpenAI Chat Model3')

    eval_llm['parameters']['messages']['messageValues'][0]['message'] = STAGE1_EVAL_LLM_SYSTEM
    eval_llm['parameters']['text'] = STAGE1_EVAL_LLM_TEXT
    validate['parameters']['jsCode'] = VALIDATE_STAGE1_EVAL_CODE

    translate_model = find(nodes, 'OpenAI Chat Model4')
    translate_llm = find(nodes, 'Stage 1 Translate LLM')
    apply_local = find(nodes, 'Apply Stage 1 Localization')

    if not translate_model:
        translate_model = deepcopy(model3)
        translate_model['id'] = new_id()
        translate_model['name'] = 'OpenAI Chat Model4'
        translate_model['position'] = [1984, -208]
        nodes.append(translate_model)

    if not translate_llm:
        translate_llm = {
            'id': new_id(),
            'name': 'Stage 1 Translate LLM',
            'type': '@n8n/n8n-nodes-langchain.chainLlm',
            'typeVersion': 1.9,
            'position': [1984, -368],
            'parameters': {
                'promptType': 'define',
                'text': STAGE1_TRANSLATE_LLM_TEXT,
                'hasOutputParser': False,
                'messages': {'messageValues': [{'message': STAGE1_TRANSLATE_LLM_SYSTEM}]},
                'batching': {},
            },
        }
        nodes.append(translate_llm)

    if not apply_local:
        apply_local = {
            'id': new_id(),
            'name': 'Apply Stage 1 Localization',
            'type': 'n8n-nodes-base.code',
            'typeVersion': 2,
            'position': [2176, -368],
            'parameters': {'jsCode': APPLY_STAGE1_LOCALIZATION_CODE, 'mode': 'runOnceForAllItems'},
        }
        nodes.append(apply_local)

    translate_llm['parameters']['messages']['messageValues'][0]['message'] = STAGE1_TRANSLATE_LLM_SYSTEM
    translate_llm['parameters']['text'] = STAGE1_TRANSLATE_LLM_TEXT
    apply_local['parameters']['jsCode'] = APPLY_STAGE1_LOCALIZATION_CODE

    connections['If Evaluation Valid'] = {
        'main': [[{'node': 'Stage 1 Translate LLM', 'type': 'main', 'index': 0}], []]
    }
    connections['Stage 1 Translate LLM'] = {
        'main': [[{'node': 'Apply Stage 1 Localization', 'type': 'main', 'index': 0}]]
    }
    connections['Apply Stage 1 Localization'] = {
        'main': [[{'node': 'HTTP Request', 'type': 'main', 'index': 0}]]
    }
    connections['OpenAI Chat Model4'] = {
        'ai_languageModel': [[{'node': 'Stage 1 Translate LLM', 'type': 'ai_languageModel', 'index': 0}]]
    }

    nodes_json = json.dumps(nodes)
    connections_json = json.dumps(connections)
    cur.execute('UPDATE workflow_entity SET nodes = ?, connections = ? WHERE id = ?', (nodes_json, connections_json, WF_ID))
    if active_version_id:
        cur.execute(
            'UPDATE workflow_history SET nodes = ?, connections = ? WHERE versionId = ?',
            (nodes_json, connections_json, active_version_id),
        )
    con.commit()
    con.close()
    print('patched Stage 1 written EN-eval + translate workflow', WF_ID)
    print('updated: Stage 1 Evaluation LLM, Validate Stage 1 Evaluation Output')
    print('added/updated: OpenAI Chat Model4, Stage 1 Translate LLM, Apply Stage 1 Localization')
    print('rewired: If Evaluation Valid -> Translate -> Apply -> HTTP Request')


if __name__ == '__main__':
    main()
