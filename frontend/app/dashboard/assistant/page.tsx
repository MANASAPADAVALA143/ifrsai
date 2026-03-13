'use client';

import { useState, useRef, useEffect } from 'react';
import { SidebarLayout } from '@/components/SidebarLayout';
import { MessageSquare, Send, Loader2 } from 'lucide-react';
import { chatApi } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import toast from 'react-hot-toast';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: unknown[];
}

export default function AssistantPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { getCompanyId } = useAuth();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);

    try {
      const companyId = getCompanyId();
      const { data, error } = await chatApi.ask(companyId, userMessage, 'lease');

      if (error) {
        throw new Error(error);
      }

      if (data) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: data.answer,
            sources: data.sources,
          },
        ]);
      }
    } catch (error) {
      toast.error('Failed to get answer. Please try again.');
      console.error('Chat error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <SidebarLayout>
      <div className="flex flex-col h-[calc(100vh-8rem)] max-w-3xl mx-auto">
        <h1 className="text-xl font-semibold text-text-primary mb-2">AI Assistant</h1>
        <p className="text-sm text-text-muted mb-6">
          Ask questions about your IFRS lease portfolio. Answers are powered by RAG (Retrieval-Augmented Generation).
        </p>

        <div className="flex-1 bg-white rounded-lg border border-border-default flex flex-col overflow-hidden">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {messages.length === 0 && (
              <div className="text-center text-text-muted py-16">
                <MessageSquare className="w-14 h-14 mx-auto mb-4 text-border-default" />
                <p className="text-base font-medium">Ask me anything about your IFRS data</p>
                <p className="text-sm mt-2">Try: &quot;What is my total lease liability?&quot;</p>
                <p className="text-sm mt-1">Or: &quot;Summarize my active leases&quot;</p>
              </div>
            )}

            {messages.map((message, index) => (
              <div
                key={index}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] px-4 py-3 rounded-lg ${
                    message.role === 'user'
                      ? 'bg-orange-500 text-white rounded-br-none'
                      : 'bg-bg-light text-text-primary rounded-bl-none border border-border-default'
                  }`}
                >
                  <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                  {message.sources && (message.sources as unknown[]).length > 0 && (
                    <div className="mt-2 pt-2 border-t border-gray-200 opacity-80">
                      <p className="text-xs">Sources: {(message.sources as unknown[]).length} documents</p>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-bg-light px-4 py-3 rounded-lg rounded-bl-none border border-border-default">
                  <div className="flex items-center gap-2 text-text-muted">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Thinking...</span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="border-t border-border-default p-4">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Ask about your lease portfolio..."
                className="flex-1 px-4 py-2.5 border border-border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500 bg-white"
                disabled={isLoading}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isLoading}
                className="bg-orange-500 text-white px-4 py-2.5 rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                <Send className="w-4 h-4" />
                Send
              </button>
            </div>
          </div>
        </div>
      </div>
    </SidebarLayout>
  );
}
