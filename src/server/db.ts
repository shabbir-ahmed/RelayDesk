import { PrismaClient } from '@prisma/client'
import { databaseEnv } from './env'

const scope = globalThis as typeof globalThis & { relaydeskDb?: PrismaClient }

export function db() {
  if (!scope.relaydeskDb) {
    const url = new URL(databaseEnv().DATABASE_URL)
    if (!url.searchParams.has('connection_limit')) url.searchParams.set('connection_limit', '4')
    scope.relaydeskDb = new PrismaClient({ datasourceUrl: url.toString() })
  }
  return scope.relaydeskDb
}
