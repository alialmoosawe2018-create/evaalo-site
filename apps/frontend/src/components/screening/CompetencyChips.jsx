import React from 'react';
import { scriptTextProps } from '../../utils/textScript.js';

/**
 * The competency layout both interview stages render.
 *
 * Stage 3 scores the campaign's blueprint competencies and marks each one ✓ / ✗ / –;
 * Stage 2 scores the ten fixed competencies every employer looks for and marks each
 * with its rating word. The two differ only in what the mark SAYS, so the chip, the
 * strip in the table row and the detail list live here once — they used to be inline
 * JSX duplicated twice inside VideoInterview.jsx, which is why Stage 2 could not
 * reuse them without copying them a third time.
 *
 * Row contract (each stage builds its own rows; this component never interprets a
 * score or a rating):
 *   key        stable identity for React
 *   label      already localized
 *   tone       'met' | 'partial' | 'miss' | 'na' — drives the colour only
 *   mark       what the chip shows on the right: '✓' / '✗' / '–' or a rating word
 *   markLabel  the screen-reader text for that mark
 *   markTitle  optional hover text; '' when the mark already says it
 *   evidence   string[] — verbatim quotes, shown in the detail list
 *   redFlags   string[] — shown as ⚑ on the chip and under it in the detail list
 *   note       optional short badge under the chip (e.g. "self-reported")
 */

export function CompetencyChip({ row }) {
    // Stage 2 asks the COLOUR to carry the rating, so its assessed chips arrive with
    // an empty `mark`. The symbol span is then dropped entirely rather than rendered
    // blank, and the rating word moves onto the chip as title/aria-label: it stops
    // being printed without becoming unreachable to a screen reader or a hover.
    // Stage 3 always sets a mark (✓ / ✗ / –), so its markup is untouched.
    const hasMark = row.mark != null && row.mark !== '';
    return (
        <span
            className={`stage-eval-competency-chip stage-eval-competency-chip--${row.tone}`}
            {...(hasMark
                ? {}
                : { title: row.markTitle || row.markLabel || '', 'aria-label': `${row.label} — ${row.markLabel}` })}
        >
            <span {...scriptTextProps(row.label, 'stage-eval-competency-chip__label')}>{row.label}</span>
            {hasMark ? (
                <span
                    className="stage-eval-competency-chip__symbol"
                    aria-label={row.markLabel}
                    title={row.markTitle || ''}
                >
                    {row.mark}
                </span>
            ) : null}
            {row.redFlags?.length > 0 ? (
                <span className="stage-eval-competency-chip__flag" title={row.redFlags.join(' • ')}>⚑</span>
            ) : null}
        </span>
    );
}

/** The one-line strip shown inside the table row. */
export function CompetencyChipStrip({ rows, emptyLabel }) {
    if (!rows?.length) {
        return <span className="stage-eval-detail-card__muted">{emptyLabel}</span>;
    }
    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {rows.map((row) => (
                <CompetencyChip key={row.key} row={row} />
            ))}
        </div>
    );
}

/** The expanded panel: the same chip, with its evidence underneath. */
export function CompetencyDetailList({ rows, emptyLabel }) {
    if (!rows?.length) {
        return <span className="stage-eval-detail-card__muted">{emptyLabel}</span>;
    }
    return (
        <div className="stage-eval-competency-detail-list">
            {rows.map((row) => (
                <div key={row.key} className="stage-eval-competency-detail-item">
                    <CompetencyChip row={row} />
                    {/* ⚠️ A class must go THROUGH scriptTextProps, never beside it: the helper
                        returns its own `className`, so spreading it after a className prop
                        silently replaces it — which is exactly what the red-flag line below
                        does, deliberately left as it was. */}
                    {row.note ? (
                        <div {...scriptTextProps(row.note, 'stage-eval-competency-detail-item__note')}>
                            {row.note}
                        </div>
                    ) : null}
                    {row.evidence?.length > 0 ? (
                        <ul {...scriptTextProps(row.evidence.join(' '), 'stage-eval-detail-card__list')}>
                            {row.evidence.map((ev, i) => (
                                <li key={i} style={{ marginBottom: '4px' }} {...scriptTextProps(ev)}>{ev}</li>
                            ))}
                        </ul>
                    ) : null}
                    {/* Kept exactly as the inline version wrote it — scriptTextProps replaces
                        the className, so `__flags` never applies. The owner chose to leave
                        Stage 3's appearance untouched rather than take the red back. */}
                    {row.redFlags?.length > 0 ? (
                        <div className="stage-eval-competency-detail-item__flags" {...scriptTextProps(row.redFlags.join(' • '))}>
                            {'⚑ '}{row.redFlags.join(' • ')}
                        </div>
                    ) : null}
                </div>
            ))}
        </div>
    );
}
