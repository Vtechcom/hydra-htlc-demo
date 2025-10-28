import { readFileSync } from 'fs'

export default defineEventHandler(async event => {
	try {
		const startTime = readFileSync('../../../infra/startup_time.txt', 'utf-8').trim()
		return startTime
	} catch (error) {
		console.error('Error in startup-time.get handler:', error)
		return { error: 'Failed to retrieve startup time' }
	}
})
