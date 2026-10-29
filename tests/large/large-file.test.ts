import { expect, it } from 'vitest'
import { runLargeFileTest } from '../../scripts/large-file-test'

it('compresses a synthetic file of about 1.2 GB', async () => {
  const status = await runLargeFileTest()
  expect(status).toBe('passed')
})
