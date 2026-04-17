import { chromium } from '@playwright/test';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

async function runTest() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  console.log('[*] Navigating to http://localhost:5173...');
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  console.log('[+] Home page loaded');
  
  // Find textarea and fill it
  await page.waitForSelector('textarea', { timeout: 5000 });
  
  const prompt = 'Retail demo: regional grocery chain investigating margin erosion in produce aisle';
  console.log(`[*] Typing prompt...`);
  await page.focus('textarea');
  await page.keyboard.type(prompt, { delay: 10 });
  
  // Wait for idea cards to appear (max 20s)
  console.log('[*] Waiting for idea cards...');
  await page.waitForTimeout(8000);
  
  // Find first "Use this story" button
  const buttonSelectors = await page.locator('button').all();
  let foundButton = null;
  
  for (const btn of buttonSelectors) {
    const text = await btn.textContent();
    if (text && text.includes('Use this story')) {
      foundButton = btn;
      console.log(`[+] Found "Use this story" button`);
      break;
    }
  }
  
  if (!foundButton) {
    console.error('[-] Could not find "Use this story" button');
    await browser.close();
    process.exit(1);
  }
  
  // Record t=0
  const t0 = Date.now() / 1000;
  const t0Date = new Date(t0 * 1000);
  console.log(`\n[T=0] ${t0Date.toISOString()} (unix: ${t0})`);
  
  // Click button
  console.log('[*] Clicking "Use this story"...');
  await foundButton.click();
  
  // Wait a moment for navigation
  await page.waitForTimeout(2000);
  
  // Get project ID from URL
  const url = page.url();
  const projectMatch = url.match(/\/project\/([a-f0-9\-]+)/);
  const projectId = projectMatch ? projectMatch[1] : 'UNKNOWN';
  console.log(`[+] Project ID: ${projectId}`);
  
  const projectDir = `/Users/cal.reynolds/Downloads/skunkworks/industry-demo-prompts/app/projects/${projectId}`;
  
  console.log(`\n[*] Monitoring ${projectDir}...`);
  
  let resourcesTime = null;
  let readmeTime = null;
  let archTime = null;
  
  const timeout = 120;
  const startTime = Date.now() / 1000;
  
  while (Date.now() / 1000 - startTime < timeout) {
    if (!resourcesTime && fs.existsSync(path.join(projectDir, 'resources.json'))) {
      const stat = fs.statSync(path.join(projectDir, 'resources.json'));
      resourcesTime = stat.mtimeMs / 1000;
      const delta = resourcesTime - t0;
      const dt = new Date(resourcesTime * 1000);
      console.log(`[FILE] resources.json: ${dt.toISOString()} (+${delta.toFixed(2)}s)`);
    }
    
    if (!readmeTime && fs.existsSync(path.join(projectDir, 'README.md'))) {
      const stat = fs.statSync(path.join(projectDir, 'README.md'));
      readmeTime = stat.mtimeMs / 1000;
      const delta = readmeTime - t0;
      const dt = new Date(readmeTime * 1000);
      console.log(`[FILE] README.md: ${dt.toISOString()} (+${delta.toFixed(2)}s)`);
    }
    
    if (!archTime && fs.existsSync(path.join(projectDir, 'architecture.md'))) {
      const stat = fs.statSync(path.join(projectDir, 'architecture.md'));
      archTime = stat.mtimeMs / 1000;
      const delta = archTime - t0;
      const dt = new Date(archTime * 1000);
      console.log(`[FILE] architecture.md: ${dt.toISOString()} (+${delta.toFixed(2)}s)`);
    }
    
    if (resourcesTime && readmeTime && archTime) {
      console.log('\n[+] All three files found!');
      break;
    }
    
    await page.waitForTimeout(200);
  }
  
  // Calculate and report
  if (resourcesTime && readmeTime && archTime) {
    const deltaR = resourcesTime - t0;
    const deltaReadme = readmeTime - t0;
    const deltaArch = archTime - t0;
    
    console.log('\n=== RESULTS ===');
    console.log(`Project ID: ${projectId}`);
    console.log(`t=0: ${t0Date.toISOString()}`);
    console.log(`resources.json: +${deltaR.toFixed(2)}s`);
    console.log(`README.md: +${deltaReadme.toFixed(2)}s`);
    console.log(`architecture.md: +${deltaArch.toFixed(2)}s`);
    
    const times = [deltaR, deltaReadme, deltaArch];
    const min = Math.min(...times);
    const max = Math.max(...times);
    const spread = max - min;
    
    console.log(`\nSpread: ${spread.toFixed(2)}s`);
    if (spread < 5) {
      console.log('[OBSERVATION] Files clustered < 5s (LIKELY PARALLEL)');
    } else {
      console.log('[OBSERVATION] Files spread >= 5s (LIKELY SERIAL)');
    }
  }
  
  // Screenshot
  await page.screenshot({ path: '/tmp/project_page.png' });
  console.log('[+] Screenshot: /tmp/project_page.png');
  
  // Directory listing
  console.log(`\n[DIR] ${projectDir}/`);
  try {
    const output = execSync(`ls -la "${projectDir}"`).toString();
    console.log(output);
  } catch (e) {
    console.log('Directory listing failed:', e.message);
  }
  
  await browser.close();
  console.log('\n[+] Test complete');
}

runTest().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
