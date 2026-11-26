import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'

type Message = {
  id: number
  role: 'user' | 'assistant'
  text: string
}

type StreamChunk =
  | { done: true }
  | { done: false; text: string }

const SESSION_STORAGE_KEY = 'document-assistant-conversation-session'
const SUGGESTION = 'Explain the features of C# language in 15 bullet points?'

function extractText(value: unknown): string | null {
  if (typeof value === 'string') {
    return value
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const text = extractText(item)
      if (text !== null) {
        return text
      }
    }

    return null
  }

  if (typeof value !== 'object' || value === null) {
    return null
  }

  for (const key of [
    'answer',
    'response',
    'result',
    'text',
    'content',
    'chunk',
    'delta',
    'token',
    'message',
    'choices',
  ]) {
    if (key in value) {
      const text = extractText(Reflect.get(value, key))
      if (text !== null) {
        return text
      }
    }
  }

  return null
}

function parseStreamChunk(data: string): StreamChunk {
  if (data.trim() === '[DONE]') {
    return { done: true }
  }

  let value: unknown
  try {
    value = JSON.parse(data)
  } catch {
    return { done: false, text: data }
  }

  if (typeof value === 'object' && value !== null && 'error' in value) {
    const message = extractText(Reflect.get(value, 'error'))
    throw new Error(message || 'The streaming API returned an error.')
  }

  const text = extractText(value)
  if (text === null) {
    throw new Error('The streaming API returned an unsupported event.')
  }

  return { done: false, text }
}

function getSessionId(): string {
  const existingId = window.sessionStorage.getItem(SESSION_STORAGE_KEY)
  if (existingId) {
    return existingId
  }

  return createSessionId()
}

function createSessionId(): string {
  const sessionId = window.crypto.randomUUID()
  window.sessionStorage.setItem(SESSION_STORAGE_KEY, sessionId)
  return sessionId
}

function StreamingChat() {
  const [sessionId, setSessionId] = useState(getSessionId)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nextMessageId = useRef(0)
  const activeRequest = useRef<AbortController | null>(null)
  const streamingMessage = useRef<{ id: number; text: string } | null>(null)
  const chatFeedRef = useRef<HTMLDivElement>(null)

  useEffect(
    () => () => {
      const controller = activeRequest.current
      activeRequest.current = null
      controller?.abort()
    },
    [],
  )

  useEffect(() => {
    if (messages.length > 0 && chatFeedRef.current) {
      chatFeedRef.current.scrollTop = chatFeedRef.current.scrollHeight
    }
  }, [messages, isSending, error])

  function stopGeneration() {
    const controller = activeRequest.current
    if (!controller) {
      return
    }

    activeRequest.current = null
    controller.abort()

    const assistantMessage = streamingMessage.current
    if (assistantMessage?.text === '') {
      setMessages((current) =>
        current.filter((message) => message.id !== assistantMessage.id),
      )
    }
    streamingMessage.current = null
    setIsSending(false)
  }

  async function clearSession() {
    if (isClearing) {
      return
    }

    const controller = activeRequest.current
    const partialMessage = streamingMessage.current
    activeRequest.current = null
    controller?.abort()
    streamingMessage.current = null
    if (partialMessage?.text === '') {
      setMessages((current) =>
        current.filter((message) => message.id !== partialMessage.id),
      )
    }
    setIsSending(false)
    setIsClearing(true)
    setError(null)

    try {
      const response = await fetch(
        `/api/Conversation/${encodeURIComponent(sessionId)}`,
        { method: 'DELETE' },
      )

      if (!response.ok) {
        throw new Error(`Could not clear the session (HTTP ${response.status}).`)
      }

      const newSessionId = window.crypto.randomUUID()
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, newSessionId)
      setSessionId(newSessionId)
      setMessages([])
      setDraft('')
      nextMessageId.current = 0
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Could not clear the session.',
      )
    } finally {
      setIsClearing(false)
    }
  }

  async function sendMessage(message: string) {
    const content = message.trim()

    if (!content || activeRequest.current || isClearing) {
      return
    }

    const controller = new AbortController()
    const userMessageId = nextMessageId.current++
    const assistantMessageId = nextMessageId.current++
    activeRequest.current = controller
    streamingMessage.current = { id: assistantMessageId, text: '' }
    setMessages((current) => [
      ...current,
      { id: userMessageId, role: 'user', text: content },
      { id: assistantMessageId, role: 'assistant', text: '' },
    ])
    setDraft('')
    setError(null)
    setIsSending(true)

    try {
      const response = await fetch('/api/Conversation/stream', {
        method: 'POST',
        headers: {
          Accept: 'text/event-stream',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sessionId, message: content }),
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(`The request failed (HTTP ${response.status}).`)
      }

      if (!response.headers.get('content-type')?.includes('text/event-stream')) {
        throw new Error('The API did not return a streamed event response.')
      }

      if (!response.body) {
        throw new Error('The API returned no response stream.')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let dataLines: string[] = []
      let eventType = ''
      let answer = ''

      function dispatchEvent() {
        if (dataLines.length === 0) {
          eventType = ''
          return
        }

        const data = dataLines.join('\n')
        dataLines = []
        const currentEventType = eventType
        eventType = ''

        if (currentEventType === 'error') {
          const errorMessage = extractText(data) || data
          throw new Error(errorMessage || 'The streaming API returned an error.')
        }

        const chunk = parseStreamChunk(data)
        if (chunk.done) {
          return
        }

        answer += chunk.text
        const currentMessage = streamingMessage.current
        if (currentMessage?.id === assistantMessageId) {
          currentMessage.text = answer
        }
        setMessages((current) =>
          current.map((item) =>
            item.id === assistantMessageId ? { ...item, text: answer } : item,
          ),
        )
      }

      let streamEnded = false
      while (!streamEnded) {
        const { done, value } = await reader.read()
        buffer += decoder.decode(value, { stream: !done })

        let lineEnd = buffer.indexOf('\n')
        while (lineEnd !== -1) {
          const line = buffer.slice(0, lineEnd).replace(/\r$/, '')
          buffer = buffer.slice(lineEnd + 1)

          if (line === '') {
            dispatchEvent()
          } else if (line.startsWith(':')) {
            // SSE comments are keep-alive signals, not answer content.
          } else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).replace(/^ /, ''))
          } else if (line.startsWith('event:')) {
            eventType = line.slice(6).trim()
          }

          lineEnd = buffer.indexOf('\n')
        }

        if (done) {
          const finalLine = buffer.replace(/\r$/, '')
          if (finalLine) {
            if (finalLine.startsWith('data:')) {
              dataLines.push(finalLine.slice(5).replace(/^ /, ''))
            } else if (finalLine.startsWith('event:')) {
              eventType = finalLine.slice(6).trim()
            }
          }
          dispatchEvent()
          streamEnded = true
        }
      }

      if (!answer.trim()) {
        throw new Error('The streaming API returned an empty answer.')
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setError(
          error instanceof Error ? error.message : 'Unable to get an answer.',
        )
        setMessages((current) =>
          current.filter(
            (item) => item.id !== assistantMessageId || item.text.length > 0,
          ),
        )
      }
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null
        streamingMessage.current = null
        setIsSending(false)
      }
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void sendMessage(draft)
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !isSending) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  return (
    <main className="chat-shell">
      <header className="chat-header">
        <a className="chat-brand" href="/">
          <span className="chat-brand-mark" aria-hidden="true">
            D
          </span>
          Streaming conversation
        </a>
        <a className="back-link" href="/">
          Back to home
        </a>
      </header>

      <section className="chat-content" aria-label="Streaming conversation">
        <div className="session-toolbar">
          <div className="session-id">
            <span className="session-label">Session ID</span>
            <code>{sessionId}</code>
          </div>
          <button
            className="clear-session-button"
            type="button"
            onClick={clearSession}
            disabled={isClearing}
          >
            {isClearing ? 'Clearing…' : 'Clear Session'}
          </button>
        </div>

        <div className="chat-feed" aria-live="polite" ref={chatFeedRef}>
          {messages.length === 0 && (
            <div className="chat-welcome">
              <span className="welcome-mark" aria-hidden="true">
                D
              </span>
              <h1>What would you like to know?</h1>
              <p>
                Your conversation is remembered while you ask follow-up
                questions.
              </p>
              <div className="agent-suggestions" aria-label="Suggested questions">
                <button
                  className="agent-suggestion"
                  type="button"
                  onClick={() => void sendMessage(SUGGESTION)}
                  disabled={isSending || isClearing}
                >
                  {SUGGESTION}
                  <span aria-hidden="true">→</span>
                </button>
              </div>
            </div>
          )}

          {messages.map((item) => (
            <article
              className={`message-row message-${item.role}`}
              key={item.id}
            >
              <span className="message-avatar" aria-hidden="true">
                {item.role === 'user' ? 'Y' : 'D'}
              </span>
              <div className="message-body">
                <p className="message-author">
                  {item.role === 'user' ? 'You' : 'Assistant'}
                </p>
                <p className="message-text">{item.text}</p>
              </div>
            </article>
          ))}

          {isSending && (
            <p className="chat-thinking" role="status">
              <span className="thinking-dots" aria-hidden="true">
                •••
              </span>
              Generating response…
            </p>
          )}

          {error && (
            <p className="chat-error" role="alert">
              {error}
            </p>
          )}
        </div>

        <form className="chat-composer" onSubmit={handleSubmit}>
          <label className="visually-hidden" htmlFor="stream-question">
            Ask a question
          </label>
          <textarea
            id="stream-question"
            name="message"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder="Message the assistant"
            rows={1}
            maxLength={4000}
            disabled={isClearing}
          />
          {isSending ? (
            <button type="button" className="stop-button" onClick={stopGeneration}>
              Stop
            </button>
          ) : (
            <button type="submit" disabled={isClearing || !draft.trim()}>
              Send
            </button>
          )}
          <p className="composer-hint">Enter to send · Shift+Enter for a new line</p>
        </form>
      </section>
    </main>
  )
}

export default StreamingChat
