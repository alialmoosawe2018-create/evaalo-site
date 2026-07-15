/**
 * Heuristic check: PDF contains extractable text (not image-only / scanned photo PDF).
 * n8n Extract-from-File cannot process pure image PDFs reliably.
 */
export async function pdfAppearsTextBased(file) {
    const maxRead = Math.min(file.size, 2 * 1024 * 1024);
    const buf = await file.slice(0, maxRead).arrayBuffer();
    const latin = new TextDecoder('latin1').decode(buf);

    if (!latin.startsWith('%PDF')) {
        return false;
    }

    const textOps = (latin.match(/\)\s*Tj|\)\s*TJ/g) || []).length;
    const textStrings = (latin.match(/\([^\r\n()]{4,}\)/g) || []).length;
    const imageMarkers = (latin.match(/\/Subtype\s*\/Image|\/DCTDecode|\/JPXDecode/g) || []).length;
    const fontMarkers = (latin.match(/\/Type\s*\/Font|\/BaseFont/g) || []).length;

    const textScore = textOps + Math.min(textStrings, 24);

    if (textScore >= 2) return true;
    if (fontMarkers >= 1 && textScore >= 1) return true;

    if (imageMarkers >= 1 && textScore === 0) return false;
    if (imageMarkers >= 2 && textScore < 2) return false;

    return textScore >= 1;
}
