import { z } from 'zod'

const httpOrigin = z.string().url().refine((value) => {
  const url = new URL(value)
  return ['http:', 'https:'].includes(url.protocol) && value === url.origin
}, 'Use an HTTP(S) origin without a path or trailing slash')

const secret = z.string().min(32).max(256)
const database = z.object({
  DATABASE_URL: z.string().url().regex(/^postgres(?:ql)?:\/\//),
})
const worker = database.extend({
  RECEIVER_BASE_URL: httpOrigin,
  RECEIVER_SECRET: secret,
})
const web = database.extend({
  APP_ORIGIN: httpOrigin,
  OPERATOR_CREDENTIAL: z.string().min(12).max(256),
  SESSION_SECRET: secret,
  API_TOKEN: secret,
  RECEIVER_SECRET: secret,
})

function read<T extends z.ZodType>(schema: T): z.output<T> {
  const result = schema.safeParse(process.env)
  if (!result.success) {
    throw new Error(`Invalid environment variables: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`)
  }
  return result.data
}

export const databaseEnv = () => read(database)
export const workerEnv = () => read(worker)
export const webEnv = () => read(web)
