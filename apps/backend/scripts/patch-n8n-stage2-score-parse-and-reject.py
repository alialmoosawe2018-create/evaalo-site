#!/usr/bin/env python3
"""
Stage 2 voice workflow (BB87WRQQYEiLdMsk):
- Fix Validate nodes: parse Overall-score formats like 63/100 (was blocking all callbacks)
- Wire If Stage 2 Eval Valid(false) -> Reject Incomplete Stage2 Eval -> backend callback

Run on VPS:
  python3 patch-n8n-stage2-score-parse-and-reject.py /root/n8n-data-old/database.sqlite
"""
from __future__ import annotations

import json
import sqlite3
import sys
import uuid

WF_ID = 'BB87WRQQYEiLdMsk'

VALIDATE_JS = r"""const items = $input.all();
const RATINGS = new Set(['excellent','good','intermediate','bad']);

function parseScore(raw) {
  if (raw == null) return NaN;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
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

function isRating(v) {
  if (v == null || typeof v === 'number') return false;
  const s = String(v).trim();
  return s.length > 0 && !/\s/.test(s) && RATINGS.has(s.toLowerCase());
}

function isText(v) {
  if (v == null) return false;
  const s = String(v).trim();
  return s.length > 0 && !/^(undefined|null|nan|n\/a)$/i.test(s);
}

function isAttitude(v) {
  if (!isText(v)) return false;
  const s = String(v).trim();
  if (RATINGS.has(s.toLowerCase())) return false;
  const words = s.split(/\s+/).filter(Boolean);
  return words.length >= 2 || s.length >= 30;
}

function listOk(v) {
  if (Array.isArray(v)) return v.some((x) => isText(x));
  return isText(v);
}

function metricToRating(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  if (x >= 8) return 'Excellent';
  if (x >= 6) return 'Good';
  if (x >= 4) return 'Intermediate';
  return 'Bad';
}

function fillFromPrecalc(o) {
  const body = $('Webhook').first().json.body || {};
  const ev = body.evaluation || {};
  const map = [
    ['Communication Skills', ev.communicationSkills],
    ['English Fluency', ev.englishFluency],
    ['Confidence Level', ev.confidenceLevel],
  ];
  for (const [field, metric] of map) {
    if (!isRating(o[field])) {
      const word = metricToRating(metric);
      if (word) o[field] = word;
    }
  }
  return o;
}

return items.map((item) => {
  const o = { ...(item.json.output ?? {}) };
  fillFromPrecalc(o);
  const scoreNum = parseScore(o['Overall-score']);
  const scoreOk = Number.isFinite(scoreNum) && scoreNum >= 0 && scoreNum <= 100;
  if (scoreOk) o['Overall-score'] = scoreNum;
  const rec = String(o.Recommendation ?? '').trim();
  const recOk = rec === 'Hire' || rec === 'Consider' || rec === 'Reject';
  const valid = isRating(o['Communication Skills'])
    && isRating(o['English Fluency'])
    && isRating(o['Confidence Level'])
    && isRating(o['Computer Skills'])
    && isRating(o['Problem Solving'])
    && isAttitude(o['Professional Attitude'])
    && isText(o.Summary)
    && listOk(o.Strengths)
    && listOk(o.Weaknesses)
    && isText(o['Final HR Evaluation'])
    && scoreOk
    && recOk;
  return {
    json: {
      valid,
      errorCategory: valid ? null : 'stage2_evaluation_incomplete',
      output: o,
    },
    binary: item.binary,
  };
});"""


def new_id() -> str:
    return str(uuid.uuid4())


def find(nodes, name: str):
    for n in nodes:
        if n.get('name') == name:
            return n
    return None


def ensure_reject_incomplete(nodes, connections, http_reject_template):
    name = 'Reject Incomplete Stage2 Eval'
    if not find(nodes, name):
        pos = find(nodes, 'Reject Stage2')['position']
        node = {
            'id': new_id(),
            'name': name,
            'type': 'n8n-nodes-base.httpRequest',
            'typeVersion': 4.2,
            'position': [pos[0] + 240, pos[1] + 120],
            'parameters': json.loads(json.dumps(http_reject_template['parameters'])),
        }
        nodes.append(node)
    else:
        node = find(nodes, name)

    node['parameters']['bodyParameters'] = {
        'parameters': [
            {'name': 'candidateId', 'value': "={{ $('Webhook').item.json.body.candidateId }}"},
            {'name': 'sessionId', 'value': "={{ $('Webhook').item.json.body.sessionId || '' }}"},
            {'name': 'overall_score', 'value': '0'},
            {'name': 'Recommendation', 'value': 'Reject'},
            {
                'name': 'Summary',
                'value': "={{ 'Stage 2 evaluation incomplete: ' + ($json.errorCategory || 'validation_failed') }}",
            },
            {'name': 'rejectCode', 'value': "={{ $json.errorCategory || 'stage2_evaluation_incomplete' }}"},
            {'name': 'ingress', 'value': 'stage2-reject'},
            {'name': 'stage', 'value': '2'},
            {'name': 'evaluationSource', 'value': 'voice'},
        ]
    }
    return name


def wire_invalid_branch(connections, if_name: str, reject_name: str) -> None:
    entry = connections.setdefault(if_name, {})
    mains = entry.setdefault('main', [[], []])
    while len(mains) < 2:
        mains.append([])
    mains[1] = [{'node': reject_name, 'type': 'main', 'index': 0}]


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

    for name in ('Validate Stage 2 Output', 'Validate Stage 2 Output2'):
        n = find(nodes, name)
        if not n:
            raise SystemExit(f'missing {name}')
        n['parameters']['jsCode'] = VALIDATE_JS
        n['parameters']['mode'] = 'runOnceForAllItems'

    reject_tpl = find(nodes, 'Reject Stage2')
    reject_name = ensure_reject_incomplete(nodes, connections, reject_tpl)
    wire_invalid_branch(connections, 'If Stage 2 Eval Valid', reject_name)
    wire_invalid_branch(connections, 'If Stage 2 Eval Valid2', reject_name)
    connections.setdefault(reject_name, {'main': [[]]})

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
    print('patched Stage 2 score parse + incomplete reject callback', WF_ID)


if __name__ == '__main__':
    main()
