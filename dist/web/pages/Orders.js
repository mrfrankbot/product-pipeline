import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from 'react';
import { Badge, Banner, BlockStack, Box, Button, Card, Divider, Icon, IndexTable, InlineStack, Page, Pagination, Select, Spinner, Text, TextField, } from '@shopify/polaris';
import { SearchIcon, OrderIcon } from '@shopify/polaris-icons';
import { useOrders } from '../hooks/useApi';
const STATUS_OPTIONS = [
    { label: 'All statuses', value: '' },
    { label: 'Synced', value: 'synced' },
    { label: 'Fulfilled', value: 'fulfilled' },
];
const formatCurrency = (amount) => {
    if (amount === undefined || amount === null)
        return '—';
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
    }).format(amount);
};
const formatTimestamp = (value) => {
    if (!value)
        return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
};
const Orders = () => {
    const [searchValue, setSearchValue] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [pageOffset, setPageOffset] = useState(0);
    const { data, isLoading, error } = useOrders({
        limit: 25,
        offset: pageOffset,
        search: searchValue || undefined,
        status: statusFilter || undefined,
    });
    const orders = useMemo(() => data?.data ?? [], [data]);
    const total = data?.total ?? 0;
    const hasPrevious = pageOffset > 0;
    const hasNext = pageOffset + 25 < total;
    return (_jsx(Page, { title: "Orders", subtitle: "Imported orders from eBay", fullWidth: true, children: _jsxs(BlockStack, { gap: "500", children: [_jsx(Card, { children: _jsx(InlineStack, { align: "space-between", blockAlign: "center", children: _jsxs(InlineStack, { gap: "300", blockAlign: "center", children: [_jsx(Box, { background: "bg-fill-secondary", borderRadius: "200", padding: "200", children: _jsx(Icon, { source: OrderIcon }) }), _jsxs(BlockStack, { gap: "050", children: [_jsx(Text, { variant: "headingSm", as: "h2", children: "Order Management" }), _jsxs(Text, { variant: "bodySm", tone: "subdued", as: "p", children: [total, " total orders"] })] })] }) }) }), _jsx(Card, { children: _jsxs(BlockStack, { gap: "300", children: [_jsxs(InlineStack, { gap: "300", align: "space-between", children: [_jsx(TextField, { label: "", value: searchValue, onChange: (value) => {
                                            setSearchValue(value);
                                            setPageOffset(0);
                                        }, placeholder: "Search by eBay order ID or Shopify order ID", prefix: _jsx(Icon, { source: SearchIcon }), autoComplete: "off", clearButton: true, onClearButtonClick: () => setSearchValue('') }), _jsx(Box, { minWidth: "200px", children: _jsx(Select, { label: "Status", labelHidden: true, options: STATUS_OPTIONS, value: statusFilter, onChange: (value) => {
                                                setStatusFilter(value);
                                                setPageOffset(0);
                                            } }) })] }), _jsx(Divider, {}), error && (_jsx(Banner, { tone: "critical", title: "Unable to load orders", children: _jsx(Text, { as: "p", children: error.message }) })), isLoading ? (_jsx(Box, { padding: "400", children: _jsx(InlineStack, { align: "center", children: _jsx(Spinner, { accessibilityLabel: "Loading orders", size: "large" }) }) })) : orders.length === 0 ? (_jsx(Box, { padding: "400", children: _jsxs(BlockStack, { gap: "300", inlineAlign: "center", children: [_jsx(Icon, { source: OrderIcon, tone: "subdued" }), _jsxs(BlockStack, { gap: "200", inlineAlign: "center", children: [_jsx(Text, { variant: "headingSm", as: "h3", children: "No orders found" }), _jsx(Text, { tone: "subdued", as: "p", children: searchValue || statusFilter
                                                        ? 'Try adjusting your search or filters'
                                                        : 'Orders will appear here once imported from eBay' })] }), searchValue || statusFilter ? (_jsx(Button, { onClick: () => {
                                                setSearchValue('');
                                                setStatusFilter('');
                                                setPageOffset(0);
                                            }, children: "Clear filters" })) : null] }) })) : (_jsx(IndexTable, { resourceName: { singular: 'order', plural: 'orders' }, itemCount: orders.length, selectable: false, headings: [
                                    { title: 'eBay order' },
                                    { title: 'Shopify order' },
                                    { title: 'Status' },
                                    { title: 'Total' },
                                    { title: 'Date' },
                                ], children: orders.map((order, index) => (_jsxs(IndexTable.Row, { id: String(order.id ?? index), position: index, children: [_jsx(IndexTable.Cell, { children: _jsx(Text, { variant: "bodyMd", fontWeight: "semibold", as: "span", children: order.ebay_order_id ?? order.ebayOrderId ?? '—' }) }), _jsx(IndexTable.Cell, { children: _jsx(Text, { variant: "bodyMd", as: "span", children: order.shopify_order_id ?? order.shopifyOrderId ?? '—' }) }), _jsx(IndexTable.Cell, { children: _jsx(Badge, { tone: order.status === 'fulfilled'
                                                    ? 'success'
                                                    : order.status === 'synced'
                                                        ? 'info'
                                                        : order.status === 'failed'
                                                            ? 'critical'
                                                            : 'info', children: order.status ?? 'unknown' }) }), _jsx(IndexTable.Cell, { children: _jsx(Text, { variant: "bodyMd", as: "span", children: formatCurrency(order.total) }) }), _jsx(IndexTable.Cell, { children: _jsx(Text, { variant: "bodySm", tone: "subdued", as: "span", children: formatTimestamp(order.ebay_created_at ?? order.created_at ?? order.createdAt) }) })] }, order.id ?? index))) }))] }) }), !isLoading && orders.length > 0 && (_jsx(InlineStack, { align: "center", children: _jsx(Pagination, { hasPrevious: hasPrevious, onPrevious: () => setPageOffset(Math.max(0, pageOffset - 25)), hasNext: hasNext, onNext: () => setPageOffset(pageOffset + 25) }) }))] }) }));
};
export default Orders;
