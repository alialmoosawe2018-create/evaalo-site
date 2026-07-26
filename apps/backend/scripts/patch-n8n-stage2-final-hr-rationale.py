#!/usr/bin/env python3
"""
Stage 2 voice workflow (BB87WRQQYEiLdMsk):
- Reinforce competency fields = one rating word only (Excellent/Good/Intermediate/Bad)
- Extend Final HR Evaluation with integrated Rating Rationale paragraph (within same section)

Run on VPS:
  python3 patch-n8n-stage2-final-hr-rationale.py /root/n8n-data-old/database.sqlite
"""
from __future__ import annotations

import json
import sqlite3
import sys

WF_ID = 'BB87WRQQYEiLdMsk'

OLD_JUSTIFICATION_NO_CRITERIA = (
    '- **Justification:** [A definitive explanation for the final decision, weighing the pre-calculated metrics, the professional skills assessment, and the transcript analysis against the demands of the role.]'
)

NEW_JUSTIFICATION_NO_CRITERIA = (
    '- **Justification:** [A definitive explanation for the final decision, weighing the pre-calculated metrics, the professional skills assessment, and the transcript analysis against the demands of the role.]\n'
    '- **Rating Rationale:** [One integrated paragraph (4–6 sentences) that stays INSIDE this Final HR Evaluation section — do NOT create a separate report section or JSON field. '
    'Explain WHY each competency received its assigned one-word rating, naming each explicitly: Communication Skills, English Fluency, Confidence Level, Problem Solving, and Computer Skills. '
    'Cite brief transcript evidence for each. Example flow: "Communication Skills was rated Good because…; English Fluency received Intermediate due to…; Confidence Level was rated Bad because…; Problem Solving earned Excellent because…; Computer Skills was rated Bad because…"]'
)

OLD_JUSTIFICATION_CRITERIA = (
    '- **Justification:** [A definitive explanation for the final decision, weighing the pre-calculated metrics, the custom skills assessment, and the transcript analysis against the demands of the role.]'
)

NEW_JUSTIFICATION_CRITERIA = (
    '- **Justification:** [A definitive explanation for the final decision, weighing the pre-calculated metrics, the custom skills assessment, and the transcript analysis against the demands of the role.]\n'
    '- **Rating Rationale:** [One integrated paragraph (4–6 sentences) that stays INSIDE this Final HR Evaluation section — do NOT create a separate report section or JSON field. '
    'Explain WHY each competency received its assigned one-word rating, naming Communication Skills, English Fluency, Confidence Level, Problem Solving, Computer Skills, and any Custom Professional Skills criteria. '
    'Cite brief transcript evidence for each.]'
)

OLD_FINAL_HR_EXTRACTOR = ' Final HR justification without the quotes '

NEW_FINAL_HR_EXTRACTOR = (
    'The complete Final HR Evaluation narrative for HR display: include the overall decision justification '
    'AND an integrated Rating Rationale paragraph explaining why Communication Skills, English Fluency, '
    'Confidence Level, Problem Solving, and Computer Skills each received their one-word rating '
    '(Excellent/Good/Intermediate/Bad), with brief evidence — all as one continuous text block without markdown headers.'
)

RATING_RULE_INSERT = (
    '\n\n**Competency rating fields (structured output):** Communication Skills, English Fluency, Confidence Level, '
    'Problem Solving, and Computer Skills must each be EXACTLY one English word: Excellent, Good, Intermediate, or Bad. '
    'No numbers, no phrases, no sentences in those fields — only the rating word. Narrative explanations belong in '
    'Professional Attitude, Summary, Weaknesses, or the Rating Rationale inside Final HR Evaluation.\n'
)


def find(nodes, name: str):
    for n in nodes:
        if n.get('name') == name:
            return n
    return None


def patch_chain_message(msg: str, old_just: str, new_just: str) -> str:
    if old_just not in msg:
        if new_just.split('\n')[0] in msg:
            return msg  # already patched
        raise SystemExit(f'missing justification block in chain message')
    out = msg.replace(old_just, new_just, 1)
    if RATING_RULE_INSERT.strip() not in out and '**Competency rating fields (structured output):**' not in out:
        marker = '**Evaluation Instructions:**'
        if marker in out:
            out = out.replace(marker, marker + RATING_RULE_INSERT, 1)
    return out


def patch_extractor(node) -> None:
    attrs = node['parameters']['attributes']['attributes']
    for a in attrs:
        if a.get('name') == 'Final HR Evaluation':
            a['description'] = NEW_FINAL_HR_EXTRACTOR
            return
    raise SystemExit(f'Final HR Evaluation attribute missing in {node.get("name")}')


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
    active_version_id = row[2]

    chain = find(nodes, 'Basic LLM Chain')
    chain1 = find(nodes, 'Basic LLM Chain1')
    ext = find(nodes, 'Information Extractor')
    ext2 = find(nodes, 'Information Extractor2')
    if not all([chain, chain1, ext, ext2]):
        raise SystemExit('missing required nodes')

    for n, old_j, new_j in (
        (chain, OLD_JUSTIFICATION_NO_CRITERIA, NEW_JUSTIFICATION_NO_CRITERIA),
        (chain1, OLD_JUSTIFICATION_CRITERIA, NEW_JUSTIFICATION_CRITERIA),
    ):
        p = n['parameters']
        msg = p['messages']['messageValues'][0]['message']
        p['messages']['messageValues'][0]['message'] = patch_chain_message(msg, old_j, new_j)

    patch_extractor(ext)
    patch_extractor(ext2)

    nodes_json = json.dumps(nodes)
    connections_json = row[1]
    cur.execute(
        'UPDATE workflow_entity SET nodes = ? WHERE id = ?',
        (nodes_json, WF_ID),
    )
    if active_version_id:
        cur.execute(
            'UPDATE workflow_history SET nodes = ? WHERE versionId = ?',
            (nodes_json, active_version_id),
        )
    con.commit()
    con.close()
    print('patched Stage 2 Final HR Rating Rationale + competency one-word rule', WF_ID)


if __name__ == '__main__':
    main()
