export type NewChatBootstrapPayload = {
  friendlyId: string
  sessionKey: string
}

export async function resolveNewChatBootstrapSession(options: {
  createSessionForMessage: (
    preferredFriendlyId?: string,
  ) => Promise<NewChatBootstrapPayload>
  generateThreadId: () => string
  isPortableMode: boolean
}): Promise<NewChatBootstrapPayload> {
  if (options.isPortableMode) {
    return { sessionKey: 'main', friendlyId: 'main' }
  }

  const preferredFriendlyId = options.generateThreadId()
  return options.createSessionForMessage(preferredFriendlyId)
}
