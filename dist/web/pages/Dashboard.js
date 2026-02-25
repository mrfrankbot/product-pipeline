import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useMemo } from 'react';
import { Badge, Banner, BlockStack, Box, Button, Card, Divider, Icon, InlineGrid, InlineStack, Layout, Page, SkeletonBodyText, SkeletonDisplayText, Text, } from '@shopify/polaris';
import { ProductIcon, OrderIcon, SettingsIcon, ViewIcon, ImageIcon, ClipboardChecklistIcon, StatusActiveIcon, AlertCircleIcon, } from '@shopify/polaris-icons';
import { useNavigate } from 'react-router-dom';
import { useLogs, useStatus } from '../hooks/useApi';
import { useAppStore } from '../store';
/* ────────────────── Helpers ────────────────── */
const formatTimestamp = (value) => {
    if (!value)
        return '—';
    const ms = typeof value === 'number'
        ? value > 1_000_000_000_000
            ? value
            : value * 1000
        : Date.parse(value);
    if (Number.isNaN(ms))
        return '—';
    const d = new Date(ms);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    if (diffMs < 60_000)
        return 'Just now';
    if (diffMs < 3_600_000)
        return `${Math.floor(diffMs / 60_000)}m ago`;
    if (diffMs < 86_400_000)
        return `${Math.floor(diffMs / 3_600_000)}h ago`;
    return d.toLocaleDateString();
};
const formatUptime = (seconds) => {
    if (!seconds || seconds <= 0)
        return '—';
    if (seconds < 60)
        return `${Math.floor(seconds)}s`;
    if (seconds < 3600)
        return `${Math.floor(seconds / 60)}m`;
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
};
const StatCard = ({ label, value, icon, tone }) => (_jsx(Card, { children: _jsxs(BlockStack, { gap: "200", children: [_jsxs(InlineStack, { align: "space-between", blockAlign: "center", children: [_jsx(Box, { background: tone === 'success'
                            ? 'bg-fill-success-secondary'
                            : tone === 'critical'
                                ? 'bg-fill-critical-secondary'
                                : tone === 'warning'
                                    ? 'bg-fill-warning-secondary'
                                    : 'bg-fill-secondary', borderRadius: "200", padding: "200", children: _jsx(Icon, { source: icon, tone: tone ?? 'base' }) }), tone && _jsx(Badge, { tone: tone, children: tone })] }), _jsx(Text, { variant: "headingXl", as: "p", children: typeof value === 'number' ? value.toLocaleString() : value }), _jsx(Text, { variant: "bodySm", tone: "subdued", as: "p", children: label })] }) }));
const ActionCard = ({ title, description, icon, onClick, badge, badgeTone, cta }) => (_jsx(Card, { children: _jsxs(BlockStack, { gap: "200", children: [_jsxs(InlineStack, { gap: "200", blockAlign: "center", align: "space-between", children: [_jsxs(InlineStack, { gap: "200", blockAlign: "center", children: [_jsx(Box, { background: "bg-fill-secondary", borderRadius: "200", padding: "200", children: _jsx(Icon, { source: icon }) }), _jsx(Text, { variant: "headingSm", as: "h3", children: title })] }), badge && _jsx(Badge, { tone: badgeTone, children: badge })] }), _jsx(Text, { variant: "bodySm", tone: "subdued", as: "p", children: description }), _jsx(Button, { onClick: onClick, variant: "secondary", children: cta ?? 'Open' })] }) }));
/* ────────────────── Dashboard ────────────────── */
const Dashboard = () => {
    const { data: statusData, isLoading, error } = useStatus();
    const { data: logsData } = useLogs(10);
    const navigate = useNavigate();
    const { connections } = useAppStore();
    const activityRows = useMemo(() => {
        if (!logsData?.data)
            return [];
        return logsData.data.slice(0, 6).map((log) => ({
            id: String(log.id ?? Math.random()),
            topic: log.topic ?? log.message ?? 'Sync event',
            source: log.source ?? 'System',
            status: log.status ?? 'info',
            timestamp: formatTimestamp(log.createdAt ?? log.created_at),
        }));
    }, [logsData]);
    if (error) {
        return (_jsx(Page, { title: "ProductPipeline", children: _jsx(Banner, { tone: "critical", title: "Unable to connect", children: _jsx(Text, { as: "p", children: error.message }) }) }));
    }
    const productsMapped = statusData?.products?.mapped ?? 0;
    const ordersImported = statusData?.orders?.imported ?? 0;
    const inventorySynced = statusData?.inventory?.synced ?? 0;
    const revenueTotal = statusData?.revenue?.total ?? statusData?.revenue?.today ?? 0;
    return (_jsx(Page, { title: "ProductPipeline", subtitle: "Your listing pipeline at a glance", fullWidth: true, children: _jsxs(BlockStack, { gap: "500", children: [_jsx(Layout, { children: _jsx(Layout.Section, { children: _jsx(Card, { children: _jsxs(BlockStack, { gap: "400", children: [_jsxs(InlineStack, { align: "space-between", blockAlign: "center", children: [_jsxs(InlineStack, { gap: "300", blockAlign: "center", children: [_jsx(Box, { background: statusData?.status === 'running' ? 'bg-fill-success-secondary' : 'bg-fill-warning-secondary', borderRadius: "full", padding: "200", children: _jsx(Icon, { source: statusData?.status === 'running' ? StatusActiveIcon : AlertCircleIcon, tone: statusData?.status === 'running' ? 'success' : 'warning' }) }), _jsxs(BlockStack, { gap: "100", children: [_jsx(Text, { variant: "headingMd", as: "h2", children: statusData?.status === 'running' ? 'All systems operational' : 'Connecting…' }), _jsxs(Text, { variant: "bodySm", tone: "subdued", as: "p", children: ["Uptime ", formatUptime(statusData?.uptime)] })] })] }), _jsxs(InlineStack, { gap: "300", children: [_jsxs(InlineStack, { gap: "100", blockAlign: "center", children: [_jsx(Text, { variant: "bodySm", as: "span", children: "Shopify" }), _jsx(Badge, { tone: connections.shopify ? 'success' : 'critical', children: connections.shopify ? 'Connected' : 'Disconnected' })] }), _jsxs(InlineStack, { gap: "100", blockAlign: "center", children: [_jsx(Text, { variant: "bodySm", as: "span", children: "eBay" }), _jsx(Badge, { tone: connections.ebay ? 'success' : 'critical', children: connections.ebay ? 'Connected' : 'Disconnected' })] })] })] }), _jsx(Divider, {}), _jsx(InlineGrid, { columns: { xs: 2, sm: 2, md: 4 }, gap: "300", children: isLoading ? (_jsxs(_Fragment, { children: [_jsx(Card, { children: _jsxs(BlockStack, { gap: "200", children: [_jsx(SkeletonDisplayText, { size: "large" }), _jsx(SkeletonBodyText, { lines: 1 })] }) }), _jsx(Card, { children: _jsxs(BlockStack, { gap: "200", children: [_jsx(SkeletonDisplayText, { size: "large" }), _jsx(SkeletonBodyText, { lines: 1 })] }) }), _jsx(Card, { children: _jsxs(BlockStack, { gap: "200", children: [_jsx(SkeletonDisplayText, { size: "large" }), _jsx(SkeletonBodyText, { lines: 1 })] }) }), _jsx(Card, { children: _jsxs(BlockStack, { gap: "200", children: [_jsx(SkeletonDisplayText, { size: "large" }), _jsx(SkeletonBodyText, { lines: 1 })] }) })] })) : (_jsxs(_Fragment, { children: [_jsx(StatCard, { label: "Products Mapped", value: productsMapped, icon: ProductIcon, tone: productsMapped > 0 ? 'success' : undefined }), _jsx(StatCard, { label: "Orders Imported", value: ordersImported, icon: OrderIcon, tone: ordersImported > 0 ? 'success' : undefined }), _jsx(StatCard, { label: "Inventory Synced", value: inventorySynced, icon: ClipboardChecklistIcon }), _jsx(StatCard, { label: "Revenue", value: `$${revenueTotal.toLocaleString()}`, icon: ViewIcon })] })) })] }) }) }) }), _jsxs(Layout, { children: [_jsx(Layout.Section, { children: _jsxs(BlockStack, { gap: "200", children: [_jsx(Text, { variant: "headingMd", as: "h2", children: "Quick actions" }), _jsxs(InlineGrid, { columns: { xs: 1, sm: 2, md: 2 }, gap: "300", children: [_jsx(ActionCard, { title: "Browse Products", description: "View your Shopify catalog, run the AI pipeline, and manage listings", icon: ProductIcon, onClick: () => navigate('/listings'), badge: `${productsMapped} mapped`, badgeTone: "info", cta: "Open catalog" }), _jsx(ActionCard, { title: "eBay Listings", description: "Manage your active and draft eBay listings", icon: ViewIcon, onClick: () => navigate('/ebay/listings'), cta: "View listings" }), _jsx(ActionCard, { title: "Pipeline", description: "Monitor AI descriptions, image processing, and listing creation", icon: ImageIcon, onClick: () => navigate('/pipeline'), cta: "Open pipeline" }), _jsx(ActionCard, { title: "Settings", description: "Configure connections, prompts, and sync preferences", icon: SettingsIcon, onClick: () => navigate('/settings'), cta: "Open settings" })] })] }) }), _jsx(Layout.Section, { children: _jsx(Card, { children: _jsxs(BlockStack, { gap: "300", children: [_jsxs(InlineStack, { align: "space-between", blockAlign: "center", children: [_jsx(Text, { variant: "headingMd", as: "h2", children: "Recent activity" }), _jsx(Button, { variant: "plain", onClick: () => navigate('/logs'), children: "View all" })] }), _jsx(Divider, {}), activityRows.length === 0 ? (_jsxs(BlockStack, { gap: "200", inlineAlign: "center", children: [_jsx(Text, { tone: "subdued", as: "p", children: "No sync activity yet" }), _jsx(Button, { onClick: () => navigate('/listings'), children: "List your first product" })] })) : (_jsx(BlockStack, { gap: "300", children: activityRows.map((row) => (_jsxs(InlineStack, { align: "space-between", blockAlign: "start", children: [_jsxs(BlockStack, { gap: "050", children: [_jsx(Text, { variant: "bodyMd", as: "p", fontWeight: "medium", children: row.topic }), _jsx(Text, { variant: "bodySm", tone: "subdued", as: "p", children: row.source })] }), _jsxs(InlineStack, { gap: "200", blockAlign: "center", children: [_jsx(Badge, { tone: row.status === 'error'
                                                                    ? 'critical'
                                                                    : row.status === 'warning'
                                                                        ? 'warning'
                                                                        : row.status === 'success'
                                                                            ? 'success'
                                                                            : 'info', children: row.status }), _jsx(Text, { variant: "bodySm", tone: "subdued", as: "p", children: row.timestamp })] })] }, row.id))) }))] }) }) })] })] }) }));
};
export default Dashboard;
