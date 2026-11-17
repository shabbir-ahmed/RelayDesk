import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import type { ReceiverMode } from '../../src/shared/delivery'

if (process.env.RELAYDESK_TEST_RUN !== '1') throw new Error('Run via npm run test:e2e.')

async function login(page: Page) {
  await page.goto('/')
  await expect(page.getByText('Read-only demo')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create event' })).toHaveCount(0)
  await page.getByRole('link', { name: 'Operator login' }).click()
  await page.getByLabel('Operator credential').fill(process.env.OPERATOR_CREDENTIAL!)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

async function submit(page: Page, mode: ReceiverMode) {
  const eventType = `synthetic.browser.${randomUUID().slice(0, 8)}`
  await page.getByRole('button', { name: 'Create event' }).click()
  await page.getByLabel('Event type').fill(eventType)
  await page.getByLabel('Receiver mode').selectOption(mode)
  await page.getByRole('button', { name: 'Submit event' }).click()
  await expect(page.getByRole('heading', { name: eventType })).toBeVisible()
}

test('T13 operator submits a flaky event and sees the third attempt succeed', async ({ page }) => {
  await login(page)
  await submit(page, 'FAIL_TWICE')
  await expect(page.getByText('The receiver returned a successful HTTP response.')).toBeVisible({ timeout: 38_000 })
  const history = page.getByRole('region', { name: 'Attempt history' })
  await expect(history.getByRole('listitem')).toHaveCount(3)
  await expect(history.getByText('HTTP 503', { exact: true })).toHaveCount(2)
  await expect(history.getByText('HTTP 200', { exact: true })).toHaveCount(1)
  await expect(history.getByRole('listitem').last()).toContainText('Succeeded')
})

test('T14 operator replays exhausted delivery and observes both cycles', async ({ page }) => {
  await login(page)
  await submit(page, 'ALWAYS_FAIL')
  const eventId = await page.getByRole('button', { name: 'Copy event ID' }).locator('..').locator('code').innerText()
  const replay = page.getByRole('button', { name: 'Replay delivery' })
  await expect(replay).toBeVisible({ timeout: 38_000 })
  await replay.click()
  await page.getByLabel('Receiver mode').selectOption('SUCCEED')
  await page.getByRole('button', { name: 'Queue replay' }).click()
  await expect(page.getByText('Replay queued as cycle 2.')).toBeVisible()
  await expect(page.getByText('The receiver returned a successful HTTP response.')).toBeVisible({ timeout: 12_000 })
  const history = page.getByRole('region', { name: 'Attempt history' })
  await expect(history.getByRole('heading', { name: 'Cycle 1 Original delivery' })).toBeVisible()
  await expect(history.getByRole('heading', { name: 'Cycle 2 Manual replay' })).toBeVisible()
  await expect(history.getByText('HTTP 503', { exact: true })).toHaveCount(3)
  await expect(history.getByText('HTTP 200', { exact: true })).toHaveCount(1)
  await expect(page.getByText(eventId, { exact: true })).toBeVisible()
})
