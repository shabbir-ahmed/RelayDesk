export const receiverModes = ['SUCCEED', 'FAIL_TWICE', 'ALWAYS_FAIL', 'TIMEOUT'] as const
export const deliveryStatuses = ['PENDING', 'PROCESSING', 'DELIVERED', 'FAILED'] as const

export type ReceiverMode = (typeof receiverModes)[number]
export type DeliveryStatus = (typeof deliveryStatuses)[number]

export const receiverPath = '/api/demo/receiver'
