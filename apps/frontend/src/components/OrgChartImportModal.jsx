import React, { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import apiClient from '../services/apiClient';
import './org-chart-import-modal.css';

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
                    <div
                        className="org-chart-import-modal__tree-line"
                        style={{ '--oci-tree-depth': depth }}
                    >
                        {depth > 0 ? '└ ' : ''}
                        <strong>{node.name || '—'}</strong>
                        {node.position ? (
                            <span className="org-chart-import-modal__tree-role"> · {node.position}</span>
                        ) : null}
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

    return createPortal(
        <div className="org-chart-import-modal__overlay" onClick={close} role="presentation">
            <div
                className="org-chart-import-modal__panel"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="org-chart-import-modal-title"
            >
                <div className="org-chart-import-modal__header">
                    <h3 id="org-chart-import-modal-title" className="org-chart-import-modal__title">
                        {t('orgImport_title')}
                    </h3>
                    <button type="button" className="org-chart-import-modal__close" onClick={close} aria-label="Close">
                        ✕
                    </button>
                </div>

                {error ? (
                    <div className="org-chart-import-modal__error" role="alert">
                        {error}
                    </div>
                ) : null}

                {step === 'select' && (
                    <div>
                        <p className="org-chart-import-modal__lead">{t('orgImport_pickFile')}</p>
                        <input ref={fileRef} type="file" accept={ACCEPT} onChange={onFileSelected} hidden />
                        <div className="org-chart-import-modal__actions">
                            <button
                                type="button"
                                className="org-chart-import-modal__btn org-chart-import-modal__btn--primary"
                                disabled={busy}
                                onClick={() => fileRef.current?.click()}
                            >
                                {busy ? t('orgImport_parsing') : `📄 ${t('orgImport_title')}`}
                            </button>
                            <button
                                type="button"
                                className="org-chart-import-modal__btn org-chart-import-modal__btn--ghost"
                                disabled={busy}
                                onClick={downloadTemplate}
                            >
                                ⬇ {t('orgImport_template')}
                            </button>
                        </div>
                        <p className="org-chart-import-modal__hint">{t('orgImport_reviewNote')}</p>
                    </div>
                )}

                {step === 'columns' && (
                    <div>
                        <p className="org-chart-import-modal__lead">{t('orgImport_mapTitle')}</p>
                        {[
                            ['name', t('orgImport_colName'), true],
                            ['department', t('orgImport_colDepartment'), false],
                            ['title', t('orgImport_colTitle'), false],
                            ['manager', t('orgImport_colManager'), false],
                        ].map(([key, label, required]) => (
                            <label key={key} className="org-chart-import-modal__field">
                                {label}
                                {required ? ' *' : ''}
                                <select
                                    className="org-chart-import-modal__select"
                                    value={mapping[key]}
                                    onChange={(e) => setMapping((m) => ({ ...m, [key]: e.target.value }))}
                                >
                                    <option value="">{t('orgImport_colNone')}</option>
                                    {columns.map((c) => (
                                        <option key={c} value={c}>
                                            {c}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        ))}
                        <div className="org-chart-import-modal__actions">
                            <button
                                type="button"
                                className="org-chart-import-modal__btn org-chart-import-modal__btn--primary"
                                disabled={busy}
                                onClick={onConfirmColumns}
                            >
                                {busy ? t('orgImport_parsing') : t('orgImport_continue')}
                            </button>
                            <button
                                type="button"
                                className="org-chart-import-modal__btn org-chart-import-modal__btn--ghost"
                                disabled={busy}
                                onClick={() => setStep('select')}
                            >
                                ✕
                            </button>
                        </div>
                    </div>
                )}

                {step === 'preview' && (
                    <div>
                        <p className="org-chart-import-modal__preview-badge">
                            {t('orgImport_previewTitle')} — {(departments || []).length} · {peopleCount}
                        </p>
                        <div className="org-chart-import-modal__preview-box">
                            {(departments || []).map((d) => (
                                <div key={d.id} style={{ marginBottom: 12 }}>
                                    <div className="org-chart-import-modal__dept-name">🏢 {d.name}</div>
                                    <TreeLines nodes={d.positions} />
                                </div>
                            ))}
                            {(departments || []).length === 0 && (
                                <div className="org-chart-import-modal__empty">—</div>
                            )}
                        </div>
                        <p className="org-chart-import-modal__hint">{t('orgImport_reviewNote')}</p>
                        <div className="org-chart-import-modal__actions">
                            <button
                                type="button"
                                className="org-chart-import-modal__btn org-chart-import-modal__btn--primary"
                                disabled={!departments.length}
                                onClick={() => apply('merge')}
                            >
                                {t('orgImport_merge')}
                            </button>
                            <button
                                type="button"
                                className="org-chart-import-modal__btn org-chart-import-modal__btn--ghost"
                                disabled={!departments.length}
                                onClick={() => apply('replace')}
                            >
                                {t('orgImport_replace')}
                            </button>
                            <button
                                type="button"
                                className="org-chart-import-modal__btn org-chart-import-modal__btn--ghost"
                                onClick={() => setStep('select')}
                            >
                                ✕
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>,
        document.body
    );
}
