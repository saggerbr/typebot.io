import { TRPCError } from '@trpc/server'
import { getSession } from '@typebot.io/bot-engine/queries/getSession'
import { saveStateToDatabase } from '@typebot.io/bot-engine/saveStateToDatabase'
import { continueBotFlow } from '@typebot.io/bot-engine/continueBotFlow'
import { parseDynamicTheme } from '@typebot.io/bot-engine/parseDynamicTheme'
import { isDefined, isNotDefined } from '@typebot.io/lib/utils'
import { filterPotentiallySensitiveLogs } from '@typebot.io/bot-engine/logs/filterPotentiallySensitiveLogs'

type Props = {
  origin: string | undefined
  message?: string
  sessionId: string
}
export const continueChat = async ({ origin, sessionId, message }: Props) => {
  const session = await getSession(sessionId)

  if (!session) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Session not found.',
    })
  }

  const isSessionExpired =
    session &&
    isDefined(session.state.expiryTimeout) &&
    session.updatedAt.getTime() + session.state.expiryTimeout < Date.now()

  if (isSessionExpired)
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Session expired. You need to start a new session.',
    })

  let corsOrigin

  if (
    session?.state.allowedOrigins &&
    session.state.allowedOrigins.length > 0
  ) {
    if (origin && session.state.allowedOrigins.includes(origin))
      corsOrigin = origin
    else corsOrigin = session.state.allowedOrigins[0]
  }

  const {
    messages,
    input,
    clientSideActions,
    newSessionState,
    logs,
    lastMessageNewFormat,
    visitedEdges,
  } = await continueBotFlow(message, {
    version: 2,
    state: session.state,
    startTime: Date.now(),
  })

  if (newSessionState)
    await saveStateToDatabase({
      session: {
        id: session.id,
        state: newSessionState,
      },
      input,
      logs,
      clientSideActions,
      visitedEdges,
      hasCustomEmbedBubble: messages.some(
        (message) => message.type === 'custom-embed'
      ),
    })

  const isPreview = isNotDefined(session.state.typebotsQueue[0].resultId)

  return {
    messages,
    input,
    clientSideActions,
    dynamicTheme: parseDynamicTheme(newSessionState),
    logs: isPreview ? logs : logs?.filter(filterPotentiallySensitiveLogs),
    lastMessageNewFormat,
    corsOrigin,
  }
}
