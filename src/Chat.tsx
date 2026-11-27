import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { apiUrl } from './api'
import { agentSuggestions } from './agentSuggestions'

type Message = {
  id: number
  role: 'user' | 'assistant'
  text: string
}

function extractAnswer(value: unknown): string | null {
  if (typeof value === 'string') {
    return value.trim() || null
  }

  if (typeof value !== 'object' || value === null) {
    return null
  }

  for (const key of ['answer', 'response', 'result', 'text', 'content']) {
    if (key in value) {
      const answer = extractAnswer(Reflect.get(value, key))

      if (answer) {
        return answer
      }
    }
  }

  return null
}

function Chat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nextMessageId = useRef(0)
  const activeRequest = useRef<AbortController | null>(null)
  const chatFeedRef = useRef<HTMLDivElement>(null)

  useEffect(() => () => activeRequest.current?.abort(), [])

  useEffect(() => {
    if (messages.length > 0 && chatFeedRef.current) {
      chatFeedRef.current.scrollTop = chatFeedRef.current.scrollHeight
    }
  }, [messages, isSending, error])

  async function sendQuestion(question: string) {
    const content = question.trim()

    if (!content || activeRequest.current) {
      return
    }

    const controller = new AbortController()
    activeRequest.current = controller
    setMessages((current) => [
      ...current,
      { id: nextMessageId.current++, role: 'user', text: content },
    ])
    setDraft('')
    setError(null)
    setIsSending(true)

    try {
      const response = await fetch(apiUrl('/api/Documents/AskQuestion/rag'), {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/plain',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ question: content }),
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(`The request failed (HTTP ${response.status}).`)
      }

      const responseText = await response.text()

      if (!responseText.trim()) {
        throw new Error('The API returned an empty answer.')
      }

      let answer: string | null
      if (response.headers.get('content-type')?.includes('json')) {
        let data: unknown
        try {
          data = JSON.parse(responseText)
        } catch {
          throw new Error('The API returned invalid JSON.')
        }
        answer = extractAnswer(data)
      } else {
        answer = responseText.trim()
      }

      if (!answer) {
        throw new Error('The API response did not contain an answer.')
      }

      setMessages((current) => [
        ...current,
        { id: nextMessageId.current++, role: 'assistant', text: answer },
      ])
    } catch (error) {
      if (!controller.signal.aborted) {
        setError(
          error instanceof Error ? error.message : 'Unable to get an answer.',
        )
      }
    } finally {
      if (!controller.signal.aborted) {
        activeRequest.current = null
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
          Document assistant
        </a>
        <a className="back-link" href="/">
          Back to home
        </a>
      </header>

      <section className="chat-content" aria-label="Document assistant chat">
        <div className="chat-feed" aria-live="polite" ref={chatFeedRef}>
          {messages.length === 0 && (
            <div className="chat-welcome">
              <span className="welcome-mark" aria-hidden="true">
                D
              </span>
              <h1>What would you like to know?</h1>
              <p>Ask a question and I’ll look for an answer in your documents.</p>
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
              </div>
            </article>
          ))}

          {isSending && (
            <p className="chat-thinking" role="status">
              <span className="thinking-dots" aria-hidden="true">
                •••
              </span>
              Looking through your documents…
            </p>
          )}

          {error && (
            <p className="chat-error" role="alert">
              {error} Please try again.
            </p>
          )}
        </div>

        <form className="chat-composer" onSubmit={handleSubmit}>
          <label className="visually-hidden" htmlFor="question">
            Ask a question about your documents
          </label>
          <textarea
            id="question"
            name="question"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder="Message the document assistant"
            rows={1}
            maxLength={4000}
            disabled={isSending}
          />
          <button type="submit" disabled={isSending || !draft.trim()}>
            {isSending ? 'Sending…' : 'Send'}
          </button>
          <p className="composer-hint">Enter to send · Shift+Enter for a new line</p>
        </form>
      </section>
    </main>
  )
}

export default Chat
