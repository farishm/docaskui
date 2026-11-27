import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { apiUrl } from './api'
import { agentSuggestions } from './agentSuggestions'

type Message = {
  id: number
  role: 'user' | 'assistant'
  text: string
}

type AgentEvent =
  | { type: 'done' }
  | { type: 'token'; text: string }
  | { type: 'tool_call'; id: string; name: string; args: string }
  | { type: 'tool_result'; id: string; name: string; text: string }

function parseAgentEvent(data: string): AgentEvent {
  if (data.trim() === '[DONE]') {
    return { type: 'done' }
  }

  let value: unknown
  try {
    value = JSON.parse(data)
  } catch {
    throw new Error('The Agent endpoint returned invalid JSON.')
  }

  if (typeof value !== 'object' || value === null || !('type' in value)) {
    throw new Error('The Agent endpoint returned an unsupported event.')
  }

  const type = Reflect.get(value, 'type')
  if (type === 'token') {
    const text = Reflect.get(value, 'text')
    if (typeof text !== 'string') {
      throw new Error('The Agent endpoint returned an invalid token.')
    }
    return { type, text }
  }

  if (type === 'error') {
    const message = Reflect.get(value, 'message')
    throw new Error(
      typeof message === 'string' ? message : 'The Agent endpoint returned an error.',
    )
  }

  if (type === 'tool_call') {
    const id = Reflect.get(value, 'id')
    const name = Reflect.get(value, 'name')
    const args = Reflect.get(value, 'args')
    if (
      typeof id !== 'string' ||
      typeof name !== 'string' ||
      typeof args !== 'string'
    ) {
      throw new Error('The Agent endpoint returned an invalid tool call.')
    }
    return { type, id, name, args }
  }

  if (type === 'tool_result') {
    const id = Reflect.get(value, 'id')
    const name = Reflect.get(value, 'name')
    const text = Reflect.get(value, 'text')
    if (
      typeof id !== 'string' ||
      typeof name !== 'string' ||
      typeof text !== 'string'
    ) {
      throw new Error('The Agent endpoint returned an invalid tool result.')
    }
    return { type, id, name, text }
  }

  throw new Error(`The Agent endpoint returned an unknown event: ${String(type)}.`)
}

function Agent() {
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nextMessageId = useRef(0)
  const activeRequest = useRef<AbortController | null>(null)
  const activeAssistantMessage = useRef<{ id: number; text: string } | null>(
    null,
  )
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
    const assistantMessage = activeAssistantMessage.current
    activeAssistantMessage.current = null
    if (assistantMessage?.text === '') {
      setMessages((current) =>
        current.filter((message) => message.id !== assistantMessage.id),
      )
    }
    setIsSending(false)
  }

  async function sendQuestion(question: string) {
    const content = question.trim()
    if (!content || activeRequest.current) {
      return
    }

    const controller = new AbortController()
    const assistantMessageId = nextMessageId.current++
    const userMessage = { id: nextMessageId.current++, role: 'user' as const, text: content }
    const conversation = [
      ...messages
        .filter((message) => message.text.trim())
        .map(({ role, text }) => ({ role, content: text })),
      { role: userMessage.role, content: userMessage.text },
    ]

    activeRequest.current = controller
    activeAssistantMessage.current = { id: assistantMessageId, text: '' }
    setMessages((current) => [
      ...current,
      userMessage,
      { id: assistantMessageId, role: 'assistant', text: '' },
    ])
    setDraft('')
    setError(null)
    setIsSending(true)

    try {
      const response = await fetch(apiUrl('/api/AgentV1/stream'), {
        method: 'POST',
        headers: {
          Accept: 'text/event-stream',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: conversation,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(`The request failed (HTTP ${response.status}).`)
      }

      if (!response.headers.get('content-type')?.includes('text/event-stream')) {
        throw new Error('The Agent endpoint did not return a streamed response.')
      }

      if (!response.body) {
        throw new Error('The Agent endpoint returned no response stream.')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let dataLines: string[] = []
      let answer = ''

      function dispatchEvent() {
        if (dataLines.length === 0) {
          return
        }

        const data = dataLines.join('\n')
        dataLines = []
        const event = parseAgentEvent(data)
        if (event.type !== 'token') {
          return
        }

        answer += event.text
        const currentMessage = activeAssistantMessage.current
        if (currentMessage?.id === assistantMessageId) {
          currentMessage.text = answer
        }
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantMessageId
              ? { ...message, text: answer }
              : message,
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
          } else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).replace(/^ /, ''))
          }

          lineEnd = buffer.indexOf('\n')
        }

        if (done) {
          const finalLine = buffer.replace(/\r$/, '')
          if (finalLine.startsWith('data:')) {
            dataLines.push(finalLine.slice(5).replace(/^ /, ''))
          }
          dispatchEvent()
          streamEnded = true
        }
      }

      if (!answer.trim()) {
        throw new Error('The Agent endpoint returned an empty answer.')
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setError(
          error instanceof Error ? error.message : 'Unable to get an answer.',
        )
        setMessages((current) =>
          current.filter(
            (message) =>
              message.id !== assistantMessageId || message.text.length > 0,
          ),
        )
      }
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null
        activeAssistantMessage.current = null
        setIsSending(false)
      }
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void sendQuestion(draft)
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
            A
          </span>
          Agent
        </a>
        <a className="back-link" href="/">
          Back to home
        </a>
      </header>

      <section className="chat-content" aria-label="Agent chat">
        <div className="chat-feed" aria-live="polite" ref={chatFeedRef}>
          {messages.length === 0 && (
            <div className="chat-welcome">
              <span className="welcome-mark" aria-hidden="true">
                A
              </span>
              <h1>How can I help?</h1>
              <p>Ask a question or choose a suggestion to get started.</p>
              <div className="agent-suggestions" aria-label="Suggested questions">
                {agentSuggestions.map((suggestion) => (
                  <button
                    className="agent-suggestion"
                    key={suggestion}
                    type="button"
                    onClick={() => void sendQuestion(suggestion)}
                    disabled={isSending}
                  >
                    {suggestion}
                    <span aria-hidden="true">→</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message) => (
            <article
              className={`message-row message-${message.role}`}
              key={message.id}
            >
              <span className="message-avatar" aria-hidden="true">
                {message.role === 'user' ? 'Y' : 'A'}
              </span>
              <div className="message-body">
                <p className="message-author">
                  {message.role === 'user' ? 'You' : 'Agent'}
                </p>
                <p className="message-text">{message.text}</p>
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
          <label className="visually-hidden" htmlFor="agent-question">
            Ask the Agent a question
          </label>
          <textarea
            id="agent-question"
            name="question"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder="Message the Agent"
            rows={1}
            maxLength={4000}
          />
          {isSending ? (
            <button type="button" className="stop-button" onClick={stopGeneration}>
              Stop
            </button>
          ) : (
            <button type="submit" disabled={!draft.trim()}>
              Send
            </button>
          )}
          <p className="composer-hint">Enter to send · Shift+Enter for a new line</p>
        </form>
      </section>
    </main>
  )
}

export default Agent
