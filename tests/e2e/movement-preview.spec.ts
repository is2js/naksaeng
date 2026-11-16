import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

test('diagonal release keeps the completed facing and can capture a playground reference image', async ({ page, context }) => {
  test.setTimeout(120_000);
  await context.addInitScript(() => {
    sessionStorage.setItem('bunfirvil:household-verification:v1', JSON.stringify({
      schemaVersion: 1, provider: 'google-apps-script', verifiedAt: Date.now(),
      role: 'verified', memberCodeRevision: 1, authRevision: 2, scope: 'playground', nickname: '미리보기',
    }));
    localStorage.setItem('bunfirvil:review:v1:bundang-first-village-55a-prototype', JSON.stringify({
      schemaVersion: 1, selectedOptionIds: ['living-design-wall-panel', 'wide-plank-floor-finish'],
    }));
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('./?map=bundang-first-village-55a-prototype&variant=A');
  await expect(page.locator('#stage-loader')).toHaveClass(/is-hidden/, { timeout: 30_000 });
  const actor = page.locator('.rpg-actor--100');
  const stage = page.locator('#game-stage');
  for (const [vertical, horizontal, direction] of [
    ['ArrowUp', 'ArrowRight', 'ne'], ['ArrowUp', 'ArrowLeft', 'nw'],
    ['ArrowDown', 'ArrowRight', 'se'], ['ArrowDown', 'ArrowLeft', 'sw'],
  ]) {
    await page.getByRole('button', { name: '캐릭터 위치 초기화' }).click();
    await stage.focus();
    // Emit the chord/release inside the page: software WebGL can turn a 25ms
    // gap between separate browser-driver commands into a full second.
    await page.evaluate(({ vertical, horizontal, direction }) => new Promise<void>((resolve) => {
      const target = document.querySelector<HTMLElement>('#game-stage')!;
      const actor = document.querySelector<HTMLElement>('.rpg-actor--100')!;
      const send = (type: string, key: string): void => { target.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true })); };
      const observer = new MutationObserver(() => {
        if (actor.dataset.motion !== 'walk' || actor.dataset.direction !== direction) return;
        observer.disconnect();
        send('keyup', vertical);
        window.setTimeout(() => { send('keyup', horizontal); resolve(); }, 25);
      });
      observer.observe(actor, { attributes: true, attributeFilter: ['data-direction', 'data-motion'] });
      send('keydown', vertical);
      send('keydown', horizontal);
    }), { vertical, horizontal, direction });
    await expect(actor).toHaveAttribute('data-travel-state', 'settled');
    await expect(actor).toHaveAttribute('data-motion', 'idle');
    await expect(actor).toHaveAttribute('data-direction', direction);
  }
  if (process.env.CAPTURE_PLAYGROUND_PREVIEW === '1') {
    await page.getByRole('button', { name: '캐릭터 위치 초기화' }).click();
    // Capture a reference for the illustrated cover, not its final public OG image.
    await page.addStyleTag({ content: '.showcase-layout { grid-template-columns:1200px 348px!important; max-width:none!important; } #game-stage { width:1200px!important; height:630px!important; min-height:630px!important; }' });
    await expect(stage).toHaveCSS('width', '1200px');
    await expect(stage).toHaveCSS('height', '630px');
    await page.waitForTimeout(1_000); // Camera/texture settling for the screenshot, not a test assertion.
    await stage.screenshot({ path: resolve('public/og-playground-v2.jpg'), type: 'jpeg', quality: 88 });
  }
});
