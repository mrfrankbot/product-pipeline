import React, { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { MessageCircle, Send, X, Bot, User, Zap, Clock, Navigation } from 'lucide-react';
import { useAppStore, ChatMessage } from '../store';

// Command parsing patterns
const commandPatterns = [
  // Sync commands
  { pattern: /sync\s+(all\s+)?products?/i, action: 'sync_products', method: 'POST', endpoint: '/api/sync/products' },
  { pattern: /sync\s+orders?/i, action: 'sync_orders', method: 'POST', endpoint: '/api/sync/trigger', data: { type: 'orders' } },
  { pattern: /sync\s+inventory/i, action: 'sync_inventory', method: 'POST', endpoint: '/api/sync/inventory' },
  
  // Listing commands
  { pattern: /republish\s+stale\s+listings?/i, action: 'republish_stale', method: 'POST', endpoint: '/api/listings/republish-stale' },
  { pattern: /apply\s+price\s+drops?/i, action: 'apply_price_drops', method: 'POST', endpoint: '/api/listings/apply-price-drops' },
  { pattern: /show\s+stale\s+listings?/i, action: 'show_stale_listings', method: 'GET', endpoint: '/api/listings/stale' },
  { pattern: /show\s+listing\s+health/i, action: 'show_listing_health', method: 'GET', endpoint: '/api/listings/health' },
  
  // Status commands
  { pattern: /show\s+status|check\s+status|status/i, action: 'show_status', method: 'GET', endpoint: '/api/status' },
  { pattern: /check\s+inventory/i, action: 'check_inventory', method: 'GET', endpoint: '/api/sync/inventory' },
  
  // Settings and cleanup
  { pattern: /show\s+settings/i, action: 'show_settings', method: 'GET', endpoint: '/api/settings' },
  { pattern: /cleanup\s+duplicate\s+orders?/i, action: 'cleanup_orders', method: 'POST', endpoint: '/api/orders/cleanup' },
];

// Command suggestions (for autocomplete)
const suggestions = [
  'sync all products',
  'sync orders',
  'check inventory',
  'show status',
  'show stale listings',
  'show listing health',
  'apply price drops',
  'republish stale listings',
  'cleanup duplicate orders',
  'show settings',
];

// Fallback quick actions (used until capabilities API responds)
const defaultQuickActions = [
  { label: '📊 Show status', message: 'show status', isNew: false },
  { label: '📦 List products', message: 'list products', isNew: false },
  { label: '🔄 Sync all products', message: 'sync all products', isNew: false },
  { label: '📋 Show orders', message: 'show orders', isNew: false },
  { label: '⚙️ Check mappings', message: 'show mappings', isNew: false },
  { label: '🏥 Listing health check', message: 'show listing health', isNew: false },
];

// Category emoji map
const categoryEmoji: Record<string, string> = {
  shopify: '🛍️',
  ebay: '📦',
  pipeline: '🔄',
  images: '🖼️',
  analytics: '📊',
  settings: '⚙️',
};

// Page-specific contextual quick actions
const pageQuickActions: Record<string, Array<{ label: string; message: string }>> = {
  '/': [
    { label: '📊 Full status check', message: 'show status' },
    { label: '🏥 Listing health', message: 'show listing health' },
  ],
  '/listings': [
    { label: '🔄 Sync all', message: 'sync all products' },
    { label: '📋 Show stale listings', message: 'show stale listings' },
    { label: '💰 Apply price drops', message: 'apply price drops' },
  ],
  '/orders': [
    { label: '🔄 Sync recent orders', message: 'sync orders' },
    { label: '📋 Show orders', message: 'show orders' },
  ],
  '/mappings': [
    { label: '⚙️ Show current mappings', message: 'show mappings' },
    { label: '🔧 Check mappings', message: 'check mappings' },
  ],
};

const ChatWidget: React.FC = () => {
  const { 
    chatOpen, 
    toggleChat, 
    chatMessages, 
    chatLoading, 
    addChatMessage, 
    setChatLoading 
  } = useAppStore();
  
  const location = useLocation();
  const navigate = useNavigate();
  
  const [inputValue, setInputValue] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [filteredSuggestions, setFilteredSuggestions] = useState<string[]>([]);
  const [navToast, setNavToast] = useState<string | null>(null);
  const [welcomeQuickActions, setWelcomeQuickActions] = useState(defaultQuickActions);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch capabilities on mount to build dynamic quick-action pills
  useEffect(() => {
    let cancelled = false;
    fetch('/api/capabilities')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.capabilities) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const caps = data.capabilities as Array<{
          id: string;
          name: string;
          category: string;
          examplePrompts: string[];
          isNew?: boolean;
        }>;
        // Pick one representative prompt per capability, limit to 8
        const pills = caps
          .filter((c) => c.examplePrompts.length > 0)
          .slice(0, 8)
          .map((c) => ({
            label: `${categoryEmoji[c.category] || '🔹'} ${c.name}`,
            message: c.examplePrompts[0],
            isNew: !!c.isNew,
          }));
        if (pills.length > 0) {
          setWelcomeQuickActions(pills);
        }
      })
      .catch(() => {
        /* keep defaults */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatMessages]);

  useEffect(() => {
    if (chatOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [chatOpen]);

  // Auto-dismiss navigation toast
  useEffect(() => {
    if (navToast) {
      const timer = setTimeout(() => setNavToast(null), 2500);
      return () => clearTimeout(timer);
    }
  }, [navToast]);

  // Get contextual quick actions for the current page
  const currentPageActions = pageQuickActions[location.pathname] || pageQuickActions['/'] || [];

  const parseCommand = (message: string) => {
    for (const pattern of commandPatterns) {
      if (pattern.pattern.test(message)) {
        return pattern;
      }
    }
    return null;
  };

  const executeApiCall = async (endpoint: string, method: string, data?: unknown) => {
    const options: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (data && method !== 'GET') {
      options.body = JSON.stringify(data);
    }

    const response = await fetch(endpoint, options);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  };

  const formatApiResponse = (action: string, data: unknown, error?: string) => {
    if (error) {
      return `❌ **Error**: ${error}`;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = data as any;

    switch (action) {
      case 'sync_products':
        return `✅ **Product sync started successfully!**\n\nI'll update you as the sync progresses. You can check the dashboard for real-time status updates.`;
        
      case 'sync_orders':
        return `✅ **Order sync triggered!**\n\nSyncing orders from eBay to Shopify. This usually takes a few minutes depending on the volume.`;
        
      case 'sync_inventory':
        return `✅ **Inventory sync completed!**\n\nUpdated stock levels between Shopify and eBay.`;
        
      case 'show_status':
        if (d?.status) {
          const { products, orders, shopifyConnected, ebayConnected, revenue } = d;
          return `📊 **System Status**\n\n` +
            `**Connections:**\n` +
            `• Shopify: ${shopifyConnected ? '✅ Connected' : '❌ Disconnected'}\n` +
            `• eBay: ${ebayConnected ? '✅ Connected' : '❌ Disconnected'}\n\n` +
            `**Products:** ${products?.mapped || 0} mapped, ${products?.pending || 0} pending\n` +
            `**Orders:** ${orders?.imported || 0} imported today\n` +
            `**Revenue:** $${revenue?.today?.toFixed(2) || '0.00'} today`;
        }
        break;
        
      case 'show_stale_listings':
        if (d?.data && Array.isArray(d.data)) {
          const staleCount = d.data.length;
          return `📋 **Stale Listings Found: ${staleCount}**\n\n` +
            (staleCount > 0 
              ? d.data.slice(0, 5).map((item: { title: string; lastSynced: string }) => 
                  `• ${item.title} (Last updated: ${new Date(item.lastSynced).toLocaleDateString()})`
                ).join('\n') +
                (staleCount > 5 ? `\n\n...and ${staleCount - 5} more` : '')
              : 'No stale listings found! Everything is up to date. 🎉');
        }
        break;
        
      case 'show_listing_health':
        return `🏥 **Listing Health Report**\n\nAnalyzing your listings for optimization opportunities...`;
          
      case 'check_inventory':
        return `📦 **Inventory Status**\n\nChecking stock levels across platforms...`;
          
      case 'republish_stale':
        return `🔄 **Republishing stale listings...**\n\nThis will refresh outdated listings and improve visibility.`;
          
      case 'apply_price_drops':
        return `💰 **Applying price drops...**\n\nUpdating pricing strategy based on current market conditions.`;
          
      case 'cleanup_orders':
        return `🧹 **Cleaning up duplicate orders...**\n\nRemoving duplicate entries and consolidating order data.`;
          
      case 'show_settings':
        return `⚙️ **Settings Overview**\n\nCurrent configuration and sync preferences are displayed in the Settings page.`;
          
      default:
        return `✅ **Command executed successfully!**\n\n` +
          (typeof data === 'object' ? `Result: ${JSON.stringify(data, null, 2)}` : `Result: ${data}`);
    }

    return `✅ **Command completed**`;
  };

  const handleNavigate = (path: string) => {
    const pageNames: Record<string, string> = {
      '/': 'Dashboard',
      '/listings': 'Products',
      '/orders': 'Orders',
      '/mappings': 'Mappings',
      '/logs': 'Analytics',
      '/settings': 'Settings',
      '/images': 'Image Processor',
    };
    const pageName = pageNames[path] || path;
    setNavToast(`Navigating to ${pageName}...`);
    navigate(path);
  };

  const sendMessage = async (messageText: string) => {
    if (!messageText.trim()) return;

    const userMessage: Omit<ChatMessage, 'id'> = {
      role: 'user',
      content: messageText,
      timestamp: new Date(),
    };

    addChatMessage(userMessage);
    const command = parseCommand(messageText);
    setInputValue('');
    setShowSuggestions(false);
    setChatLoading(true);

    try {
      if (command) {
        // Fast-path: execute recognized API command directly
        const result = await executeApiCall(command.endpoint, command.method, command.data);
        const formattedResponse = formatApiResponse(command.action, result);
        
        addChatMessage({
          role: 'assistant',
          content: formattedResponse,
          timestamp: new Date(),
          commandResult: result,
        });
      } else {
        // Send to AI chat backend for natural language processing
        try {
          const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: messageText, currentPage: location.pathname }),
          });
          if (res.ok) {
            const data = await res.json();
            let content = data.response || 'No response';
            if (data.actions?.length) {
              content += '\n\n' + data.actions.map((a: { success?: boolean; type: string; detail?: string }) =>
                `${a.success !== false ? '✅' : '❌'} ${a.type}: ${a.detail || ''}`
              ).join('\n');
            }
            addChatMessage({ role: 'assistant', content, timestamp: new Date() });

            // Handle navigation if the AI requested it
            if (data.navigate && typeof data.navigate === 'string') {
              handleNavigate(data.navigate);
            }
          } else {
            // AI not available, fall back to local help
            const response = generateHelpfulResponse(messageText);
            addChatMessage({ role: 'assistant', content: response, timestamp: new Date() });
          }
        } catch {
          // AI endpoint unreachable, fall back to local help
          const response = generateHelpfulResponse(messageText);
          addChatMessage({ role: 'assistant', content: response, timestamp: new Date() });
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      const formattedResponse = formatApiResponse(command?.action || 'error', null, errorMessage);
      
      addChatMessage({
        role: 'assistant',
        content: formattedResponse,
        timestamp: new Date(),
        error: errorMessage,
      });
    } finally {
      setChatLoading(false);
    }
  };

  const handleSendMessage = async () => {
    await sendMessage(inputValue);
  };

  const handleQuickAction = async (message: string) => {
    await sendMessage(message);
  };

  const generateHelpfulResponse = (input: string) => {
    const lowercaseInput = input.toLowerCase();
    
    if (lowercaseInput.includes('help') || lowercaseInput.includes('what can you do')) {
      return `🤖 **I can help you with:**\n\n` +
        `**Sync Operations:**\n• sync all products\n• sync orders\n• sync inventory\n\n` +
        `**Listing Management:**\n• show stale listings\n• republish stale listings\n• apply price drops\n• show listing health\n\n` +
        `**System Status:**\n• show status\n• check inventory\n• show settings\n\n` +
        `**Maintenance:**\n• cleanup duplicate orders\n\n` +
        `Just type any of these commands naturally!`;
    }
    
    if (lowercaseInput.includes('thank')) {
      return `You're welcome! 😊 Is there anything else I can help you with?`;
    }
    
    // Find closest matching command
    const closeMatches = suggestions.filter(suggestion => 
      suggestion.includes(lowercaseInput) || lowercaseInput.includes(suggestion.split(' ')[0])
    );
    
    if (closeMatches.length > 0) {
      return `🤔 I didn't recognize that exact command, but did you mean:\n\n` +
        closeMatches.slice(0, 3).map(match => `• ${match}`).join('\n') +
        `\n\nType "help" to see all available commands.`;
    }
    
    return `🤔 I'm not sure how to help with that. Try typing "help" to see what I can do, or use commands like:\n\n` +
      `• "sync all products"\n• "show status"\n• "check inventory"`;
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);
    
    if (value.trim().length > 0) {
      const filtered = suggestions.filter(suggestion =>
        suggestion.toLowerCase().includes(value.toLowerCase())
      );
      setFilteredSuggestions(filtered);
      setShowSuggestions(filtered.length > 0);
    } else {
      setShowSuggestions(false);
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    setInputValue(suggestion);
    setShowSuggestions(false);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  // ─── Styles ───────────────────────────────────────────────────────

  const bubbleStyle: React.CSSProperties = {
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    width: '60px',
    height: '60px',
    borderRadius: '50%',
    backgroundColor: '#00b341',
    color: 'white',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 4px 12px rgba(0, 179, 65, 0.3)',
    zIndex: 9999,
    transition: 'all 0.3s ease',
    transform: chatOpen ? 'scale(0.9)' : 'scale(1)',
  };

  const panelStyle: React.CSSProperties = {
    position: 'fixed',
    bottom: '90px',
    right: '20px',
    width: '380px',
    height: '600px',
    backgroundColor: '#1a1a1a',
    borderRadius: '16px',
    boxShadow: '0 20px 40px rgba(0, 0, 0, 0.3)',
    zIndex: 9998,
    display: 'flex',
    flexDirection: 'column',
    transform: chatOpen ? 'scale(1) translateY(0)' : 'scale(0.8) translateY(20px)',
    opacity: chatOpen ? 1 : 0,
    transition: 'all 0.3s ease',
    pointerEvents: chatOpen ? 'auto' : 'none',
  };

  const headerStyle: React.CSSProperties = {
    padding: '16px 20px',
    borderBottom: '1px solid #333',
    backgroundColor: '#00b341',
    color: 'white',
    borderRadius: '16px 16px 0 0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  };

  const messagesStyle: React.CSSProperties = {
    flex: 1,
    padding: '16px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    scrollbarWidth: 'thin',
    scrollbarColor: '#333 transparent',
  };

  const inputContainerStyle: React.CSSProperties = {
    padding: '12px 16px 16px',
    borderTop: '1px solid #333',
    backgroundColor: '#2a2a2a',
    borderRadius: '0 0 16px 16px',
    position: 'relative',
  };

  const inputWrapperStyle: React.CSSProperties = {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  };

  const inputStyle: React.CSSProperties = {
    flex: 1,
    padding: '12px',
    backgroundColor: '#333',
    color: 'white',
    border: '1px solid #444',
    borderRadius: '8px',
    fontSize: '14px',
    outline: 'none',
  };

  const sendButtonStyle: React.CSSProperties = {
    padding: '12px',
    backgroundColor: '#00b341',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '44px',
    opacity: inputValue.trim() ? 1 : 0.5,
    transition: 'all 0.2s ease',
  };

  const suggestionsStyle: React.CSSProperties = {
    position: 'absolute',
    bottom: '100%',
    left: '0',
    right: '0',
    backgroundColor: '#333',
    borderRadius: '8px 8px 0 0',
    border: '1px solid #444',
    maxHeight: '200px',
    overflowY: 'auto',
    zIndex: 10,
  };

  const pillStyle: React.CSSProperties = {
    padding: '6px 14px',
    backgroundColor: '#2a2a2a',
    color: '#ccc',
    border: '1px solid #444',
    borderRadius: '20px',
    cursor: 'pointer',
    fontSize: '13px',
    whiteSpace: 'nowrap',
    transition: 'all 0.15s ease',
  };

  const chipStyle: React.CSSProperties = {
    padding: '4px 10px',
    backgroundColor: 'transparent',
    color: '#aaa',
    border: '1px solid #444',
    borderRadius: '14px',
    cursor: 'pointer',
    fontSize: '12px',
    whiteSpace: 'nowrap',
    transition: 'all 0.15s ease',
  };

  const navToastStyle: React.CSSProperties = {
    position: 'absolute',
    top: '60px',
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: '#0066cc',
    color: 'white',
    padding: '8px 16px',
    borderRadius: '8px',
    fontSize: '13px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    zIndex: 20,
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
    animation: 'fadeInOut 2.5s ease',
  };

  const showWelcome = chatMessages.length === 0;

  return (
    <div>
      {/* Chat Panel */}
      <div style={panelStyle}>
        {/* Header */}
        <div style={headerStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Bot size={20} />
            <span style={{ fontWeight: '600', fontSize: '15px' }}>ProductBridge Assistant</span>
          </div>
          <button
            onClick={toggleChat}
            style={{
              background: 'none',
              border: 'none',
              color: 'white',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: '4px',
              opacity: 0.8,
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Navigation toast */}
        {navToast && (
          <div style={navToastStyle}>
            <Navigation size={14} />
            {navToast}
          </div>
        )}

        {/* Messages */}
        <div style={messagesStyle}>
          {/* Welcome screen */}
          {showWelcome && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '8px 0' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '8px',
                }}
              >
                <div
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    backgroundColor: '#00b341',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    marginTop: '2px',
                  }}
                >
                  <Bot size={14} color="white" />
                </div>
                <div
                  style={{
                    padding: '12px 16px',
                    borderRadius: '16px 16px 16px 4px',
                    backgroundColor: '#333',
                    color: 'white',
                    fontSize: '14px',
                    lineHeight: '1.5',
                  }}
                >
                  <span style={{ fontWeight: '600' }}>Hey! I'm your listing assistant.</span>
                  <br />
                  <span style={{ opacity: 0.85 }}>Here's what I can do:</span>
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '8px',
                  paddingLeft: '36px',
                }}
              >
                {welcomeQuickActions.map((qa) => (
                  <button
                    key={qa.message}
                    onClick={() => handleQuickAction(qa.message)}
                    style={pillStyle}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = '#00b341';
                      e.currentTarget.style.borderColor = '#00b341';
                      e.currentTarget.style.color = 'white';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = '#2a2a2a';
                      e.currentTarget.style.borderColor = '#444';
                      e.currentTarget.style.color = '#ccc';
                    }}
                  >
                    {qa.label}
                    {qa.isNew && (
                      <span
                        style={{
                          marginLeft: '6px',
                          fontSize: '10px',
                          backgroundColor: '#ff6b00',
                          color: 'white',
                          padding: '1px 6px',
                          borderRadius: '8px',
                          fontWeight: 600,
                        }}
                      >
                        ✨ New
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {chatMessages.map((message) => (
            <div
              key={message.id}
              style={{
                display: 'flex',
                justifyContent: message.role === 'user' ? 'flex-end' : 'flex-start',
                alignItems: 'flex-start',
                gap: '8px',
              }}
            >
              {message.role === 'assistant' && (
                <div
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    backgroundColor: '#00b341',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    marginTop: '2px',
                  }}
                >
                  <Bot size={14} color="white" />
                </div>
              )}
              
              <div
                style={{
                  maxWidth: message.role === 'user' ? '280px' : '320px',
                  padding: '12px 16px',
                  borderRadius: message.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                  backgroundColor: message.role === 'user' ? '#0066cc' : '#333',
                  color: 'white',
                  fontSize: '14px',
                  lineHeight: '1.4',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {message.content}
                <div
                  style={{
                    fontSize: '11px',
                    opacity: 0.6,
                    marginTop: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <Clock size={10} />
                  {message.timestamp.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              </div>

              {message.role === 'user' && (
                <div
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    backgroundColor: '#0066cc',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    marginTop: '2px',
                  }}
                >
                  <User size={14} color="white" />
                </div>
              )}
            </div>
          ))}

          {chatLoading && (
            <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'flex-start', gap: '8px' }}>
              <div
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  backgroundColor: '#00b341',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Bot size={14} color="white" />
              </div>
              <div
                style={{
                  padding: '12px 16px',
                  borderRadius: '16px 16px 16px 4px',
                  backgroundColor: '#333',
                  color: 'white',
                  fontSize: '14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <Zap size={12} style={{ animation: 'pulse 1.5s infinite' }} />
                Processing...
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div style={inputContainerStyle}>
          {/* Contextual quick action chips */}
          {currentPageActions.length > 0 && !chatLoading && (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '6px',
                marginBottom: '10px',
              }}
            >
              {currentPageActions.map((qa) => (
                <button
                  key={qa.message}
                  onClick={() => handleQuickAction(qa.message)}
                  style={chipStyle}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#444';
                    e.currentTarget.style.color = 'white';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = '#aaa';
                  }}
                >
                  {qa.label}
                </button>
              ))}
            </div>
          )}

          {showSuggestions && (
            <div style={suggestionsStyle}>
              {filteredSuggestions.slice(0, 5).map((suggestion, index) => (
                <button
                  key={index}
                  onClick={() => handleSuggestionClick(suggestion)}
                  style={{
                    width: '100%',
                    padding: '10px 16px',
                    backgroundColor: 'transparent',
                    color: 'white',
                    border: 'none',
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontSize: '13px',
                    borderBottom: index < filteredSuggestions.length - 1 ? '1px solid #444' : 'none',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#444';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}
          
          <div style={inputWrapperStyle}>
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={handleInputChange}
              onKeyPress={handleKeyPress}
              placeholder="Type a command or ask a question..."
              style={inputStyle}
            />
            <button
              onClick={handleSendMessage}
              disabled={!inputValue.trim() || chatLoading}
              style={sendButtonStyle}
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Chat Bubble */}
      <button onClick={toggleChat} style={bubbleStyle}>
        <MessageCircle size={24} />
        {!chatOpen && (
          <div
            style={{
              position: 'absolute',
              top: '-2px',
              right: '-2px',
              width: '12px',
              height: '12px',
              backgroundColor: '#ff4757',
              borderRadius: '50%',
              fontSize: '8px',
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              animation: 'pulse 2s infinite',
            }}
          />
        )}
      </button>

      {/* Animations */}
      <style>
        {`
          @keyframes pulse {
            0% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.7; transform: scale(1.1); }
            100% { opacity: 1; transform: scale(1); }
          }
          @keyframes fadeInOut {
            0% { opacity: 0; transform: translateX(-50%) translateY(-8px); }
            15% { opacity: 1; transform: translateX(-50%) translateY(0); }
            85% { opacity: 1; transform: translateX(-50%) translateY(0); }
            100% { opacity: 0; transform: translateX(-50%) translateY(-8px); }
          }
        `}
      </style>
    </div>
  );
};

export default ChatWidget;
