#!/usr/bin/env python3
"""
Patch Stage 2 voice evaluation workflow (BB87WRQQYEiLdMsk):
- EN-only LLM evaluation (both criteria branches)
- Post-extractor translation from Webhook body.language (UI/share link)
- Rewire both HTTP callback paths

Run on VPS:
  python3 patch-n8n-stage2-written-en-translate.py /root/n8n-data-old/database.sqlite
"""
from __future__ import annotations

import json
import re
import sqlite3
import sys
import uuid
from copy import deepcopy

WF_ID = 'BB87WRQQYEiLdMsk'

STRICT_BLOCK_RE = re.compile(
    r'\*\*Output Language \(STRICT — HIGHEST PRIORITY\):\*\*.*?(?=\*\*System Role:\*\*)',
    re.DOTALL,
)

EN_RULE = (
    '**Language rule (evaluation output):** Write the ENTIRE evaluation report in English only. '
    'The interview transcript may be Arabic, English, or mixed (including an English proficiency test) — '
    'use all transcript content as evidence only. All narrative text (Executive Summary, Strengths, '
    'Weaknesses, Professional Attitude, Justification) must be in English. '
    'Keep Recommendation as Hire / Consider / Reject and skill ratings as Excellent / Good / Intermediate / Bad.\n\n'
)

CHAIN_TEXT = '= full transcript of the interview: {{ $json.body.fullTranscript }}'

CHAIN1_TEXT = (
    '= full transcript of the interview: {{ $json.body.fullTranscript }}\n\n'
    'criteria: {{ $json.body.criteria }}'
)

TRANSLATE_SYSTEM = """=You localize a Stage 2 voice interview evaluation JSON for HR/candidate display.

Target output language code: {{ $('Webhook').item.json.body.language || 'ar' }}

Rules:
- If the target code is "en" (or starts with "en-"), return the input JSON unchanged.
- If the target is "ar" (Arabic UI; Kurdish share links map to ar in the backend), translate these narrative fields to Modern Standard Arabic: Summary, Strengths, Weaknesses, Final HR Evaluation, Professional Attitude.
- NEVER change: Recommendation (must stay Hire, Consider, or Reject), Communication Skills, English Fluency, Confidence Level, Computer Skills, Problem Solving (keep Excellent/Good/Intermediate/Bad), Overall-score (numeric).
- Return ONE valid JSON object with exactly the same keys as the input.
- No markdown, no commentary."""

TRANSLATE_TEXT = '=Input evaluation JSON (English):\n{{ JSON.stringify($json.output) }}'

APPLY_LOCALIZATION = r"""const items = $input.all();

function parseJsonLoose(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  s = s.replace(/^\`\`\`(?:json)?\s*/i, '').replace(/\s*\`\`\`$/i, '').trim();
  try { return JSON.parse(s); } catch { return null; }
}

function targetLang() {
  const raw = String($('Webhook').first().json.body?.language || 'ar').trim().toLowerCase();
  if (raw === 'en' || raw.startsWith('en-')) return 'en';
  return 'ar';
}

return items.map((item) => {
  const original = item.json.output && typeof item.json.output === 'object' ? item.json.output : {};
  if (targetLang() === 'en') {
    return { json: { output: original }, binary: item.binary };
  }
  let o = parseJsonLoose(item.json.output ?? item.json.text ?? item.json);
  if (o && o.output && typeof o.output === 'object') o = o.output;
  const merged = { ...original, ...(o && typeof o === 'object' ? o : {}) };
  return { json: { output: merged }, binary: item.binary };
});"""


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


def ensure_translate_path(
    nodes,
    connections,
    model_src,
    model_num,
    branch_id,
    extractor_name,
    http_name,
    edit_fields_name,
):
    model_name = f'OpenAI Chat Model{model_num}'
    llm_name = f'Stage 2 Translate LLM{branch_id}'
    apply_name = f'Apply Stage 2 Localization{branch_id}'

    model = find(nodes, model_name)
    if not model:
        model = deepcopy(model_src)
        model['id'] = new_id()
        model['name'] = model_name
        model['position'] = [model_src['position'][0] + 400, model_src['position'][1] + 160]
        nodes.append(model)

    llm = find(nodes, llm_name)
    if not llm:
        llm = {
            'id': new_id(),
            'name': llm_name,
            'type': '@n8n/n8n-nodes-langchain.chainLlm',
            'typeVersion': 1.9,
            'position': [find(nodes, extractor_name)['position'][0] + 200, find(nodes, extractor_name)['position'][1]],
            'parameters': {
                'promptType': 'define',
                'text': TRANSLATE_TEXT,
                'hasOutputParser': False,
                'messages': {'messageValues': [{'message': TRANSLATE_SYSTEM}]},
                'batching': {},
            },
        }
        nodes.append(llm)

    apply = find(nodes, apply_name)
    if not apply:
        apply = {
            'id': new_id(),
            'name': apply_name,
            'type': 'n8n-nodes-base.code',
            'typeVersion': 2,
            'position': [llm['position'][0] + 192, llm['position'][1]],
            'parameters': {'jsCode': APPLY_LOCALIZATION, 'mode': 'runOnceForAllItems'},
        }
        nodes.append(apply)

    llm['parameters']['messages']['messageValues'][0]['message'] = TRANSLATE_SYSTEM
    llm['parameters']['text'] = TRANSLATE_TEXT
    apply['parameters']['jsCode'] = APPLY_LOCALIZATION

    connections[extractor_name] = {
        'main': [
            [
                {'node': llm_name, 'type': 'main', 'index': 0},
                {'node': edit_fields_name, 'type': 'main', 'index': 0},
            ]
        ]
    }
    connections[llm_name] = {
        'main': [[{'node': apply_name, 'type': 'main', 'index': 0}]]
    }
    connections[apply_name] = {
        'main': [[{'node': http_name, 'type': 'main', 'index': 0}]]
    }
    connections[model_name] = {
        'ai_languageModel': [[{'node': llm_name, 'type': 'ai_languageModel', 'index': 0}]]
    }


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
    if not chain or not chain1 or not model3:
        raise SystemExit('missing Basic LLM Chain / Basic LLM Chain1 / OpenAI Chat Model3')

    for n, text in ((chain, CHAIN_TEXT), (chain1, CHAIN1_TEXT)):
        msg = n['parameters']['messages']['messageValues'][0]['message']
        n['parameters']['messages']['messageValues'][0]['message'] = clean_chain_message(msg)
        n['parameters']['text'] = text

    ensure_translate_path(
        nodes, connections, model3, '4', '', 'Information Extractor', 'HTTP Request', 'Edit Fields 1'
    )
    ensure_translate_path(
        nodes, connections, model3, '5', '2', 'Information Extractor2', 'HTTP Request1', 'Edit Fields 2'
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
    print('patched Stage 2 EN-eval + translate workflow', WF_ID)
    print('updated: Basic LLM Chain, Basic LLM Chain1')
    print('added/rewired: Translate LLM + Apply Localization on both callback paths')


if __name__ == '__main__':
    main()
