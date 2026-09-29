import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { 
  Plane, User, Bot, Send, Sparkles, Database, Shield, Zap, Globe, Ticket
} from 'lucide-react';
import './App.css';

function App() {
  const [messages, setMessages] = useState([
    { 
      role: 'agent', 
      content: 'Hello! I am **TravelMind**, your AI travel negotiation agent. \n\nI can help you search for flights, negotiate prices across multiple suppliers (GDS, LCC, OTA), and find the best deals. Where would you like to fly today?' 
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [thinkingPhase, setThinkingPhase] = useState(0);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, thinkingPhase]);

  // Simulate agent thinking phases for better UX
  useEffect(() => {
    let interval;
    if (isLoading) {
      interval = setInterval(() => {
        setThinkingPhase((prev) => (prev + 1) % 4);
      }, 2000);
    } else {
      setThinkingPhase(0);
    }
    return () => clearInterval(interval);
  }, [isLoading]);

  const thinkingMessages = [
    "Analyzing request...",
    "Querying vector database...",
    "Comparing fares & routes...",
    "Formulating response..."
  ];

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage = { role: 'user', content: input };
    const currentMessages = [...messages, userMessage];
    setMessages(currentMessages);
    setInput('');
    setIsLoading(true);
    setThinkingPhase(0);

    try {
      // Format chat history as a string, excluding the current query
      const historyStr = messages.map(m => `${m.role === 'user' ? 'User' : 'Agent'}: ${m.content}`).join('\n');

      const response = await fetch('http://localhost:8000/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          query: userMessage.content,
          chat_history: historyStr
        })
      });

      if (!response.ok) {
        throw new Error('Network response was not ok');
      }

      const data = await response.json();
      setMessages(prev => [...prev, { role: 'agent', content: data.output }]);
    } catch (error) {
      console.error('Error fetching response:', error);
      setMessages(prev => [...prev, { 
        role: 'agent', 
        content: '⚠️ **Error:** I encountered a problem connecting to my backend servers. Please ensure `uvicorn` is running.' 
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="app-container">
      {/* Sidebar for Agent Status & Capabilities */}
      <aside className="sidebar glass-panel">
        <div className="brand">
          <div className="brand-icon-wrapper">
            <Plane className="brand-icon" size={28} />
          </div>
          <h2>TravelMind</h2>
          <span className="status-badge">
            <span className="status-dot"></span> Online
          </span>
        </div>

        <div className="capabilities">
          <h3>Agent Capabilities</h3>
          <ul className="capability-list">
            <li><Database size={16} /> Semantic Vector Search</li>
            <li><Globe size={16} /> Multi-Supplier Auth</li>
            <li><Ticket size={16} /> Fare Normalization</li>
            <li><Zap size={16} /> Real-time Negotiation</li>
            <li><Shield size={16} /> Privacy Protected</li>
          </ul>
        </div>

        <div className="agent-info">
          <div className="agent-model">
            <Sparkles size={16} color="#10b981" />
            <span>Powered by Gemini Pro</span>
          </div>
        </div>
      </aside>

      {/* Main Chat Interface */}
      <main className="main-content">
        <header className="chat-header glass-panel">
          <div>
            <h1>Active Negotiation</h1>
            <p>Session ID: {Math.random().toString(36).substring(7).toUpperCase()}</p>
          </div>
        </header>

        <section className="chat-section glass-panel">
          <div className="chat-history">
            {messages.map((msg, index) => (
              <div key={index} className={`message-wrapper ${msg.role}`}>
                <div className="avatar">
                  {msg.role === 'agent' ? <Bot size={20} /> : <User size={20} />}
                </div>
                <div className="message">
                  {msg.role === 'agent' ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {msg.content}
                    </ReactMarkdown>
                  ) : (
                    <p>{msg.content}</p>
                  )}
                </div>
              </div>
            ))}
            
            {/* Dynamic Thinking State */}
            {isLoading && (
              <div className="message-wrapper agent thinking">
                <div className="avatar">
                  <Bot size={20} />
                </div>
                <div className="message">
                  <div className="thinking-indicator">
                    <Sparkles size={16} className="spin-slow" />
                    <span>{thinkingMessages[thinkingPhase]}</span>
                    <div className="loading-dots">
                      <span></span><span></span><span></span>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <form onSubmit={handleSubmit} className="input-area">
            <div className="input-wrapper">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about flights, e.g. 'Flights from Delhi to Mumbai tomorrow'"
                disabled={isLoading}
                autoFocus
              />
              <button type="submit" disabled={isLoading || !input.trim()} className="send-button">
                <Send size={18} />
              </button>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}

export default App;
