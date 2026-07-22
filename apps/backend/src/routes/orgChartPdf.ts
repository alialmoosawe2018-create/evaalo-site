/**
 * PDF للمخطط التنظيمي عبر Chromium (Puppeteer) — عربي + RTL كما في المتصفح.
 * يعالج POST { html, filename? } ويرجع application/pdf
 */
import { Router, type Request, type Response } from 'express';

const router = Router();

const MAX_HTML_BYTES = 4 * 1024 * 1024;

function stripScripts(html: string): string {
    return html.replace(/<script\b[\s\S]*?<\/script>/gi, '');
}

router.post('/pdf', async (req: Request, res: Response) => {
    if (process.env.DISABLE_ORG_CHART_PUPPETEER_PDF === 'true') {
        return res.status(503).json({ success: false, error: 'Org chart server PDF is disabled' });
    }

    const html = typeof req.body?.html === 'string' ? req.body.html : '';
    const rawName = typeof req.body?.filename === 'string' ? req.body.filename : 'org-chart';
    const filename = rawName.replace(/[/\\?%*:|"<>]/g, '-').slice(0, 120) || 'org-chart';

    if (!html || html.length < 20) {
        return res.status(400).json({ success: false, error: 'Field "html" (full document) is required' });
    }
    if (html.length > MAX_HTML_BYTES) {
        return res.status(413).json({ success: false, error: 'HTML body too large' });
    }

    const safeHtml = stripScripts(html);

    let browser: import('puppeteer').Browser | undefined;
    try {
        const puppeteerMod = await import('puppeteer');
        const exe = process.env.PUPPETEER_EXECUTABLE_PATH;
        browser = await puppeteerMod.default.launch({
            headless: true,
            ...(exe ? { executablePath: exe } : {}),
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=medium'],
        });
        const page = await browser.newPage();
        await page.setContent(safeHtml, {
            waitUntil: 'load',
            timeout: Math.min(Number(process.env.ORG_CHART_PDF_TIMEOUT_MS) || 45000, 120000),
        });
        // Fonts are optional — don't block PDF on Google Fonts network.
        await page.evaluate(async () => {
            try {
                // `document` is a browser global inside page.evaluate; the backend
                // tsconfig lib is ES2022 (no DOM), so reach it via globalThis to
                // keep the build tsc-safe without changing runtime behavior.
                await (globalThis as unknown as { document?: { fonts?: { ready?: Promise<unknown> } } })
                    .document?.fonts?.ready;
            } catch {
                /* ignore */
            }
        });

        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            preferCSSPageSize: false,
            margin: { top: '12mm', right: '10mm', bottom: '12mm', left: '10mm' },
        });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
        res.send(Buffer.from(pdfBuffer));
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('Org chart Puppeteer PDF error:', msg);
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: msg || 'PDF generation failed' });
        }
    } finally {
        if (browser) {
            await browser.close().catch(() => {});
        }
    }
});

export default router;
