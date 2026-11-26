import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { fetchDocuments, type DocumentFile } from './documentApi'

type Message = {
  id: number
  role: 'user' | 'assistant'
  text: string
}

type ChatDocumentEvent =
  | { type: 'done' }
  | { type: 'token'; text: string }
  | { type: 'sources' }

const suggestions = [
  'Give me the details of the Aurora?',
  'As of 2023, what percentage  of Europeans  were connected  to the internet?',
  'How much renewable energy has Microsoft contracted?',
  "What is Microsoft's water conservation target or progress?",
  'How much Microsoft planning to invested through its Climate Innovation Fund in South Asia? ',
   "Which is Paul's largest monthly expense?",
  "What percentage of his total expenses is spent on food?",
  "What are his total transportation and communication expenses?",
  "If his salary increases by 10%, what will his new monthly balance be?",
]

function parseChatDocumentEvent(data: string): ChatDocumentEvent {
  if (data.trim() === '[DONE]') {
    return { type: 'done' }
  }

  let value: unknown
  try {
    value = JSON.parse(data)
  } catch {
    throw new Error('The document chat endpoint returned invalid JSON.')
  }

  if (typeof value !== 'object' || value === null || !('type' in value)) {
    throw new Error('The document chat endpoint returned an unsupported event.')
  }

  const type = Reflect.get(value, 'type')
  if (type === 'token') {
    const text = Reflect.get(value, 'text')
    if (typeof text !== 'string') {
      throw new Error('The document chat endpoint returned an invalid token.')
    }
    return { type, text }
  }

  if (type === 'sources') {
    if (!Array.isArray(Reflect.get(value, 'items'))) {
      throw new Error('The document chat endpoint returned invalid sources.')
    }
    return { type }
  }

  if (type === 'error') {
    const message = Reflect.get(value, 'message')
    throw new Error(
      typeof message === 'string'
        ? message
        : 'The document chat endpoint returned an error.',
    )
  }

  throw new Error(
    `The document chat endpoint returned an unknown event: ${String(type)}.`,
  )
}

function ChatDocument() {
  const [documents, setDocuments] = useState<DocumentFile[]>([])
  const [selectedDocumentId, setSelectedDocumentId] = useState('')
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(true)
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

  useEffect(() => {
    const controller = new AbortController()

    fetchDocuments(controller.signal)
      .then(setDocuments)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            error instanceof Error ? error.message : 'Could not load documents.',
          )
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoadingDocuments(false)
        }
      })

    return () => controller.abort()
  }, [])

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

  function handleDocumentChange(documentId: string) {
    setSelectedDocumentId(documentId)
    setMessages([])
    setDraft('')
    setError(null)
    nextMessageId.current = 0
  }

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
    if (!selectedDocumentId || !content || activeRequest.current) {
      return
    }

    const controller = new AbortController()
    const assistantMessageId = nextMessageId.current++
    const userMessage = {
      id: nextMessageId.current++,
      role: 'user' as const,
      text: content,
    }

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
      const response = await fetch(
        `/api/Documents/${encodeURIComponent(selectedDocumentId)}/askDocument/stream`,
        {
          method: 'POST',
          headers: {
            Accept: 'text/event-stream',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ question: content }),
          signal: controller.signal,
        },
      )

      if (!response.ok) {
        throw new Error(`The request failed (HTTP ${response.status}).`)
      }

      if (!response.headers.get('content-type')?.includes('text/event-stream')) {
        throw new Error('The document chat endpoint did not return a streamed response.')
      }

      if (!response.body) {
        throw new Error('The document chat endpoint returned no response stream.')
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
        const event = parseChatDocumentEvent(data)
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
          } else if (line.startsWith(':')) {
            // SSE comments are keep-alive signals, not answer content.
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
        throw new Error('The document chat endpoint returned an empty answer.')
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

  const selectionTooltip = selectedDocumentId
    ? undefined
    : 'Please select a file from the dropdown list.'

  return (
    <main className="chat-shell">
      <header className="chat-header">
        <a className="chat-brand" href="/">
          <span className="chat-brand-mark" aria-hidden="true">
            D
          </span>
          Chat Document
        </a>
        <a className="back-link" href="/">
          Back to home
        </a>
      </header>

      <section className="chat-content" aria-label="Chat with a document">
        <div className="document-chat-toolbar">
          <label htmlFor="chat-document-select">Select the Document</label>
          <select
            id="chat-document-select"
            value={selectedDocumentId}
            onChange={(event) => handleDocumentChange(event.target.value)}
            disabled={isLoadingDocuments || isSending || documents.length === 0}
          >
            <option value="">
              {isLoadingDocuments
                ? 'Loading documents…'
                : documents.length === 0
                  ? 'No documents available'
                  : 'Select the Document'}
            </option>
            {documents.map((document) => (
              <option key={document.id} value={document.id}>
                {document.fileName}
              </option>
            ))}
          </select>
        </div>

        <div className="chat-feed" aria-live="polite" ref={chatFeedRef}>
          {messages.length === 0 && (
            <div className="chat-welcome">
              <span className="welcome-mark" aria-hidden="true">
                D
              </span>
              <h1>Ask your document</h1>
              <p>Select a document, then ask a question about its contents.</p>
              <div
                className="document-chat-suggestions"
                aria-label="Suggested questions"
              >
                {suggestions.map((suggestion) => (
                  <button
                    className="document-chat-suggestion"
                    key={suggestion}
                    type="button"
                    onClick={() => void sendQuestion(suggestion)}
                    disabled={!selectedDocumentId || isSending}
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
              Searching the selected document and generating response…
            </p>
          )}

          {error && (
            <p className="chat-error" role="alert">
              {error}
            </p>
          )}
        </div>

        <form className="chat-composer" onSubmit={handleSubmit}>
          <label className="visually-hidden" htmlFor="chat-document-question">
            Ask a question about the selected document
          </label>
          <textarea
            id="chat-document-question"
            name="question"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder="Ask a question about the selected document"
            rows={1}
            maxLength={4000}
          />
          {isSending ? (
            <button type="button" className="stop-button" onClick={stopGeneration}>
              Stop
            </button>
          ) : (
            <span
              className="chat-send-tooltip"
              title={selectionTooltip}
              aria-label={selectionTooltip}
            >
              <button
                type="submit"
                disabled={!selectedDocumentId || !draft.trim() || isLoadingDocuments}
                title={selectionTooltip}
              >
                Send
              </button>
            </span>
          )}
          <p className="composer-hint">Enter to send · Shift+Enter for a new line</p>
        </form>
      </section>
    </main>
  )
}

export default ChatDocument
