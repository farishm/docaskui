function Home() {
  return (
    <main className="home-page">
      <div className="home-content">
        <header className="home-intro">
          <h1>DocAsk Prototype</h1>
          <p>
            Upload documents to Azure AI Search, manage documents, do RAG
            searches and common LLM searches, and chat with the Agent.
          </p>
        </header>
        <nav className="home-links" aria-label="Available chats">
          <a className="chat-link" href="/documents">
            Manage Documents
            <span aria-hidden="true">→</span>
          </a>
          <a className="chat-link" href="/chat">
            Document - RAG Chat
            <span aria-hidden="true">→</span>
          </a>
          <a className="chat-link" href="/chat-stream">
            Document - Stream RAG Chat
            <span aria-hidden="true">→</span>
          </a>
          <a className="chat-link" href="/chat-document">
            Document - Select Document & Chat
            <span aria-hidden="true">→</span>
          </a>
          <a className="chat-link" href="/agent">
            Document - Agent
            <span aria-hidden="true">→</span>
          </a>
          <a className="chat-link" href="/stream-chat">
            Common LLM Chat - Streaming with Session Memory and Cancellation
            <span aria-hidden="true">→</span>
          </a>
        </nav>
      </div>
    </main>
  )
}

export default Home
