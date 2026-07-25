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
                await (globalThis as unknown as { document?: { fonts?: { ready?: Promise<unknown> } } })
                    .document?.fonts?.ready;
            } catch {
                /* ignore */
            }
        });

        const contentSize = await page.evaluate(() => {
            const doc = (globalThis as unknown as { document?: {
                documentElement: { scrollWidth: number; scrollHeight: number; style: { overflow: string } };
                body: { scrollWidth: number; scrollHeight: number; style: { overflow: string; width: string } };
                getElementById(id: string): {
                    scrollWidth: number;
                    scrollHeight: number;
                    offsetWidth: number;
                    offsetHeight: number;
                } | null;
            } }).document;
            if (!doc) return { width: 794, height: 1123 };
            doc.documentElement.style.overflow = 'visible';
            doc.body.style.overflow = 'visible';
            doc.body.style.width = 'max-content';
            const root = doc.getElementById('evaalo-org-chart-export');
            const width = Math.max(
                doc.documentElement.scrollWidth,
                doc.body.scrollWidth,
                root?.scrollWidth ?? 0,
                root?.offsetWidth ?? 0,
                320
            );
            const height = Math.max(
                doc.documentElement.scrollHeight,
                doc.body.scrollHeight,
                root?.scrollHeight ?? 0,
                root?.offsetHeight ?? 0,
                240
            );
            return { width: Math.ceil(width + 64), height: Math.ceil(height + 64) };
        });

        const pdfWidth = Math.min(Math.max(contentSize.width, 320), 6000);
        const pdfHeight = Math.min(Math.max(contentSize.height, 240), 12000);

        await page.setViewport({ width: pdfWidth, height: pdfHeight, deviceScaleFactor: 1 });

        const pdfBuffer = await page.pdf({
            width: `${pdfWidth}px`,
            height: `${pdfHeight}px`,
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
