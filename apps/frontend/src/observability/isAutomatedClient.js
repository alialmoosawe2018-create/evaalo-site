/**
 * True when this browser is a tool, not a person.
 *
 * Production filed twenty error rows and a slice of the latency baseline from an
 * assistant's browser during a debugging session — indistinguishable, in the data,
 * from a customer hitting the same failures. Traffic that exists to test the site
 * must not be counted as traffic using it, or every working session quietly
 * poisons the numbers the next investigation depends on.
 *
 * `navigator.webdriver` is the standard signal and is checked first, but it is not
 * sufficient: it reads false in the Claude browser pane (verified, not assumed),
 * which is exactly the client that produced those rows. So the user-agent markers
 * are the substantive test and webdriver is the bonus.
 *
 * Deliberately conservative. A false positive silences a real user's report, which
 * is worse than a few extra rows, so the list stays to unambiguous automation
 * markers — no heuristics on viewport, timing, or navigation shape.
 */

const AUTOMATION_UA = /\b(Claude|HeadlessChrome|Playwright|Puppeteer|Selenium|PhantomJS|Lighthouse|Chrome-Lighthouse)\b|bot\b|crawler|spider/i;

let cached = null;

export function isAutomatedClient() {
    if (cached !== null) return cached;
    try {
        if (typeof navigator === 'undefined') {
            cached = false;
            return cached;
        }
        cached = navigator.webdriver === true || AUTOMATION_UA.test(navigator.userAgent || '');
    } catch {
        cached = false;
    }
    return cached;
}

export default isAutomatedClient;
