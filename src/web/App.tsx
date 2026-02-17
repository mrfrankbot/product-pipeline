import React from 'react';
import { AppProvider, Frame, TopBar } from '@shopify/polaris';
import enTranslations from '@shopify/polaris/locales/en.json';
import { BrowserRouter, Route, Routes, useLocation, Link } from 'react-router-dom';
import { NavMenu } from '@shopify/app-bridge-react';
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
import CategoryMapping from './pages/CategoryMapping';
import Help from './pages/Help';
import HelpCenter from './pages/HelpCenter';
import HelpArticlePage from './pages/HelpArticle';
import HelpCategoryPage from './pages/HelpCategory';
import HelpAsk from './pages/HelpAsk';
import HelpAdmin from './pages/HelpAdmin';
import FeatureRequests from './pages/FeatureRequests';
import FeatureAdmin from './pages/FeatureAdmin';
import AppNavigation from './components/AppNavigation';
import ChatWidget from './components/ChatWidget';
import ReviewQueue from './pages/ReviewQueue';
import ReviewDetail from './pages/ReviewDetail';
import EbayOrders from './pages/EbayOrders';
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

/** Detect whether the app is embedded inside Shopify Admin */
const isEmbedded = (): boolean => {
  try {
    return window.self !== window.top;
  } catch {
    return true; // cross-origin iframe = embedded
  }
};

/**
 * Shopify App Bridge NavMenu — renders navigation items in Shopify's sidebar.
 * Only rendered when embedded in Shopify Admin.
 */
const ShopifyNavMenu: React.FC = () => (
  <NavMenu>
    <Link to="/" rel="home">Dashboard</Link>
    <Link to="/listings">Products</Link>
    <Link to="/ebay/listings">eBay Listings</Link>
    <Link to="/orders">Orders</Link>
    <Link to="/ebay-orders">eBay Orders</Link>
    <Link to="/mappings">Mappings</Link>
    <Link to="/pipeline">Pipeline</Link>
    <Link to="/review">Review Queue</Link>
    <Link to="/images">Images</Link>
    <Link to="/category-mapping">Category Mapping</Link>
    <Link to="/logs">Analytics</Link>
    <Link to="/settings">Settings</Link>
    <Link to="/help">Help</Link>
    <Link to="/features">Feature Requests</Link>
  </NavMenu>
);

class ErrorBoundary extends React.Component<{children: React.ReactNode}, {error: Error | null}> {
  constructor(props: {children: React.ReactNode}) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error('REACT ERROR BOUNDARY:', error.message, error.stack); }
  render() {
    if (this.state.error) {
      return React.createElement('div', {style: {padding: '2rem', color: 'red', fontFamily: 'monospace'}},
        React.createElement('h2', null, 'React Render Error'),
        React.createElement('pre', {style: {whiteSpace: 'pre-wrap'}}, this.state.error.message),
        React.createElement('pre', {style: {fontSize: '11px', whiteSpace: 'pre-wrap'}}, this.state.error.stack)
      );
    }
    return this.props.children;
  }
}

const AppFrame: React.FC = () => {
  const location = useLocation();
  const { sidebarOpen, toggleSidebar } = useAppStore();
  const embedded = isEmbedded();

  // When embedded in Shopify, don't render the Polaris sidebar or top bar —
  // Shopify Admin provides its own chrome via App Bridge NavMenu.
  const topBarMarkup = embedded ? undefined : (
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
    <>
      {embedded && <ShopifyNavMenu />}
      <Frame
        navigation={embedded ? undefined : <AppNavigation />}
        topBar={topBarMarkup}
        showMobileNavigation={embedded ? false : !sidebarOpen}
        onNavigationDismiss={toggleSidebar}
      >
        <ErrorBoundary>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/listings" element={<ShopifyProducts />} />
          <Route path="/listings/:id" element={<ShopifyProductDetail />} />
          <Route path="/ebay/listings" element={<Listings />} />
          <Route path="/ebay/listings/:id" element={<ListingDetail />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/ebay-orders" element={<EbayOrders />} />
          <Route path="/mappings" element={<Mappings />} />
          <Route path="/pipeline" element={<Pipeline />} />
          <Route path="/review" element={<ReviewQueue />} />
          <Route path="/review/:id" element={<ReviewDetail />} />
          <Route path="/images" element={<ImageProcessor />} />
          <Route path="/category-mapping" element={<CategoryMapping />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/logs" element={<Analytics />} />
          <Route path="/help" element={<HelpCenter />}>
            <Route path="article/:id" element={<HelpArticlePage />} />
            <Route path="category/:category" element={<HelpCategoryPage />} />
            <Route path="ask" element={<HelpAsk />} />
          </Route>
          <Route path="/help/admin" element={<HelpAdmin />} />
          <Route path="/features" element={<FeatureRequests />} />
          <Route path="/features/admin" element={<FeatureAdmin />} />
        </Routes>
        </ErrorBoundary>

        <ChatWidget />
      </Frame>
    </>
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
