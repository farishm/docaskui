import Agent from './Agent'
import Chat from './Chat'
import ChatDocument from './ChatDocument'
import ChatStream from './ChatStream'
import Documents from './Documents'
import Home from './Home'
import StreamingChat from './StreamingChat'
import './App.css'

function App() {
  const path = window.location.pathname.replace(/\/+$/, '')

  if (path === '/chat') {
    return <Chat />
  }

  if (path === '/chat-document') {
    return <ChatDocument />
  }

  if (path === '/agent') {
    return <Agent />
  }

  if (path === '/chat-stream') {
    return <ChatStream />
  }

  if (path === '/documents') {
    return <Documents />
  }

  if (path === '/stream-chat') {
    return <StreamingChat />
  }

  return <Home />
}

export default App
