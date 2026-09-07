/**
 * What a certificate actually IS, taken from the certificate itself.
 *
 * Uploads are named after the applicant, not the qualification — a real
 * application in production carries six files called "Ali Mahmood Najm
 * Abudalha  3.pdf" … " 7.pdf". The profile could only ever show that, so a
 * reviewer sees six identical rows and has to open each one.
 *
 * The text is already extracted for the Stage 1 evaluator; this derives a label
 * from it so nothing is read twice and the submit path gains no latency.
 *
 * DELIBERATELY HIGH-PRECISION, LOW-RECALL. A certificate's first line is as
 * often the holder's name or an ornamental heading as it is the qualification,
 * so a guess would relabel files with confident nonsense — worse than the
 * filename, because the filename is visibly useless while a wrong title looks
 * authoritative. A title is returned only when the text names a qualification
 * we recognise, or a line says outright that it is a certificate in something.
 * Everything else returns '' and the caller keeps its filename fallback.
 */

/** Well-known qualifications, matched whole-word so "PMP" ≠ "PMPX". */
const KNOWN_CERTIFICATIONS: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /\bSHRM[\s-]?SCP\b/i, label: 'SHRM-SCP' },
    { pattern: /\bSHRM[\s-]?CP\b/i, label: 'SHRM-CP' },
    { pattern: /\bSPHR\b/i, label: 'SPHR' },
    { pattern: /\bPHR\b/i, label: 'PHR' },
    { pattern: /\baPHRi?\b/i, label: 'aPHR' },
    { pattern: /\bCIPD\b/i, label: 'CIPD' },
    { pattern: /\bPMP\b/i, label: 'PMP' },
    { pattern: /\bCAPM\b/i, label: 'CAPM' },
    { pattern: /\bPRINCE ?2\b/i, label: 'PRINCE2' },
    { pattern: /\bITIL\b/i, label: 'ITIL' },
    { pattern: /\bSix Sigma\b/i, label: 'Six Sigma' },
    { pattern: /\bACCA\b/i, label: 'ACCA' },
    { pattern: /\bCPA\b/i, label: 'CPA' },
    { pattern: /\bCMA\b/i, label: 'CMA' },
    { pattern: /\bCFA\b/i, label: 'CFA' },
    { pattern: /\bCIPS\b/i, label: 'CIPS' },
    { pattern: /\bNEBOSH\b/i, label: 'NEBOSH' },
    { pattern: /\bIOSH\b/i, label: 'IOSH' },
    { pattern: /\bOSHA\b/i, label: 'OSHA' },
    { pattern: /\bCCNA\b/i, label: 'CCNA' },
    { pattern: /\bIELTS\b/i, label: 'IELTS' },
    { pattern: /\bTOEFL\b/i, label: 'TOEFL' },
    { pattern: /\bISO ?9001\b/i, label: 'ISO 9001' },
    { pattern: /\bISO ?45001\b/i, label: 'ISO 45001' },
];

/** A line that says outright it is a certificate/diploma in something. */
const DECLARES_CERTIFICATE =
    /(certificate|certification|diploma|accredited|شهادة|دبلوم)/i;

/** Ornamental or generic lines that name no qualification. */
const TOO_GENERIC =
    /^(certificate|certificate of completion|certificate of achievement|certificate of attendance|this is to certify that|شهادة|شهادة تقدير)$/i;

const MAX_TITLE_CHARS = 60;
/** Only the top of the document — a qualification is never named on page four. */
const HEAD_CHARS = 1200;

function tidy(line: string): string {
    const s = line.replace(/\s+/g, ' ').trim().replace(/[.,;:_\-–—]+$/, '').trim();
    return s.length > MAX_TITLE_CHARS ? `${s.slice(0, MAX_TITLE_CHARS - 1).trim()}…` : s;
}

/**
 * @param text extracted certificate text ('' for an image or an unreadable file)
 * @returns a short label, or '' when the text names nothing we can vouch for
 */
export function deriveCertificateTitle(text: unknown): string {
    const full = typeof text === 'string' ? text : '';
    if (!full.trim()) return '';
    const head = full.slice(0, HEAD_CHARS);

    for (const { pattern, label } of KNOWN_CERTIFICATIONS) {
        if (pattern.test(head)) return label;
    }

    for (const raw of head.split(/\r?\n/)) {
        const line = tidy(raw);
        if (line.length < 8 || TOO_GENERIC.test(line)) continue;
        if (!DECLARES_CERTIFICATE.test(line)) continue;
        // A line that is only the declaration plus a name ("... certify that Ali
        // Mahmood") names the holder, not the qualification.
        if (/^this is to certify that\b/i.test(line)) continue;
        return line;
    }

    return '';
}
