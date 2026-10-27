import { expect, test } from '@playwright/test';
import { strToU8, zlibSync } from 'fflate';

test('authenticated nickname remains literal across appearances, transformation, and reload', async ({ page, context }) => {
  test.setTimeout(120_000);
  // HTML-looking text exercises display escaping without executing script.
  const nickname = '이웃<b>님</b>';
  await context.addInitScript((name) => {
    const key = 'bunfirvil:household-verification:v1';
    if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, JSON.stringify({
      schemaVersion: 1, provider: 'google-apps-script', verifiedAt: Date.now(),
      role: 'verified', authRevision: 2, scope: 'playground', nickname: name,
    }));
  }, nickname);
  await page.goto('./?map=bundang-first-village-55a-prototype&variant=A');

  const man = page.locator('.rpg-actor--100');
  const woman = page.locator('.rpg-actor--200');
  const genderToggle = page.locator('[data-hotbar-action="showcase-gender-toggle"]');
  const transformToggle = page.locator('[data-hotbar-action="showcase-pigmy-toggle"]');
  await expect(page.locator('#stage-loader')).toHaveClass(/is-hidden/, { timeout: 45_000 });
  await expect(genderToggle).toBeVisible();
  await expect(man).toBeVisible();
  await expect(man.locator('.actor-name')).toHaveText(nickname);
  await expect(man.locator('.actor-name b')).toHaveCount(0);
  await expect(man).toHaveAttribute('aria-label', `${nickname} 조작`);

  await genderToggle.click();
  await expect(woman).toBeVisible();
  await expect(woman.locator('.actor-name')).toHaveText(nickname);
  await expect(woman.locator('.actor-name b')).toHaveCount(0);

  await transformToggle.click();
  await expect(woman).toHaveAttribute('data-transformation', 'pigmy');
  await expect(woman.locator('.actor-name')).toHaveText(nickname);
  await transformToggle.click();
  await genderToggle.click();
  await expect(man).toBeVisible();
  await expect(man.locator('.actor-name')).toHaveText(nickname);

  await page.reload();
  await expect(man).toBeVisible();
  await expect(man.locator('.actor-name')).toHaveText(nickname);
  await expect(man.locator('.actor-name b')).toHaveCount(0);
});

test('shared playground keeps the owner name on the actor and in the title', async ({ page, context }) => {
  test.setTimeout(120_000);
  const json = strToU8(JSON.stringify({
    schemaVersion: 1, sharedByNickname: '공유자', mapId: 'bundang-first-village-55a-prototype',
    unitType: '55A', planVariant: 'A', livingFacing: 'south-west', selectedOptionIds: [], furniture: [],
  }));
  const compressed = zlibSync(json);
  const envelope = Buffer.alloc(4 + compressed.length);
  envelope.writeUInt32LE(json.length, 0);
  envelope.set(compressed, 4);
  const token = envelope.toString('base64url');
  await context.addInitScript(() => sessionStorage.setItem('bunfirvil:household-verification:v1', JSON.stringify({
    schemaVersion: 1, provider: 'google-apps-script', verifiedAt: Date.now(),
    role: 'verified', authRevision: 2, scope: 'share', nickname: '방문자',
  })));
  await page.goto(`./#share=v1.${token}`);
  await expect(page.locator('#stage-loader')).toHaveClass(/is-hidden/, { timeout: 45_000 });
  await expect(page.locator('#map-title')).toHaveText('공유자님의 55A타입 공유 놀이터');
  const actor = page.locator('.rpg-actor--100');
  await expect(actor.locator('.actor-name')).toHaveText('공유자');
  await expect(actor).toHaveAttribute('aria-label', '공유자 조작');

  await page.reload();
  await expect(page.locator('#stage-loader')).toHaveClass(/is-hidden/, { timeout: 45_000 });
  await expect(actor.locator('.actor-name')).toHaveText('공유자');
});
