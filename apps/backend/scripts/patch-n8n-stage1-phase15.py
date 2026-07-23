#!/usr/bin/env python3
"""Patch live n8n Stage 1 workflow for Phase 1.5 (stdlib sqlite3 only)."""
import json
import re
import sqlite3
import sys
from pathlib import Path

DB = sys.argv[1] if len(sys.argv) > 1 else '/root/n8n-data-old/database.sqlite'
WF_ID = 'tk2tAop5hzSjGSqv'
MJS = Path(__file__).resolve().parent / 'campaign-compare-stage1-phase15-prompt.mjs'


def extract_backtick(name: str, text: str) -> str:
    m = re.search(rf"export const {name} = `(.*?)`;", text, re.S)
    if not m:
        raise ValueError(f'missing export {name}')
    return m.group(1)


def extract_single_quoted(name: str, text: str) -> str:
    m = re.search(rf"export const {name} =\s*\n?\s*'(.*?)';", text, re.S)
    if not m:
        raise ValueError(f'missing export {name}')
    return m.group(1)


def main() -> None:
    text = MJS.read_text(encoding='utf-8')
    llm_system = extract_backtick('LLM_SYSTEM', text)
    build_code = extract_backtick('BUILD_CALLBACK_CODE', text)
    format_email = extract_backtick('FORMAT_EMAIL_CODE', text)
    callback_json = extract_single_quoted('CALLBACK_JSON_BODY', text)

    conn = sqlite3.connect(DB)
    row = conn.execute(
        'SELECT nodes, activeVersionId FROM workflow_entity WHERE id = ?', (WF_ID,)
    ).fetchone()
    if not row:
        raise SystemExit(f'workflow {WF_ID} not found')

    nodes = json.loads(row[0])
    llm = next(n for n in nodes if n.get('name') == 'Compare Stage 1 LLM')
    build = next(n for n in nodes if n.get('name') == 'Build Callback Body')
    callback = next(n for n in nodes if n.get('name') == 'Callback to Backend')
    format_node = next((n for n in nodes if n.get('name') == 'Format Email'), None)

    llm['parameters']['messages']['messageValues'][0]['message'] = llm_system
    build['parameters']['jsCode'] = build_code
    callback['parameters']['jsonBody'] = callback_json
    if format_node:
        format_node['parameters']['jsCode'] = format_email

    nodes_json = json.dumps(nodes, ensure_ascii=False)
    conn.execute('UPDATE workflow_entity SET nodes = ? WHERE id = ?', (nodes_json, WF_ID))
    active_version = row[1]
    if active_version:
        conn.execute(
            'UPDATE workflow_history SET nodes = ? WHERE versionId = ?',
            (nodes_json, active_version),
        )
    conn.commit()
    conn.close()
    print('patched Phase 1.5 on', WF_ID, 'activeVersionId', active_version)


if __name__ == '__main__':
    main()
