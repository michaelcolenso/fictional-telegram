import { chromium, webkit } from 'playwright';

const base = process.env.PAYDIRT_URL;
const token = process.env.PAYDIRT_ADMIN_TOKEN;
const prefix = process.env.TEST_PREFIX;
if (!base || !token || !prefix) throw new Error('Missing PAYDIRT_URL, PAYDIRT_ADMIN_TOKEN, or TEST_PREFIX');

const names = {
  flow: `${prefix} Lifecycle`,
  research: `${prefix} Research`,
  spec: `${prefix} Spec`,
  promote: `${prefix} Promote Lead`,
  dismiss: `${prefix} Dismiss Lead`,
};

const results = [];
const ok = (name, detail='') => { results.push({name, status:'PASS', detail}); console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`); };
const fail = (name, err) => { results.push({name, status:'FAIL', detail:String(err?.message || err)}); console.error(`FAIL ${name} — ${err?.message || err}`); };

async function api(path, options={}) {
  const r = await fetch(`${base}${path}`, { headers: { accept:'application/json', ...(options.headers||{}) }, ...options });
  const data = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error(`${path} ${r.status}: ${data.error || JSON.stringify(data)}`);
  return data;
}

async function testReads() {
  for (const path of ['/api/health','/api/dashboard','/api/leads','/api/opportunities','/api/sources','/api/runs','/api/portfolio']) {
    try { const d = await api(path); ok(`GET ${path}`, JSON.stringify(d).slice(0,120)); } catch (e) { fail(`GET ${path}`, e); }
  }
}

async function withBrowser(browserType, label, viewport) {
  const browser = await browserType.launch();
  const context = await browser.newContext({ viewport });
  await context.addInitScript(t => sessionStorage.setItem('paydirt-admin-token', t), token);
  const page = await context.newPage();
  page.on('console', msg => console.log(`[${label} console] ${msg.type()}: ${msg.text()}`));
  page.on('pageerror', err => console.error(`[${label} pageerror] ${err.message}`));
  page.on('dialog', async d => { console.log(`[${label} dialog] ${d.type()}: ${d.message()}`); await d.accept('UI smoke test'); });
  try {
    await page.goto(base, { waitUntil:'networkidle', timeout:30000 });
    await page.locator('#system-status').waitFor({ timeout:10000 });
    ok(`${label}: initial load`);

    for (const route of ['command','inbox','pipeline','portfolio']) {
      await page.locator(`[data-route="${route}"]`).click();
      await page.locator(`[data-view="${route}"]`).waitFor({ state:'visible' });
      ok(`${label}: navigate ${route}`);
    }

    await page.locator('[data-route="inbox"]').click();
    const search = page.locator('#lead-search');
    await search.fill(prefix);
    const cards = page.locator('#lead-list .lead-card');
    if (await cards.count() < 2) throw new Error(`Expected seeded leads for ${prefix}`);
    ok(`${label}: inbox search/filter`);
    await search.fill('');

    await page.locator('[data-route="pipeline"]').click();
    const oppSearch = page.locator('#opp-search');
    await oppSearch.fill(prefix);
    if (await page.locator('#opportunity-list [data-open]').count() < 3) throw new Error('Seeded opportunities not visible');
    ok(`${label}: pipeline search`);
    await oppSearch.fill('');

    // Lifecycle: APPROVE → READY_TO_BUILD → START_BUILD → LAUNCH
    await page.getByText(names.flow, { exact:true }).first().click();
    await page.locator('#workspace-content').waitFor({ state:'visible' });
    for (const [action, expected] of [['APPROVE','APPROVED'],['READY_TO_BUILD','READY_TO_BUILD'],['START_BUILD','BUILDING'],['LAUNCH','LAUNCHED']]) {
      const responsePromise = page.waitForResponse(r => r.url().includes('/decision') && r.request().method()==='POST');
      await page.locator(`[data-opp-action="${action}"]`).click();
      const resp = await responsePromise;
      if (!resp.ok()) throw new Error(`${action} returned ${resp.status()}`);
      await page.waitForFunction(state => document.querySelector('#workspace-content .eyebrow')?.textContent?.includes(state), expected);
      ok(`${label}: ${action}`);
    }

    // Research → backlog → reject
    await page.locator('[data-route="pipeline"]').click();
    await page.getByText(names.research, { exact:true }).first().click();
    for (const [action, expected] of [['RESEARCH','RESEARCHING'],['BACKLOG','BACKLOG'],['REJECT','REJECTED']]) {
      const responsePromise = page.waitForResponse(r => r.url().includes('/decision') && r.request().method()==='POST');
      await page.locator(`[data-opp-action="${action}"]`).click();
      const resp = await responsePromise;
      if (!resp.ok()) throw new Error(`${action} returned ${resp.status()}`);
      await page.waitForFunction(state => document.querySelector('#workspace-content .eyebrow')?.textContent?.includes(state), expected);
      ok(`${label}: ${action}`);
    }

    // Rescore and build spec on dedicated seeded opportunity.
    await page.locator('[data-route="pipeline"]').click();
    await page.getByText(names.spec, { exact:true }).first().click();
    let responsePromise = page.waitForResponse(r => r.url().includes('/rescore') && r.request().method()==='POST');
    await page.locator('[data-special-action="rescore"]').click();
    let resp = await responsePromise;
    if (!resp.ok()) throw new Error(`rescore returned ${resp.status()}`);
    ok(`${label}: rescore mutation`);

    responsePromise = page.waitForResponse(r => r.url().includes('/build-spec') && r.request().method()==='POST');
    const downloadPromise = page.waitForEvent('download').catch(()=>null);
    await page.locator('[data-special-action="build-spec"]').click();
    resp = await responsePromise;
    if (!resp.ok()) throw new Error(`build-spec returned ${resp.status()}`);
    const body = await resp.json();
    if (!body.content || !body.filename) throw new Error('build-spec response missing content/filename');
    await downloadPromise;
    ok(`${label}: build spec generation/download`);

    // Revalidate evidence: verify queue request returns 202, don't wait for workflow completion.
    const revalidate = page.locator('.revalidate-button');
    await revalidate.waitFor({ state:'visible', timeout:5000 });
    responsePromise = page.waitForResponse(r => r.url().includes('/validate') && r.request().method()==='POST');
    await revalidate.click();
    resp = await responsePromise;
    if (resp.status() !== 202) throw new Error(`validate returned ${resp.status()}`);
    ok(`${label}: revalidate queue`);

    // Lead dismiss.
    await page.locator('[data-route="inbox"]').click();
    let card = page.locator('.lead-card').filter({ hasText:names.dismiss });
    responsePromise = page.waitForResponse(r => r.url().includes('/dismiss') && r.request().method()==='POST');
    await card.locator('[data-lead-action="dismiss"]').click();
    resp = await responsePromise;
    if (!resp.ok()) throw new Error(`dismiss returned ${resp.status()}`);
    ok(`${label}: dismiss lead`);

    // Lead promote; promotion also queues validation.
    card = page.locator('.lead-card').filter({ hasText:names.promote });
    responsePromise = page.waitForResponse(r => r.url().includes('/promote') && r.request().method()==='POST');
    await card.locator('[data-lead-action="promote"]').click();
    resp = await responsePromise;
    if (resp.status() !== 201) throw new Error(`promote returned ${resp.status()}`);
    const promoted = await resp.json();
    if (!promoted.opportunity_id) throw new Error('promote did not return opportunity_id');
    ok(`${label}: promote lead + validation queue`, promoted.validation_run_id || promoted.validation_error || 'promotion ok');

    // Discovery button. This intentionally creates one real discovery run.
    await page.locator('[data-route="command"]').click();
    const runButton = page.locator('#run-discovery');
    await runButton.waitFor({ state:'visible', timeout:5000 });
    responsePromise = page.waitForResponse(r => r.url().includes('/api/workflows/discovery') && r.request().method()==='POST');
    await runButton.click();
    resp = await responsePromise;
    if (resp.status() !== 202) throw new Error(`discovery returned ${resp.status()}`);
    ok(`${label}: discovery queue`);

    // Portfolio should show the product created by APPROVE.
    await page.locator('[data-route="portfolio"]').click();
    if (await page.getByText(names.flow, { exact:true }).count() < 1) throw new Error('Approved product not visible in portfolio');
    ok(`${label}: portfolio reflects approval`);
  } finally {
    await browser.close();
  }
}

await testReads();
// Full mutation pass once in WebKit/mobile, then a read/navigation pass in Chromium desktop.
try { await withBrowser(webkit, 'WebKit mobile', {width:390,height:844}); } catch (e) { fail('WebKit mobile full UI pass', e); }

try {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport:{width:1440,height:1000} });
  await page.goto(base, {waitUntil:'networkidle',timeout:30000});
  for (const route of ['command','inbox','pipeline','portfolio']) {
    await page.locator(`[data-route="${route}"]`).click();
    await page.locator(`[data-view="${route}"]`).waitFor({state:'visible'});
  }
  ok('Chromium desktop navigation/render');
  await browser.close();
} catch (e) { fail('Chromium desktop navigation/render', e); }

console.log('\nRESULTS_JSON=' + JSON.stringify(results));
if (results.some(r => r.status === 'FAIL')) process.exit(1);
