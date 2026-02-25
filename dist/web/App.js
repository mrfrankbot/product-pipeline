import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React, { Suspense } from 'react';
import { AppProvider, Frame, TopBar, Spinner } from '@shopify/polaris';
import enTranslations from '@shopify/polaris/locales/en.json';
import { BrowserRouter, Route, Routes, useLocation, Link } from 'react-router-dom';
import { NavMenu } from '@shopify/app-bridge-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
// Main app shell components — always in the main chunk
import Dashboard from './pages/Dashboard';
import AppNavigation from './components/AppNavigation';
import ChatWidget from './components/ChatWidget';
import PipelineToasts from './components/PipelineToasts';
import { useAppStore } from './store';
// Lazy-loaded route pages — split into separate chunks
const Listings = React.lazy(() => import('./pages/Listings'));
const ShopifyProducts = React.lazy(() => import('./pages/ShopifyProducts'));
const Orders = React.lazy(() => import('./pages/Orders'));
const Settings = React.lazy(() => import('./pages/Settings'));
const Analytics = React.lazy(() => import('./pages/Analytics'));
const Mappings = React.lazy(() => import('./pages/Mappings'));
const ImageProcessor = React.lazy(() => import('./pages/ImageProcessor'));
const Pipeline = React.lazy(() => import('./pages/Pipeline'));
const CategoryMapping = React.lazy(() => import('./pages/CategoryMapping'));
const HelpCenter = React.lazy(() => import('./pages/HelpCenter'));
const HelpArticlePage = React.lazy(() => import('./pages/HelpArticle'));
const HelpCategoryPage = React.lazy(() => import('./pages/HelpCategory'));
const HelpAsk = React.lazy(() => import('./pages/HelpAsk'));
const HelpAdmin = React.lazy(() => import('./pages/HelpAdmin'));
const FeatureRequests = React.lazy(() => import('./pages/FeatureRequests'));
const FeatureAdmin = React.lazy(() => import('./pages/FeatureAdmin'));
const ReviewQueue = React.lazy(() => import('./pages/ReviewQueue'));
const ReviewDetail = React.lazy(() => import('./pages/ReviewDetail'));
// EbayListingPrep is the largest page — always lazy-load it
const EbayListingPrep = React.lazy(() => import('./pages/EbayListingPrep'));
const EbayOrders = React.lazy(() => import('./pages/EbayOrders'));
// Lazy wrappers that re-export named exports as default
const ListingDetail = React.lazy(() => import('./pages/Listings').then((m) => ({ default: m.ListingDetail })));
const ShopifyProductDetail = React.lazy(() => import('./pages/ShopifyProducts').then((m) => ({ default: m.ShopifyProductDetail })));
// Create React Query client
const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 30000, // 30 seconds
            refetchOnWindowFocus: false,
        },
    },
});
/** Check if TEST_MODE is active (set by backend, cached on first call) */
let testModeCache = null;
const checkTestMode = async () => {
    if (testModeCache !== null)
        return testModeCache;
    try {
        const res = await fetch('/api/test-mode');
        const data = await res.json();
        testModeCache = data.testMode === true;
    }
    catch {
        testModeCache = false;
    }
    return testModeCache;
};
// Eagerly check on load (result cached for sync access)
checkTestMode();
/** Detect whether the app is embedded inside Shopify Admin */
const isEmbedded = () => {
    // In TEST_MODE, never treat as embedded — skip App Bridge
    if (testModeCache)
        return false;
    try {
        return window.self !== window.top;
    }
    catch {
        return true; // cross-origin iframe = embedded
    }
};
/** Full-page loading fallback shown while lazy chunks download */
const PageLoader = () => (_jsx("div", { style: { display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }, children: _jsx(Spinner, { size: "large" }) }));
/**
 * Shopify App Bridge NavMenu — renders navigation items in Shopify's sidebar.
 * Only rendered when embedded in Shopify Admin.
 */
const ShopifyNavMenu = () => (_jsxs(NavMenu, { children: [_jsx(Link, { to: "/", rel: "home", children: "Dashboard" }), _jsx(Link, { to: "/listings", children: "Products" }), _jsx(Link, { to: "/ebay/listings", children: "eBay Listings" }), _jsx(Link, { to: "/orders", children: "Orders" }), _jsx(Link, { to: "/ebay-orders", children: "eBay Orders" }), _jsx(Link, { to: "/mappings", children: "Mappings" }), _jsx(Link, { to: "/pipeline", children: "Pipeline" }), _jsx(Link, { to: "/review", children: "Review Queue" }), _jsx(Link, { to: "/images", children: "Images" }), _jsx(Link, { to: "/category-mapping", children: "Category Mapping" }), _jsx(Link, { to: "/logs", children: "Analytics" }), _jsx(Link, { to: "/settings", children: "Settings" }), _jsx(Link, { to: "/help", children: "Help" }), _jsx(Link, { to: "/features", children: "Feature Requests" })] }));
class ErrorBoundary extends React.Component {
    constructor(props) { super(props); this.state = { error: null }; }
    static getDerivedStateFromError(error) { return { error }; }
    componentDidCatch(error) { console.error('REACT ERROR BOUNDARY:', error.message, error.stack); }
    render() {
        if (this.state.error) {
            return React.createElement('div', { style: { padding: '2rem', color: 'red', fontFamily: 'monospace' } }, React.createElement('h2', null, 'React Render Error'), React.createElement('pre', { style: { whiteSpace: 'pre-wrap' } }, this.state.error.message), React.createElement('pre', { style: { fontSize: '11px', whiteSpace: 'pre-wrap' } }, this.state.error.stack));
        }
        return this.props.children;
    }
}
const AppFrame = () => {
    const location = useLocation();
    const { sidebarOpen, toggleSidebar } = useAppStore();
    const embedded = isEmbedded();
    // When embedded in Shopify, don't render the Polaris sidebar or top bar —
    // Shopify Admin provides its own chrome via App Bridge NavMenu.
    const topBarMarkup = embedded ? undefined : (_jsx(TopBar, { showNavigationToggle: true, onNavigationToggle: toggleSidebar, searchField: undefined, searchResults: undefined, searchResultsVisible: false, onSearchResultsDismiss: () => { } }));
    return (_jsxs(_Fragment, { children: [embedded && _jsx(ShopifyNavMenu, {}), _jsxs(Frame, { navigation: embedded ? undefined : _jsx(AppNavigation, {}), topBar: topBarMarkup, showMobileNavigation: embedded ? false : !sidebarOpen, onNavigationDismiss: toggleSidebar, children: [_jsx(ErrorBoundary, { children: _jsx(Suspense, { fallback: _jsx(PageLoader, {}), children: _jsxs(Routes, { children: [_jsx(Route, { path: "/", element: _jsx(Dashboard, {}) }), _jsx(Route, { path: "/listings", element: _jsx(ShopifyProducts, {}) }), _jsx(Route, { path: "/listings/:id", element: _jsx(ShopifyProductDetail, {}) }), _jsx(Route, { path: "/ebay/listings", element: _jsx(Listings, {}) }), _jsx(Route, { path: "/ebay/listings/:id", element: _jsx(ListingDetail, {}) }), _jsx(Route, { path: "/orders", element: _jsx(Orders, {}) }), _jsx(Route, { path: "/ebay-orders", element: _jsx(EbayOrders, {}) }), _jsx(Route, { path: "/mappings", element: _jsx(Mappings, {}) }), _jsx(Route, { path: "/pipeline", element: _jsx(Pipeline, {}) }), _jsx(Route, { path: "/review", element: _jsx(ReviewQueue, {}) }), _jsx(Route, { path: "/review/:id", element: _jsx(ReviewDetail, {}) }), _jsx(Route, { path: "/review/:id/ebay-prep", element: _jsx(EbayListingPrep, {}) }), _jsx(Route, { path: "/images", element: _jsx(ImageProcessor, {}) }), _jsx(Route, { path: "/category-mapping", element: _jsx(CategoryMapping, {}) }), _jsx(Route, { path: "/settings", element: _jsx(Settings, {}) }), _jsx(Route, { path: "/logs", element: _jsx(Analytics, {}) }), _jsxs(Route, { path: "/help", element: _jsx(HelpCenter, {}), children: [_jsx(Route, { path: "article/:id", element: _jsx(HelpArticlePage, {}) }), _jsx(Route, { path: "category/:category", element: _jsx(HelpCategoryPage, {}) }), _jsx(Route, { path: "ask", element: _jsx(HelpAsk, {}) })] }), _jsx(Route, { path: "/help/admin", element: _jsx(HelpAdmin, {}) }), _jsx(Route, { path: "/features", element: _jsx(FeatureRequests, {}) }), _jsx(Route, { path: "/features/admin", element: _jsx(FeatureAdmin, {}) })] }) }) }), _jsx(ChatWidget, {}), _jsx(PipelineToasts, {})] })] }));
};
const App = () => {
    return (_jsx(QueryClientProvider, { client: queryClient, children: _jsx(BrowserRouter, { children: _jsx(AppProvider, { i18n: enTranslations, children: _jsx(AppFrame, {}) }) }) }));
};
export default App;
