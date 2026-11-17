import { z } from 'zod'

const httpOrigin = z.string().url().refine((value) => {
  const url = new URL(value)
  return ['http:', 'https:'].includes(url.protocol) && value === url.origin
}, 'Use an HTTP(S) origin without a path or trailing slash')

const mode = z.enum(['private', 'demo']).default('private')
export type AppMode = z.infer<typeof mode>

const secret = z.string().min(32).max(256)
const database = z.object({
  DATABASE_URL: z.string().url().regex(/^postgres(?:ql)?:\/\//),
})
const web = database.extend({ APP_ORIGIN: httpOrigin, SESSION_SECRET: secret })
const demoWeb = web.extend({
  OPERATOR_CREDENTIAL: z.string().min(12).max(256),
  API_TOKEN: secret,
  RECEIVER_SECRET: secret,
})
const demoWorker = database.extend({ RECEIVER_BASE_URL: httpOrigin, RECEIVER_SECRET: secret })
const hexKey = z.string().regex(/^[a-f0-9]{64}$/i)
const privateWeb = web.extend({ SESSION_SECRET: hexKey })
const signing = z.object({ DESTINATION_SIGNING_KEY: hexKey })

function read<T extends z.ZodType>(schema: T): z.output<T> {
  const result = schema.safeParse(process.env)
  if (!result.success) {
    throw new Error(`Invalid environment variables: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`)
  }
  return result.data
}

export const appMode = () => read(z.object({ RELAYDESK_MODE: mode })).RELAYDESK_MODE
export const databaseEnv = () => read(database)
export const signingEnv = () => read(signing)
export const webEnv = () => appMode() === 'demo' ? read(web) : read(privateWeb)
export const demoWebEnv = () => read(demoWeb)

export function workerEnv() {
  return appMode() === 'demo'
    ? { mode: 'demo' as const, ...read(demoWorker) }
    : { mode: 'private' as const, ...databaseEnv(), ...signingEnv() }
}
