import React from 'react';
import { AppProvider, Frame, Navigation, TopBar } from '@shopify/polaris';
import enTranslations from '@shopify/polaris/locales/en.json';
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { 
  Home, 
  Package, 
  ShoppingCart, 
  Settings as SettingsIcon, 
  FileText, 
  GitBranch,
  Menu
} from 'lucide-react';
import Dashboard from './pages/Dashboard';
import Listings from './pages/Listings';
import Orders from './pages/Orders';
import Settings from './pages/Settings';
import Analytics from './pages/Analytics';
import Mappings from './pages/Mappings';
import ChatWidget from './components/ChatWidget';
import { useAppStore } from './store';

// Create React Query client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000, // 30 seconds
      refetchOnWindowFocus: false,
    },
  },
});

const AppFrame: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { sidebarOpen, toggleSidebar } = useAppStore();

  // Enhanced badge counts with error indicators
  const getBadgeCount = (path: string) => {
    switch (path) {
      case '/listings':
        return 3; // Unmapped products
      case '/orders':
        return 2; // Pending orders
      case '/mappings':
        return undefined; // No badge for mappings normally
      case '/logs':
        return 5; // Recent errors/warnings
      case '/settings':
        return 1; // Auth issues
      default:
        return undefined;
    }
  };

  const getErrorIndicator = (path: string) => {
    // Show warning/error indicators for pages with issues
    switch (path) {
      case '/logs':
        return 'error'; // Recent errors detected
      case '/settings':
        return 'warning'; // Auth issues
      default:
        return undefined;
    }
  };

  const navigationItems = [
    {
      label: 'Dashboard',
      url: '/',
      icon: <Home className="nav-icon" />,
      selected: location.pathname === '/',
      onClick: () => navigate('/'),
    },
    {
      label: 'Products',
      url: '/listings',
      icon: <Package className="nav-icon" />,
      selected: location.pathname === '/listings',
      onClick: () => navigate('/listings'),
      badge: getBadgeCount('/listings'),
    },
    {
      label: 'Orders',
      url: '/orders',
      icon: <ShoppingCart className="nav-icon" />,
      selected: location.pathname === '/orders',
      onClick: () => navigate('/orders'),
      badge: getBadgeCount('/orders'),
    },
    {
      label: 'Mappings',
      url: '/mappings',
      icon: <GitBranch className="nav-icon" />,
      selected: location.pathname === '/mappings',
      onClick: () => navigate('/mappings'),
    },
    {
      label: 'Analytics',
      url: '/logs',
      icon: <FileText className="nav-icon" />,
      selected: location.pathname === '/logs',
      onClick: () => navigate('/logs'),
      badge: getBadgeCount('/logs'),
    },
    {
      label: 'Settings',
      url: '/settings',
      icon: <SettingsIcon className="nav-icon" />,
      selected: location.pathname === '/settings',
      onClick: () => navigate('/settings'),
      badge: getBadgeCount('/settings'),
    },
  ];

  const navigationMarkup = (
    <Navigation location={location.pathname}>
      <Navigation.Section
        items={navigationItems.map(item => {
          const errorIndicator = getErrorIndicator(item.url);
          return {
            ...item,
            icon: undefined, // Remove icon from Polaris navigation (we'll add custom styling)
            badge: item.badge ? String(item.badge) : undefined,
            // Add visual error indicators via suffix or prefix
            suffix: errorIndicator ? (
              <span 
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: errorIndicator === 'error' ? '#d72c0d' : '#ffd60a',
                  display: 'inline-block',
                  marginLeft: '4px'
                }}
                title={errorIndicator === 'error' ? 'Errors detected' : 'Warnings detected'}
              />
            ) : undefined,
          };
        })}
      />
    </Navigation>
  );

  const topBarMarkup = (
    <TopBar
      showNavigationToggle
      onNavigationToggle={toggleSidebar}
      searchField={undefined}
      searchResults={undefined}
      searchResultsVisible={false}
      onSearchResultsDismiss={() => {}}
    />
  );

  return (
    <Frame 
      navigation={navigationMarkup} 
      topBar={topBarMarkup}
      showMobileNavigation={!sidebarOpen}
      onNavigationDismiss={toggleSidebar}
    >
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/listings" element={<Listings />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/mappings" element={<Mappings />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/logs" element={<Analytics />} />
      </Routes>
      
      <ChatWidget />
    </Frame>
  );
};

const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppProvider i18n={enTranslations}>
          <AppFrame />
        </AppProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
};

export default App;
