export const receiverModes = ['SUCCEED', 'FAIL_TWICE', 'ALWAYS_FAIL', 'TIMEOUT'] as const
export const deliveryStatuses = ['PENDING', 'PROCESSING', 'DELIVERED', 'FAILED'] as const

export type ReceiverMode = (typeof receiverModes)[number]
export type DeliveryStatus = (typeof deliveryStatuses)[number]

export const receiverPath = '/api/demo/receiver'

export type DestinationOption = { id: string; name: string; destinationUrl: string | null }

export const environments = ['TEST', 'LIVE'] as const
export type Environment = (typeof environments)[number]
export const environmentHeader = 'X-RelayDesk-Environment'
export const environmentLabel = { TEST: 'Test', LIVE: 'Live' } satisfies Record<Environment, string>
