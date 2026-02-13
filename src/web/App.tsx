import React from 'react';
import { AppProvider, Frame, TopBar } from '@shopify/polaris';
import enTranslations from '@shopify/polaris/locales/en.json';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Dashboard from './pages/Dashboard';
import Listings, { ListingDetail } from './pages/Listings';
import ShopifyProducts, { ShopifyProductDetail } from './pages/ShopifyProducts';
import Orders from './pages/Orders';
import Settings from './pages/Settings';
import Analytics from './pages/Analytics';
import Mappings from './pages/Mappings';
import ImageProcessor from './pages/ImageProcessor';
import Pipeline from './pages/Pipeline';
import Help from './pages/Help';
import HelpAdmin from './pages/HelpAdmin';
import FeatureRequests from './pages/FeatureRequests';
import FeatureAdmin from './pages/FeatureAdmin';
import AppNavigation from './components/AppNavigation';
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
  const { sidebarOpen, toggleSidebar } = useAppStore();

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
      navigation={<AppNavigation />}
      topBar={topBarMarkup}
      showMobileNavigation={!sidebarOpen}
      onNavigationDismiss={toggleSidebar}
    >
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/listings" element={<ShopifyProducts />} />
        <Route path="/listings/:id" element={<ShopifyProductDetail />} />
        <Route path="/ebay/listings" element={<Listings />} />
        <Route path="/ebay/listings/:id" element={<ListingDetail />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/mappings" element={<Mappings />} />
        <Route path="/pipeline" element={<Pipeline />} />
        <Route path="/images" element={<ImageProcessor />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/logs" element={<Analytics />} />
        <Route path="/help" element={<Help />} />
        <Route path="/help/admin" element={<HelpAdmin />} />
        <Route path="/features" element={<FeatureRequests />} />
        <Route path="/features/admin" element={<FeatureAdmin />} />
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
