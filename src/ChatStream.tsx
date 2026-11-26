import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { agentSuggestions } from './agentSuggestions'

type Message = {
  id: number
  role: 'user' | 'assistant'
  text: string
  sources?: Source[]
}

type Source = {
  source: number
  fileName: string
  page: number
  score: number
  snippet: string
}

type RagEvent =
  | { type: 'done' }
  | { type: 'token'; text: string }
  | { type: 'sources'; items: Source[] }

function isSource(value: unknown): value is Source {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  return (
    'source' in value &&
    typeof value.source === 'number' &&
    'fileName' in value &&
    typeof value.fileName === 'string' &&
    'page' in value &&
    typeof value.page === 'number' &&
    'score' in value &&
    typeof value.score === 'number' &&
    'snippet' in value &&
    typeof value.snippet === 'string'
  )
}

function parseRagEvent(data: string): RagEvent {
  if (data.trim() === '[DONE]') {
    return { type: 'done' }
  }

  let value: unknown
  try {
    value = JSON.parse(data)
  } catch {
    throw new Error('The streaming API returned invalid JSON.')
  }

  if (typeof value !== 'object' || value === null || !('type' in value)) {
    throw new Error('The streaming API returned an unsupported event.')
  }

  const type = Reflect.get(value, 'type')
  if (type === 'token') {
    const text = Reflect.get(value, 'text')
    if (typeof text !== 'string') {
      throw new Error('The streaming API returned an invalid token.')
    }
    return { type, text }
  }

  if (type === 'sources') {
    const items = Reflect.get(value, 'items')
    if (!Array.isArray(items) || !items.every(isSource)) {
      throw new Error('The streaming API returned invalid sources.')
    }
    return { type, items }
  }

  if (type === 'error') {
    const message = Reflect.get(value, 'message')
    throw new Error(
      typeof message === 'string' ? message : 'The API returned an error.',
    )
  }

  throw new Error(`The streaming API returned an unknown event: ${String(type)}.`)
}

function ChatStream() {
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
    activeRequest.current = controller
    activeAssistantMessage.current = { id: assistantMessageId, text: '' }
    setMessages((current) => [
      ...current,
      { id: nextMessageId.current++, role: 'user', text: content },
      { id: assistantMessageId, role: 'assistant', text: '' },
    ])
    setDraft('')
    setError(null)
    setIsSending(true)

    try {
      const response = await fetch('/api/Documents/AskQuestion/ragStream', {
        method: 'POST',
        headers: {
          Accept: 'text/event-stream',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ question: content }),
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
      let answer = ''

      function dispatchEvent() {
        if (dataLines.length === 0) {
          return
        }

        const data = dataLines.join('\n')
        dataLines = []
        const event = parseRagEvent(data)

        if (event.type === 'token') {
          answer += event.text
          const currentMessage = activeAssistantMessage.current
          if (currentMessage?.id === assistantMessageId) {
            currentMessage.text = answer
          }
          setMessages((current) =>
            current.map((item) =>
              item.id === assistantMessageId ? { ...item, text: answer } : item,
            ),
          )
        } else if (event.type === 'sources') {
          setMessages((current) =>
            current.map((item) =>
              item.id === assistantMessageId
                ? { ...item, sources: event.items }
                : item,
            ),
          )
        }
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
            D
          </span>
          Document RAG stream
        </a>
        <a className="back-link" href="/">
          Back to home
        </a>
      </header>

      <section className="chat-content" aria-label="Streaming document chat">
        <div className="chat-feed" aria-live="polite" ref={chatFeedRef}>
          {messages.length === 0 && (
            <div className="chat-welcome">
              <span className="welcome-mark" aria-hidden="true">
                D
              </span>
              <h1>Ask your documents</h1>
              <p>Answers stream in as they are generated from your documents.</p>
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
                {message.role === 'user' ? 'Y' : 'D'}
              </span>
              <div className="message-body">
                <p className="message-author">
                  {message.role === 'user' ? 'You' : 'Assistant'}
                </p>
                <p className="message-text">{message.text}</p>
                {message.role === 'assistant' &&
                  !isSending &&
                  message.sources &&
                  message.sources.length > 0 && (
                    <details className="answer-sources">
                      <summary>Sources ({message.sources.length})</summary>
                      <ul>
                        {message.sources.map((source) => (
                          <li
                            key={`${source.source}-${source.fileName}-${source.page}`}
                          >
                            <strong>
                              {source.fileName}, page {source.page}
                            </strong>
                            <p>{source.snippet}</p>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
              </div>
            </article>
          ))}

          {isSending && (
            <p className="chat-thinking" role="status">
              <span className="thinking-dots" aria-hidden="true">
                •••
              </span>
              Searching documents and generating response…
            </p>
          )}

          {error && (
            <p className="chat-error" role="alert">
              {error}
            </p>
          )}
        </div>

        <form className="chat-composer" onSubmit={handleSubmit}>
          <label className="visually-hidden" htmlFor="rag-question">
            Ask a question about your documents
          </label>
          <textarea
            id="rag-question"
            name="question"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder="Ask a question about your documents"
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

export default ChatStream
