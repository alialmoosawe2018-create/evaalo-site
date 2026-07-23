#!/usr/bin/env python3
"""Patch live n8n Stage 2 + create/patch Stage 3 Campaign Compare workflows (Phase 1.5)."""
import json
import re
import sqlite3
import sys
import uuid
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path

DB = sys.argv[1] if len(sys.argv) > 1 else '/root/n8n-data-old/database.sqlite'
PAYLOAD = Path(__file__).resolve().parent / 'patch-payload-stage23.json'
STAGE1_ID = 'tk2tAop5hzSjGSqv'
STAGE2_ID = '3W02FGgYp0o0hqIi'


def load_payload() -> dict:
    return json.loads(PAYLOAD.read_text(encoding='utf-8'))


def extract_email_branch_nodes(stage1_nodes: list) -> list:
    names = {
        'Route Mode',
        'Format Email',
        'Send Compare Email',
        'Respond Email Success',
        'Respond Compare Accepted',
    }
    return [deepcopy(n) for n in stage1_nodes if n.get('name') in names]


def ensure_email_branch(nodes: list, connections: dict, format_email_code: str) -> None:
    branch = extract_email_branch_nodes(
        json.loads(
            sqlite3.connect(DB)
            .execute('SELECT nodes FROM workflow_entity WHERE id = ?', (STAGE1_ID,))
            .fetchone()[0]
        )
    )
    by_name = {n['name']: n for n in branch}
    if 'Format Email' in by_name:
        by_name['Format Email']['parameters']['jsCode'] = format_email_code

    existing = {n['name'] for n in nodes}
    for n in branch:
        if n['name'] not in existing:
            nodes.append(n)

    webhook = next(n for n in nodes if n['name'] == 'Webhook')
    webhook['parameters']['responseMode'] = 'responseNode'

    connections['Webhook'] = {'main': [[{'node': 'Route Mode', 'type': 'main', 'index': 0}]]}
    connections['Route Mode'] = {
        'main': [
            [{'node': 'Format Email', 'type': 'main', 'index': 0}],
            [{'node': 'Respond Compare Accepted', 'type': 'main', 'index': 0}],
        ]
    }
    connections['Format Email'] = {'main': [[{'node': 'Send Compare Email', 'type': 'main', 'index': 0}]]}
    connections['Send Compare Email'] = {
        'main': [[{'node': 'Respond Email Success', 'type': 'main', 'index': 0}]]
    }
    connections['Respond Compare Accepted'] = {
        'main': [[{'node': 'Validate Inbound Secret', 'type': 'main', 'index': 0}]]
    }


def patch_stage2(conn: sqlite3.Connection, payload: dict) -> None:
    row = conn.execute(
        'SELECT nodes, connections, activeVersionId FROM workflow_entity WHERE id = ?',
        (STAGE2_ID,),
    ).fetchone()
    if not row:
        raise SystemExit(f'stage2 workflow {STAGE2_ID} not found')

    nodes = json.loads(row[0])
    connections = json.loads(row[1])
    s2 = payload['s2']

    next(n for n in nodes if n['name'] == 'Validate Inbound Secret')['parameters']['jsCode'] = s2['VALIDATE']
    llm = next(n for n in nodes if 'Stage 2 LLM' in n['name'])
    llm['parameters']['messages']['messageValues'][0]['message'] = s2['LLM']
    llm['parameters']['text'] = s2['PROMPT']
    next(n for n in nodes if n['name'] == 'Build Callback Body')['parameters']['jsCode'] = s2['BUILD']
    next(n for n in nodes if n['name'] == 'Callback to Backend')['parameters']['jsonBody'] = s2['CALLBACK']

    ensure_email_branch(nodes, connections, s2['EMAIL'])

    nodes_json = json.dumps(nodes, ensure_ascii=False)
    connections_json = json.dumps(connections, ensure_ascii=False)
    conn.execute(
        'UPDATE workflow_entity SET nodes = ?, connections = ?, active = 1 WHERE id = ?',
        (nodes_json, connections_json, STAGE2_ID),
    )
    if row[2]:
        conn.execute(
            'UPDATE workflow_history SET nodes = ?, connections = ? WHERE versionId = ?',
            (nodes_json, connections_json, row[2]),
        )
    print('patched stage2', STAGE2_ID, 'active=1', 'build_len', len(s2['BUILD']))


def find_stage3_workflow(conn: sqlite3.Connection) -> str | None:
    for wf_id, name in conn.execute('SELECT id, name FROM workflow_entity'):
        if 'Stage 3' in name and 'Compare' in name:
            return wf_id
    return None


def new_webhook_path() -> str:
    return str(uuid.uuid4())


def build_stage3_workflow(payload: dict, webhook_path: str, template_nodes: list, template_connections: dict) -> tuple[list, dict]:
    """Clone stage2 topology, adapt for stage3 Prepare LLM node."""
    s3 = payload['s3']
    nodes = deepcopy(template_nodes)
    connections = deepcopy(template_connections)

    # Rename LLM node
    for n in nodes:
        if n['name'] == 'Compare Stage 2 LLM':
            n['name'] = 'Compare Stage 3 LLM'
        if n['name'] == 'Webhook':
            n['parameters']['path'] = webhook_path
            n['webhookId'] = webhook_path

    # Insert Prepare LLM Context if missing
    if not any(n['name'] == 'Prepare LLM Context' for n in nodes):
        prepare = {
            'parameters': {'jsCode': s3['PREPARE']},
            'type': 'n8n-nodes-base.code',
            'typeVersion': 2,
            'position': [480, 0],
            'id': str(uuid.uuid4()),
            'name': 'Prepare LLM Context',
        }
        nodes.append(prepare)
        connections['Validate Inbound Secret'] = {
            'main': [[{'node': 'Prepare LLM Context', 'type': 'main', 'index': 0}]]
        }
        connections['Prepare LLM Context'] = {
            'main': [[{'node': 'Compare Stage 3 LLM', 'type': 'main', 'index': 0}]]
        }
    else:
        next(n for n in nodes if n['name'] == 'Prepare LLM Context')['parameters']['jsCode'] = s3['PREPARE']

    connections['Respond Compare Accepted'] = {
        'main': [[{'node': 'Validate Inbound Secret', 'type': 'main', 'index': 0}]]
    }

    llm_name = 'Compare Stage 3 LLM'
    next(n for n in nodes if n['name'] == 'Validate Inbound Secret')['parameters']['jsCode'] = s3['VALIDATE']
    llm = next(n for n in nodes if n['name'] == llm_name)
    llm['parameters']['messages']['messageValues'][0]['message'] = s3['LLM']
    llm['parameters']['text'] = s3['PROMPT']
    next(n for n in nodes if n['name'] == 'Build Callback Body')['parameters']['jsCode'] = s3['BUILD']
    next(n for n in nodes if n['name'] == 'Callback to Backend')['parameters']['jsonBody'] = s3['CALLBACK']

    if 'Compare Stage 2 LLM' in connections:
        connections[llm_name] = connections.pop('Compare Stage 2 LLM')
    connections['OpenAI Chat Model'] = {
        'ai_languageModel': [[{'node': llm_name, 'type': 'ai_languageModel', 'index': 0}]]
    }
    connections[llm_name] = {'main': [[{'node': 'Build Callback Body', 'type': 'main', 'index': 0}]]}

    ensure_email_branch(nodes, connections, s3['EMAIL'])
    return nodes, connections


def patch_or_create_stage3(conn: sqlite3.Connection, payload: dict, stage2_nodes: list, stage2_connections: dict) -> str:
    s3_id = find_stage3_workflow(conn)
    webhook_path = new_webhook_path()
    nodes, connections = build_stage3_workflow(payload, webhook_path, stage2_nodes, stage2_connections)

    nodes_json = json.dumps(nodes, ensure_ascii=False)
    connections_json = json.dumps(connections, ensure_ascii=False)
    now = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]

    if s3_id:
        row = conn.execute(
            'SELECT nodes, activeVersionId FROM workflow_entity WHERE id = ?', (s3_id,)
        ).fetchone()
        for n in nodes:
            if n['name'] == 'Webhook':
                webhook_path = n['parameters'].get('path') or n.get('webhookId') or webhook_path
        conn.execute(
            'UPDATE workflow_entity SET nodes = ?, connections = ?, active = 1, name = ? WHERE id = ?',
            (
                nodes_json,
                connections_json,
                'Campaign Compare — Stage 3 (Secure Draft)',
                s3_id,
            ),
        )
        if row and row[1]:
            conn.execute(
                'UPDATE workflow_history SET nodes = ?, connections = ? WHERE versionId = ?',
                (nodes_json, connections_json, row[1]),
            )
        print('patched stage3', s3_id, 'webhook', webhook_path)
        return webhook_path

    s3_id = ''.join(__import__('random').choice('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') for _ in range(16))
    conn.execute(
        '''INSERT INTO workflow_entity
        (id, name, active, nodes, connections, settings, staticData, pinData, versionId, triggerCount, meta, createdAt, updatedAt, isArchived, versionCounter, description)
        VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 0, 1, ?)''',
        (
            s3_id,
            'Campaign Compare — Stage 3 (Secure Draft)',
            nodes_json,
            connections_json,
            '{"executionOrder":"v1","availableInMCP":false}',
            None,
            None,
            str(uuid.uuid4()),
            None,
            now,
            now,
            'Secure Campaign Compare Stage 3 (Phase 1.5). Backend-owned candidatePool, signed callback.',
        ),
    )
    print('created stage3', s3_id, 'webhook', webhook_path)
    return webhook_path


def main() -> None:
    payload = load_payload()
    conn = sqlite3.connect(DB)
    patch_stage2(conn, payload)
    row = conn.execute('SELECT nodes, connections FROM workflow_entity WHERE id = ?', (STAGE2_ID,)).fetchone()
    stage2_nodes = json.loads(row[0])
    stage2_connections = json.loads(row[1])
    webhook_path = patch_or_create_stage3(conn, payload, stage2_nodes, stage2_connections)
    conn.commit()
    conn.close()
    print('STAGE3_WEBHOOK_URL=https://n8n.evaalo.com/webhook/' + webhook_path)


if __name__ == '__main__':
    main()
