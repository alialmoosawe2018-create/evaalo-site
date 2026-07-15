const first = $input.first().json;
const primary = String(first.text || first.output || '').trim();
const webhook = $('Webhook').first().json.body || {};
const tier = $('Resolve Search Tier').first().json || {};
const maxVariants = Number(tier.queryVariants) || 2;
const position = String(webhook.position || '').trim();
const location = String(webhook.location || '').trim();
const posLower = position.toLowerCase();
const locLower = location.toLowerCase();

const queries = [];
function add(q) {
  const s = String(q || '').trim();
  if (s && queries.indexOf(s) === -1) queries.push(s);
}

add(primary);

const iraqLoc = '("Baghdad" OR "Iraq" OR "بغداد" OR "العراق" OR "Basra" OR "Erbil" OR "Mosul")';

if (maxVariants >= 3) {
  if (posLower.includes('compensation') || posLower.includes('benefits')) {
    add(`site:linkedin.com/in/ ("Compensation" OR "Benefits" OR "Total Rewards" OR "C&B" OR "Payroll" OR "أخصائي تعويضات") AND ${iraqLoc}`);
    add(`site:linkedin.com/in/ ("Human Resources" OR "HR") ("Compensation" OR "Benefits" OR "Payroll") AND ${iraqLoc}`);
    add(`site:linkedin.com/in/ "Compensation Specialist" "Iraq"`);
  } else if (posLower.includes('hr') || posLower.includes('human resources')) {
    const words = position.split(/\s+/).filter((w) => w.length > 3).slice(0, 4);
    if (words.length) {
      add(`site:linkedin.com/in/ (${words.map((w) => `"${w}"`).join(' OR ')}) AND ${iraqLoc}`);
    }
    add(`site:linkedin.com/in/ "Human Resources" AND ${iraqLoc}`);
  } else {
    const chunks = position.split(/\s+/).filter((w) => w.length > 3).slice(0, 3);
    if (chunks.length) {
      add(`site:linkedin.com/in/ (${chunks.map((w) => `"${w}"`).join(' OR ')}) AND ${iraqLoc}`);
    }
  }

  if (locLower.includes('baghdad') || locLower.includes('iraq') || locLower.includes('بغداد') || locLower.includes('عراق')) {
    const titleHint = position.split(/\s+/).filter((w) => w.length > 3)[0] || position.split(/\s+/)[0] || '';
    if (titleHint) {
      add(`site:linkedin.com/in/ "${titleHint}" ("Baghdad" OR "Iraq")`);
    }
  }
} else if (maxVariants >= 2) {
  if (posLower.includes('compensation') || posLower.includes('benefits')) {
    add(`site:linkedin.com/in/ ("Compensation" OR "Benefits" OR "Payroll") AND ${iraqLoc}`);
  } else if (posLower.includes('hr') || posLower.includes('human resources')) {
    add(`site:linkedin.com/in/ "Human Resources" AND ${iraqLoc}`);
  } else {
    const titleHint = position.split(/\s+/).filter((w) => w.length > 3)[0] || position.split(/\s+/)[0] || '';
    if (titleHint) {
      add(`site:linkedin.com/in/ "${titleHint}" AND ${iraqLoc}`);
    }
  }
}

return queries.slice(0, maxVariants).map((q) => ({ json: { q } }));
