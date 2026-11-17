import { prepareDatabase, testDb } from './database'

prepareDatabase().finally(() => testDb().$disconnect())
