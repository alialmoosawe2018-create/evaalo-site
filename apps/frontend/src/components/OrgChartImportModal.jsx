import React, { useMemo, useRef, useState } from 'react';
import apiClient from '../services/apiClient';

/**
 * Import an org chart from a file (PDF/Word/Excel/CSV).
 * Flow: select → (spreadsheets) map columns → preview tree → merge/replace.
 * The parsed tree is applied via onApply(departments, mode); persistence is the
 * parent's responsibility (Chart page saves to the backend).
 */

const ACCEPT = '.pdf,.docx,.txt,.xlsx,.xls,.csv';

/** Best-effort auto-match of spreadsheet headers to the four roles. */
function guessMapping(columns) {
    const find = (patterns) =>
        columns.find((c) => patterns.some((p) => c.toLowerCase().includes(p))) || '';
    return {
        department: find(['depart', 'dept', 'قسم', 'division', 'unit']),
        name: find(['name', 'اسم', 'employee', 'موظف', 'الموظف']),
        title: find(['title', 'position', 'role', 'مسمى', 'منصب', 'وظيف']),
        manager: find(['manager', 'reports', 'يتبع', 'مدير', 'supervisor', 'رئيس']),
    };
}

function countPeople(departments) {
    let n = 0;
    const walk = (nodes) => {
        for (const node of nodes || []) {
            if (node?.name || node?.position) n += 1;
            walk(node?.subordinates);
        }
    };
    for (const d of departments || []) walk(d.positions);
    return n;
}

function TreeLines({ nodes, depth = 0 }) {
    if (!Array.isArray(nodes) || !nodes.length) return null;
    return (
        <>
            {nodes.map((node, i) => (
                <div key={node.id || i}>
                    <div style={{ paddingInlineStart: depth * 16, fontSize: 13, color: '#E2E8F0', lineHeight: 1.9 }}>
                        {depth > 0 ? '└ ' : ''}
                        <strong>{node.name || '—'}</strong>
                        {node.position ? <span style={{ color: '#94A3B8' }}> · {node.position}</span> : null}
                    </div>
                    <TreeLines nodes={node.subordinates} depth={depth + 1} />
                </div>
            ))}
        </>
    );
}

export default function OrgChartImportModal({ open, onClose, onApply, t }) {
    const fileRef = useRef(null);
    const [file, setFile] = useState(null);
    const [step, setStep] = useState('select'); // select | columns | preview
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [columns, setColumns] = useState([]);
    const [mapping, setMapping] = useState({ department: '', name: '', title: '', manager: '' });
    const [departments, setDepartments] = useState([]);

    const peopleCount = useMemo(() => countPeople(departments), [departments]);

    if (!open) return null;

    const reset = () => {
        setFile(null);
        setStep('select');
        setBusy(false);
        setError('');
        setColumns([]);
        setMapping({ department: '', name: '', title: '', manager: '' });
        setDepartments([]);
        if (fileRef.current) fileRef.current.value = '';
    };

    const close = () => {
        reset();
        onClose?.();
    };

    const upload = async (theFile, columnMapping) => {
        setBusy(true);
        setError('');
        try {
            const fd = new FormData();
            fd.append('file', theFile);
            if (columnMapping) fd.append('columnMapping', JSON.stringify(columnMapping));
            const res = await apiClient.postForm('/api/org-chart/parse', fd);
            if (!res?.ok) throw new Error(res?.message || 'parse_failed');
            if (res.mode === 'columns') {
                setColumns(res.columns || []);
                setMapping(guessMapping(res.columns || []));
                setStep('columns');
            } else {
                setDepartments(Array.isArray(res.departments) ? res.departments : []);
                setStep('preview');
            }
        } catch (err) {
            setError(err?.data?.message || err?.message || t('orgImport_error'));
        } finally {
            setBusy(false);
        }
    };

    const onFileSelected = (e) => {
        const f = e?.target?.files?.[0];
        if (!f) return;
        setFile(f);
        upload(f, null);
    };

    const onConfirmColumns = () => {
        if (!mapping.name) {
            setError(t('orgImport_nameRequired'));
            return;
        }
        upload(file, mapping);
    };

    const downloadTemplate = () => {
        const csv =
            'Department,Name,Title,Manager\n' +
            'Engineering,Ali Hassan,CTO,\n' +
            'Engineering,Sara Ahmed,Backend Engineer,Ali Hassan\n' +
            'Sales,Omar Ali,Sales Manager,\n';
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'org-chart-template.csv';
        a.click();
        URL.revokeObjectURL(url);
    };

    const apply = (mode) => {
        onApply?.(departments, mode);
        close();
    };

    const overlay = {
        position: 'fixed',
        inset: 0,
        background: 'rgba(2,6,23,0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 3000,
        padding: 16,
    };
    const panel = {
        width: 'min(560px, 100%)',
        maxHeight: '86vh',
        overflowY: 'auto',
        background: 'rgba(15,23,42,0.98)',
        border: '1px solid rgba(34,211,238,0.35)',
        borderRadius: 14,
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        padding: 22,
        color: '#E2E8F0',
    };
    const btn = (variant) => ({
        padding: '9px 16px',
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 600,
        cursor: busy ? 'not-allowed' : 'pointer',
        border: variant === 'ghost' ? '1px solid rgba(148,163,184,0.4)' : '1px solid rgba(34,211,238,0.5)',
        background: variant === 'primary' ? 'rgba(34,211,238,0.16)' : 'transparent',
        color: '#E2E8F0',
        opacity: busy ? 0.6 : 1,
    });
    const selectStyle = {
        width: '100%',
        padding: '8px 10px',
        borderRadius: 8,
        background: 'rgba(2,6,23,0.9)',
        color: '#E2E8F0',
        border: '1px solid rgba(56,189,248,0.4)',
        marginTop: 4,
    };

    return (
        <div style={overlay} onClick={close}>
            <div style={panel} onClick={(e) => e.stopPropagation()}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                    <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#fff' }}>{t('orgImport_title')}</h3>
                    <button type="button" onClick={close} style={{ ...btn('ghost'), padding: '4px 10px' }}>✕</button>
                </div>

                {error ? (
                    <div style={{ padding: '10px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)', color: '#FCA5A5', fontSize: 12, marginBottom: 12 }}>
                        {error}
                    </div>
                ) : null}

                {step === 'select' && (
                    <div>
                        <p style={{ fontSize: 13, color: '#94A3B8', lineHeight: 1.7, marginTop: 0 }}>
                            {t('orgImport_pickFile')}
                        </p>
                        <input ref={fileRef} type="file" accept={ACCEPT} onChange={onFileSelected} style={{ display: 'none' }} />
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
                            <button type="button" style={btn('primary')} disabled={busy} onClick={() => fileRef.current?.click()}>
                                {busy ? t('orgImport_parsing') : `📄 ${t('orgImport_title')}`}
                            </button>
                            <button type="button" style={btn('ghost')} disabled={busy} onClick={downloadTemplate}>
                                ⬇ {t('orgImport_template')}
                            </button>
                        </div>
                        <p style={{ fontSize: 11, color: '#64748B', marginTop: 12, lineHeight: 1.6 }}>
                            {t('orgImport_reviewNote')}
                        </p>
                    </div>
                )}

                {step === 'columns' && (
                    <div>
                        <p style={{ fontSize: 13, color: '#94A3B8', marginTop: 0 }}>{t('orgImport_mapTitle')}</p>
                        {[
                            ['name', t('orgImport_colName'), true],
                            ['department', t('orgImport_colDepartment'), false],
                            ['title', t('orgImport_colTitle'), false],
                            ['manager', t('orgImport_colManager'), false],
                        ].map(([key, label, required]) => (
                            <label key={key} style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 10 }}>
                                {label}{required ? ' *' : ''}
                                <select
                                    value={mapping[key]}
                                    onChange={(e) => setMapping((m) => ({ ...m, [key]: e.target.value }))}
                                    style={selectStyle}
                                >
                                    <option value="">{t('orgImport_colNone')}</option>
                                    {columns.map((c) => (
                                        <option key={c} value={c}>{c}</option>
                                    ))}
                                </select>
                            </label>
                        ))}
                        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                            <button type="button" style={btn('primary')} disabled={busy} onClick={onConfirmColumns}>
                                {busy ? t('orgImport_parsing') : t('orgImport_continue')}
                            </button>
                            <button type="button" style={btn('ghost')} disabled={busy} onClick={() => setStep('select')}>✕</button>
                        </div>
                    </div>
                )}

                {step === 'preview' && (
                    <div>
                        <p style={{ fontSize: 13, color: '#22D3EE', fontWeight: 600, marginTop: 0 }}>
                            {t('orgImport_previewTitle')} — {(departments || []).length} · {peopleCount}
                        </p>
                        <div style={{ maxHeight: 260, overflowY: 'auto', padding: 12, borderRadius: 8, background: 'rgba(2,6,23,0.6)', border: '1px solid rgba(56,189,248,0.2)' }}>
                            {(departments || []).map((d) => (
                                <div key={d.id} style={{ marginBottom: 12 }}>
                                    <div style={{ fontWeight: 700, color: '#67E8F9', fontSize: 13, marginBottom: 4 }}>🏢 {d.name}</div>
                                    <TreeLines nodes={d.positions} />
                                </div>
                            ))}
                            {(departments || []).length === 0 && (
                                <div style={{ fontSize: 12, color: '#94A3B8' }}>—</div>
                            )}
                        </div>
                        <p style={{ fontSize: 11, color: '#64748B', margin: '10px 0' }}>{t('orgImport_reviewNote')}</p>
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                            <button type="button" style={btn('primary')} disabled={!departments.length} onClick={() => apply('merge')}>
                                {t('orgImport_merge')}
                            </button>
                            <button type="button" style={btn('ghost')} disabled={!departments.length} onClick={() => apply('replace')}>
                                {t('orgImport_replace')}
                            </button>
                            <button type="button" style={btn('ghost')} onClick={() => setStep('select')}>✕</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
