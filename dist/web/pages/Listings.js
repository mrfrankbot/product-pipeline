import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Banner, Box, Button, ButtonGroup, Card, Divider, IndexTable, InlineStack, InlineGrid, BlockStack, Layout, Page, Pagination, Text, TextField, Thumbnail, Spinner, Icon, } from '@shopify/polaris';
import { ExternalIcon, RefreshIcon, SearchIcon, XCircleIcon, ProductIcon, StatusActiveIcon, AlertCircleIcon, ClockIcon, ViewIcon, } from '@shopify/polaris-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { apiClient, useListings, useMappings, useProductOverrides, useSaveProductOverrides, useSyncProducts } from '../hooks/useApi';
import { useAppStore } from '../store';
/* ────────────────── Helpers ────────────────── */
const formatMoney = (value) => {
    if (value === null || value === undefined)
        return '—';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
};
const formatTimestamp = (value) => {
    if (!value)
        return '—';
    const ms = typeof value === 'number' ? (value > 1e12 ? value : value * 1000) : Date.parse(value);
    if (Number.isNaN(ms))
        return '—';
    const d = new Date(ms);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60_000)
        return 'Just now';
    if (diff < 3_600_000)
        return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000)
        return `${Math.floor(diff / 3_600_000)}h ago`;
    return d.toLocaleDateString();
};
const formatTimestampFull = (value) => {
    if (!value)
        return '—';
    const ms = typeof value === 'number' ? (value > 1e12 ? value : value * 1000) : Date.parse(value);
    if (Number.isNaN(ms))
        return '—';
    return new Date(ms).toLocaleString();
};
const normalizeListing = (listing) => {
    const shopifyProductId = listing.shopifyProductId ?? listing.shopify_product_id ?? String(listing.shopifyProductID ?? listing.id ?? '');
    return {
        id: String(listing.id ?? shopifyProductId),
        shopifyProductId: String(shopifyProductId),
        ebayListingId: listing.ebayListingId ?? listing.ebay_listing_id ?? listing.ebayItemId ?? null,
        ebayInventoryItemId: listing.ebayInventoryItemId ?? listing.ebay_inventory_item_id ?? null,
        status: listing.status ?? 'inactive',
        originalPrice: listing.originalPrice ?? listing.original_price ?? listing.shopifyPrice ?? listing.shopify_price ?? listing.price ?? null,
        lastRepublishedAt: listing.lastRepublishedAt ?? listing.last_republished_at ?? null,
        promotedAt: listing.promotedAt ?? listing.promoted_at ?? null,
        adRate: listing.adRate ?? listing.ad_rate ?? null,
        createdAt: listing.createdAt ?? listing.created_at ?? null,
        updatedAt: listing.updatedAt ?? listing.updated_at ?? null,
        shopifyTitle: listing.shopifyTitle ?? listing.shopify_title,
        shopifySku: listing.shopifySku ?? listing.shopify_sku,
    };
};
const isDraftListing = (ebayListingId) => Boolean(ebayListingId && ebayListingId.startsWith('draft-'));
const getStatusPresentation = (listing) => {
    if (!listing.ebayListingId) {
        return { label: 'Missing', tone: 'critical' };
    }
    if (isDraftListing(listing.ebayListingId)) {
        return { label: 'Draft', tone: 'info' };
    }
    const normalized = listing.status.toLowerCase();
    if (normalized === 'active' || normalized === 'synced')
        return { label: 'Active', tone: 'success' };
    if (normalized === 'error' || normalized === 'failed')
        return { label: 'Error', tone: 'warning' };
    if (normalized === 'inactive')
        return { label: 'Inactive', tone: 'info' };
    if (normalized === 'pending')
        return { label: 'Pending', tone: 'attention' };
    return { label: listing.status || 'Unknown', tone: 'info' };
};
/* ────────────────── Stat Pill ────────────────── */
const StatPill = ({ label, value, icon, tone }) => (_jsx(Card, { children: _jsxs(InlineStack, { gap: "300", blockAlign: "center", children: [_jsx(Box, { background: tone === 'success' ? 'bg-fill-success-secondary'
                    : tone === 'critical' ? 'bg-fill-critical-secondary'
                        : tone === 'warning' ? 'bg-fill-warning-secondary'
                            : 'bg-fill-secondary', borderRadius: "200", padding: "200", children: _jsx(Icon, { source: icon, tone: tone ?? 'base' }) }), _jsxs(BlockStack, { gap: "050", children: [_jsx(Text, { variant: "headingMd", as: "p", children: value }), _jsx(Text, { variant: "bodySm", tone: "subdued", as: "p", children: label })] })] }) }));
/* ────────────────── Listing Detail ────────────────── */
const ListingDetail = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { addNotification } = useAppStore();
    const { data: listingResponse, isLoading: listingLoading, error: listingError } = useListings({
        limit: 50,
        offset: 0,
        search: id,
    });
    const listing = useMemo(() => {
        const normalized = (listingResponse?.data ?? []).map(normalizeListing);
        return normalized.find((item) => item.shopifyProductId === id || item.id === id) ?? normalized[0] ?? null;
    }, [listingResponse, id]);
    const { data: productInfo, isLoading: productLoading } = useQuery({
        queryKey: ['product-info', id],
        queryFn: () => apiClient.get(`/test/product-info/${id}`),
        enabled: Boolean(id),
    });
    const sku = productInfo?.product?.variant?.sku ?? listing?.shopifySku;
    const { data: ebayOffer, isLoading: ebayLoading } = useQuery({
        queryKey: ['ebay-offer', sku],
        queryFn: () => apiClient.get(`/test/ebay-offer/${sku}`),
        enabled: Boolean(sku),
    });
    const { data: mappings } = useMappings();
    const { data: overridesResponse } = useProductOverrides(id);
    const saveOverrides = useSaveProductOverrides();
    const [overrideValues, setOverrideValues] = useState({});
    const [overridesDirty, setOverridesDirty] = useState(false);
    const [overrideSaved, setOverrideSaved] = useState(false);
    const resolveShopifyField = useCallback((fieldPath, prod) => {
        if (!prod || !fieldPath)
            return '';
        if (fieldPath.includes('[0].')) {
            const [base, nested] = fieldPath.split('[0].');
            return String(prod[base]?.[0]?.[nested] ?? '');
        }
        return String(prod[fieldPath] ?? '');
    }, []);
    const resolvedFields = useMemo(() => {
        if (!mappings)
            return {};
        const grouped = {};
        const categories = ['sales', 'listing', 'shipping', 'payment'];
        const m = mappings;
        const prod = productInfo?.product;
        for (const cat of categories) {
            const fields = (m[cat] ?? [])
                .filter((item) => item.is_enabled !== false)
                .map((item) => {
                let resolved = '';
                switch (item.mapping_type) {
                    case 'shopify_field':
                        resolved = resolveShopifyField(item.source_value || '', prod);
                        break;
                    case 'constant':
                        resolved = item.target_value || '';
                        break;
                    case 'formula':
                        resolved = item.source_value || '';
                        break;
                    default:
                        resolved = '';
                        break;
                }
                return { field_name: item.field_name, mapping_type: item.mapping_type, resolved, display_order: item.display_order };
            })
                .sort((a, b) => a.display_order - b.display_order);
            if (fields.length > 0)
                grouped[cat] = fields;
        }
        return grouped;
    }, [mappings, productInfo, resolveShopifyField]);
    useEffect(() => {
        const vals = {};
        for (const [cat, fields] of Object.entries(resolvedFields)) {
            for (const f of fields)
                vals[`${cat}::${f.field_name}`] = f.resolved;
        }
        if (overridesResponse?.data) {
            for (const o of overridesResponse.data) {
                if (o.value)
                    vals[`${o.category}::${o.field_name}`] = o.value;
            }
        }
        setOverrideValues(vals);
        setOverridesDirty(false);
    }, [overridesResponse, resolvedFields]);
    const handleOverrideChange = useCallback((category, fieldName, value) => {
        setOverrideValues((prev) => ({ ...prev, [`${category}::${fieldName}`]: value }));
        setOverridesDirty(true);
        setOverrideSaved(false);
    }, []);
    const handleSaveOverrides = useCallback(() => {
        if (!id)
            return;
        const overrides = [];
        for (const [key, value] of Object.entries(overrideValues)) {
            if (value.trim() === '')
                continue;
            const [category, field_name] = key.split('::');
            overrides.push({ category, field_name, value });
        }
        saveOverrides.mutate({ shopifyProductId: id, overrides }, { onSuccess: () => { setOverridesDirty(false); setOverrideSaved(true); } });
    }, [id, overrideValues, saveOverrides]);
    const categoryLabels = { sales: 'Sales', listing: 'Listing', shipping: 'Shipping', payment: 'Payment' };
    const formatFieldLabel = (fieldName) => fieldName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const syncMutation = useMutation({
        mutationFn: () => apiClient.put(`/sync/products/${id}`),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['listings'] });
            addNotification({ type: 'success', title: 'Sync started', autoClose: 4000 });
        },
        onError: (error) => {
            addNotification({ type: 'error', title: 'Sync failed', message: error instanceof Error ? error.message : 'Unknown error' });
        },
    });
    const endListingMutation = useMutation({
        mutationFn: () => apiClient.post(`/sync/products/${id}/end`),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['listings'] });
            addNotification({ type: 'success', title: 'Listing ended', autoClose: 4000 });
        },
        onError: (error) => {
            addNotification({ type: 'error', title: 'Failed to end listing', message: error instanceof Error ? error.message : 'Unknown error' });
        },
    });
    const syncHistory = useMemo(() => {
        if (!listing)
            return [];
        return [
            { label: 'Created', value: formatTimestampFull(listing.createdAt) },
            { label: 'Last updated', value: formatTimestampFull(listing.updatedAt) },
            { label: 'Last republished', value: formatTimestampFull(listing.lastRepublishedAt) },
            { label: 'Promoted', value: formatTimestampFull(listing.promotedAt) },
        ].filter((event) => event.value !== '—');
    }, [listing]);
    const product = productInfo?.product;
    const productVariant = product?.variant;
    const secondaryActions = [
        { content: 'End listing', destructive: true, onAction: () => endListingMutation.mutate() },
    ];
    if (listing?.ebayListingId && !isDraftListing(listing.ebayListingId)) {
        secondaryActions.push({
            content: 'View on eBay',
            onAction: () => window.open(`https://www.ebay.com/itm/${listing.ebayListingId}`, '_blank'),
        });
    }
    return (_jsxs(Page, { title: product?.title ?? listing?.shopifyTitle ?? 'Product detail', subtitle: listing?.shopifyProductId ? `Shopify ID ${listing.shopifyProductId}` : undefined, backAction: { content: 'Back to eBay listings', onAction: () => navigate('/ebay/listings') }, primaryAction: {
            content: 'Sync now',
            onAction: () => syncMutation.mutate(),
            loading: syncMutation.isPending,
        }, secondaryActions: secondaryActions, fullWidth: true, children: [(listingLoading || productLoading) && (_jsx(Box, { padding: "800", children: _jsx(InlineStack, { align: "center", children: _jsx(Spinner, { accessibilityLabel: "Loading product detail", size: "large" }) }) })), listingError && (_jsx(Banner, { tone: "critical", title: "Unable to load product detail", children: _jsx(Text, { as: "p", children: listingError instanceof Error ? listingError.message : 'Something went wrong.' }) })), listing && (_jsxs(BlockStack, { gap: "500", children: [_jsx(Layout, { children: _jsx(Layout.Section, { children: _jsx(Card, { children: _jsxs(BlockStack, { gap: "400", children: [_jsxs(InlineStack, { gap: "300", align: "space-between", blockAlign: "center", children: [_jsxs(InlineStack, { gap: "200", blockAlign: "center", children: [_jsx(Box, { background: "bg-fill-secondary", borderRadius: "200", padding: "200", children: _jsx(Icon, { source: ProductIcon }) }), _jsx(Text, { variant: "headingMd", as: "h2", children: "Shopify product" })] }), product?.status && _jsx(Badge, { tone: "info", children: product.status })] }), _jsx(Divider, {}), _jsxs(InlineStack, { gap: "400", align: "start", children: [_jsxs(BlockStack, { gap: "200", children: [_jsx(Thumbnail, { size: "large", source: product?.image?.src || product?.images?.[0]?.src || 'https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_large.png', alt: product?.title ?? 'Product image' }), product?.images && product.images.length > 1 && (_jsxs(InlineStack, { gap: "100", wrap: true, children: [product.images.slice(0, 6).map((img, idx) => (_jsx(Thumbnail, { size: "small", source: img.src, alt: `Image ${idx + 1}` }, img.id ?? idx))), product.images.length > 6 && (_jsxs(Text, { variant: "bodySm", tone: "subdued", as: "span", children: ["+", product.images.length - 6, " more"] }))] }))] }), _jsxs(BlockStack, { gap: "200", children: [_jsx(Text, { variant: "headingLg", as: "h3", children: product?.title ?? listing.shopifyTitle ?? 'Untitled product' }), _jsxs(Text, { variant: "bodyMd", tone: "subdued", as: "p", children: ["SKU: ", productVariant?.sku ?? listing.shopifySku ?? '—'] }), _jsxs(Text, { variant: "bodyMd", as: "p", children: ["Price: ", formatMoney(Number(productVariant?.price ?? listing.originalPrice ?? 0) || null)] }), _jsxs(Text, { variant: "bodyMd", as: "p", children: ["Inventory: ", productVariant?.inventory_quantity ?? '—'] }), _jsxs(Text, { variant: "bodySm", tone: "subdued", as: "p", children: ["Inventory Item ID: ", productVariant?.inventory_item_id ?? listing.ebayInventoryItemId ?? '—'] })] })] })] }) }) }) }), _jsx(Layout, { children: _jsx(Layout.Section, { children: _jsx(Card, { children: _jsxs(BlockStack, { gap: "400", children: [_jsxs(InlineStack, { gap: "300", align: "space-between", blockAlign: "center", children: [_jsxs(InlineStack, { gap: "200", blockAlign: "center", children: [_jsx(Box, { background: "bg-fill-secondary", borderRadius: "200", padding: "200", children: _jsx(Icon, { source: ViewIcon }) }), _jsx(Text, { variant: "headingMd", as: "h2", children: "eBay listing" })] }), _jsx(Badge, { tone: getStatusPresentation(listing).tone, children: getStatusPresentation(listing).label })] }), _jsx(Divider, {}), ebayLoading ? (_jsx(Spinner, { accessibilityLabel: "Loading eBay details", size: "small" })) : (_jsxs(InlineGrid, { columns: { xs: 1, sm: 2 }, gap: "300", children: [_jsxs(BlockStack, { gap: "100", children: [_jsx(Text, { variant: "bodySm", tone: "subdued", as: "p", children: "Listing ID" }), _jsx(Text, { variant: "bodyMd", as: "p", children: listing.ebayListingId ?? '—' })] }), _jsxs(BlockStack, { gap: "100", children: [_jsx(Text, { variant: "bodySm", tone: "subdued", as: "p", children: "Offer ID" }), _jsx(Text, { variant: "bodyMd", as: "p", children: ebayOffer?.offer?.offerId ?? '—' })] }), _jsxs(BlockStack, { gap: "100", children: [_jsx(Text, { variant: "bodySm", tone: "subdued", as: "p", children: "eBay price" }), _jsx(Text, { variant: "bodyMd", as: "p", children: formatMoney(Number(ebayOffer?.offer?.price ?? 0) || null) })] }), _jsxs(BlockStack, { gap: "100", children: [_jsx(Text, { variant: "bodySm", tone: "subdued", as: "p", children: "Available" }), _jsx(Text, { variant: "bodyMd", as: "p", children: ebayOffer?.offer?.quantity ?? ebayOffer?.inventoryItem?.quantity ?? '—' })] }), _jsxs(BlockStack, { gap: "100", children: [_jsx(Text, { variant: "bodySm", tone: "subdued", as: "p", children: "Condition" }), _jsx(Text, { variant: "bodyMd", as: "p", children: ebayOffer?.inventoryItem?.condition ?? '—' })] })] })), _jsx(Divider, {}), _jsx(InlineStack, { gap: "200", children: isDraftListing(listing.ebayListingId) ? (_jsx(Badge, { tone: "info", children: "Draft \u2014 not yet published" })) : (_jsxs(_Fragment, { children: [_jsx(Button, { icon: ExternalIcon, onClick: () => listing.ebayListingId && window.open(`https://www.ebay.com/itm/${listing.ebayListingId}`, '_blank'), disabled: !listing.ebayListingId, children: "View on eBay" }), _jsx(Button, { icon: ExternalIcon, onClick: () => window.open(`https://www.ebay.com/sh/lst/active?q=${encodeURIComponent(listing.shopifySku || '')}`, '_blank'), disabled: !listing.ebayListingId, children: "Edit on eBay" })] })) })] }) }) }) }), _jsx(Layout, { children: _jsx(Layout.Section, { children: _jsx(Card, { children: _jsxs(BlockStack, { gap: "400", children: [_jsxs(InlineStack, { align: "space-between", blockAlign: "center", children: [_jsxs(BlockStack, { gap: "100", children: [_jsx(Text, { variant: "headingMd", as: "h2", children: "eBay listing fields" }), _jsx(Text, { variant: "bodySm", tone: "subdued", as: "p", children: "Values sent to eBay. Edit any field to override the default mapping." })] }), _jsx(Button, { variant: "primary", onClick: handleSaveOverrides, loading: saveOverrides.isPending, disabled: !overridesDirty, children: "Save changes" })] }), overrideSaved && (_jsx(Banner, { tone: "success", title: "Changes saved successfully", onDismiss: () => setOverrideSaved(false) })), Object.keys(resolvedFields).length === 0 ? (_jsx(Text, { tone: "subdued", as: "p", children: "No mapping data available. Configure mappings first." })) : (Object.entries(resolvedFields).map(([category, fields]) => (_jsxs(BlockStack, { gap: "300", children: [_jsxs(InlineStack, { gap: "200", blockAlign: "center", children: [_jsx(Text, { variant: "headingSm", as: "h3", children: categoryLabels[category] ?? category }), _jsx(Badge, { tone: "info", children: `${fields.length} fields` })] }), _jsx(InlineGrid, { columns: { xs: 1, sm: 2, md: 3 }, gap: "300", children: fields.map((field) => {
                                                        const key = `${category}::${field.field_name}`;
                                                        const currentValue = overrideValues[key] ?? '';
                                                        const isFromShopify = field.mapping_type === 'shopify_field' && field.resolved && currentValue === field.resolved;
                                                        const isConstant = field.mapping_type === 'constant' && currentValue === field.resolved;
                                                        const helpText = isFromShopify ? 'Auto-filled from Shopify' : isConstant ? 'Default value' : field.mapping_type === 'edit_in_grid' ? 'Manual entry' : undefined;
                                                        return (_jsx(TextField, { label: formatFieldLabel(field.field_name), value: currentValue, onChange: (value) => handleOverrideChange(category, field.field_name, value), autoComplete: "off", helpText: helpText, labelAction: isFromShopify ? { content: 'Reset', onAction: () => handleOverrideChange(category, field.field_name, field.resolved) } : undefined }, key));
                                                    }) }), category !== 'payment' && _jsx(Divider, {})] }, category))))] }) }) }) }), _jsx(Layout, { children: _jsx(Layout.Section, { children: _jsx(Card, { children: _jsxs(BlockStack, { gap: "300", children: [_jsxs(InlineStack, { gap: "200", blockAlign: "center", children: [_jsx(Box, { background: "bg-fill-secondary", borderRadius: "200", padding: "200", children: _jsx(Icon, { source: ClockIcon }) }), _jsx(Text, { variant: "headingMd", as: "h2", children: "Sync history" })] }), _jsx(Divider, {}), syncHistory.length === 0 ? (_jsx(Text, { tone: "subdued", as: "p", children: "No sync activity recorded yet." })) : (_jsx(BlockStack, { gap: "200", children: syncHistory.map((event) => (_jsxs(InlineStack, { align: "space-between", children: [_jsx(Text, { variant: "bodySm", tone: "subdued", as: "span", children: event.label }), _jsx(Text, { variant: "bodySm", as: "span", children: event.value })] }, event.label))) }))] }) }) }) })] }))] }));
};
/* ────────────────── Listings List ────────────────── */
const Listings = () => {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { addNotification } = useAppStore();
    const syncProducts = useSyncProducts();
    const [searchValue, setSearchValue] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [offset, setOffset] = useState(0);
    const [selectedItems, setSelectedItems] = useState([]);
    const limit = 50;
    useEffect(() => { setOffset(0); }, [searchValue, statusFilter]);
    const statusParam = useMemo(() => {
        if (statusFilter === 'all' || statusFilter === 'missing')
            return undefined;
        if (statusFilter === 'active')
            return 'active,synced';
        return statusFilter;
    }, [statusFilter]);
    const { data, isLoading, error } = useListings({ limit, offset, search: searchValue || undefined, status: statusParam });
    const listings = useMemo(() => (data?.data ?? []).map(normalizeListing), [data]);
    const pageListings = useMemo(() => {
        if (statusFilter !== 'missing')
            return listings;
        return listings.filter((l) => !l.ebayListingId);
    }, [listings, statusFilter]);
    const total = data?.total ?? 0;
    const stats = useMemo(() => {
        const active = listings.filter((l) => getStatusPresentation(l).label === 'Active').length;
        const missing = listings.filter((l) => !l.ebayListingId).length;
        const errorCount = listings.filter((l) => getStatusPresentation(l).label === 'Error').length;
        const draft = listings.filter((l) => getStatusPresentation(l).label === 'Draft').length;
        return { active, missing, errorCount, draft };
    }, [listings]);
    const selectedIdsOnPage = useMemo(() => pageListings.map((l) => l.shopifyProductId), [pageListings]);
    const allSelectedOnPage = selectedIdsOnPage.length > 0 && selectedIdsOnPage.every((id) => selectedItems.includes(id));
    const toggleSelectAll = useCallback((value) => {
        if (value) {
            setSelectedItems((prev) => Array.from(new Set([...prev, ...selectedIdsOnPage])));
        }
        else {
            setSelectedItems((prev) => prev.filter((id) => !selectedIdsOnPage.includes(id)));
        }
    }, [selectedIdsOnPage]);
    const toggleSelection = useCallback((id) => {
        setSelectedItems((prev) => prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]);
    }, []);
    const bulkEndMutation = useMutation({
        mutationFn: (productIds) => Promise.all(productIds.map((pid) => apiClient.post(`/sync/products/${pid}/end`))),
        onSuccess: (_, productIds) => {
            queryClient.invalidateQueries({ queryKey: ['listings'] });
            addNotification({ type: 'success', title: `${productIds.length} listings ended`, autoClose: 4000 });
            setSelectedItems([]);
        },
        onError: (error) => {
            addNotification({ type: 'error', title: 'Bulk end failed', message: error instanceof Error ? error.message : 'Unknown error' });
        },
    });
    const bulkRelistMutation = useMutation({
        mutationFn: (productIds) => Promise.all(productIds.map((pid) => apiClient.put(`/sync/products/${pid}`))),
        onSuccess: (_, productIds) => {
            queryClient.invalidateQueries({ queryKey: ['listings'] });
            addNotification({ type: 'success', title: `${productIds.length} listings relisted`, autoClose: 4000 });
            setSelectedItems([]);
        },
        onError: (error) => {
            addNotification({ type: 'error', title: 'Bulk relist failed', message: error instanceof Error ? error.message : 'Unknown error' });
        },
    });
    const rowMarkup = pageListings.map((listing, index) => {
        const status = getStatusPresentation(listing);
        const productLabel = listing.shopifyTitle ?? `Shopify product ${listing.shopifyProductId}`;
        const draft = isDraftListing(listing.ebayListingId);
        return (_jsxs(IndexTable.Row, { id: listing.shopifyProductId, position: index, selected: selectedItems.includes(listing.shopifyProductId), onClick: () => navigate(`/ebay/listings/${listing.shopifyProductId}`), children: [_jsx(IndexTable.Cell, { children: _jsxs(BlockStack, { gap: "100", children: [_jsx(Text, { variant: "bodyMd", fontWeight: "semibold", as: "p", children: productLabel }), listing.shopifySku && _jsxs(Text, { variant: "bodySm", tone: "subdued", as: "p", children: ["SKU: ", listing.shopifySku] })] }) }), _jsx(IndexTable.Cell, { children: _jsxs(BlockStack, { gap: "100", children: [_jsx(Text, { variant: "bodyMd", as: "p", children: listing.ebayListingId ?? 'No listing linked' }), _jsxs(Text, { variant: "bodySm", tone: "subdued", as: "p", children: ["Inv: ", listing.ebayInventoryItemId ?? '—'] })] }) }), _jsx(IndexTable.Cell, { children: _jsx(Badge, { tone: status.tone, children: status.label }) }), _jsx(IndexTable.Cell, { children: _jsx(Text, { variant: "bodyMd", as: "p", children: formatMoney(listing.originalPrice ?? null) }) }), _jsx(IndexTable.Cell, { children: _jsx(Text, { variant: "bodySm", tone: "subdued", as: "p", children: formatTimestamp(listing.updatedAt) }) }), _jsx(IndexTable.Cell, { children: draft ? (_jsx(Badge, { tone: "info", children: "Draft" })) : (_jsx(Button, { size: "micro", icon: ExternalIcon, onClick: () => listing.ebayListingId && window.open(`https://www.ebay.com/itm/${listing.ebayListingId}`, '_blank'), disabled: !listing.ebayListingId, children: "View" })) })] }, listing.id));
    });
    return (_jsx(Page, { title: "Products & Listings", subtitle: "Shopify catalog synced to eBay listings", primaryAction: {
            content: 'Sync all products',
            onAction: () => syncProducts.mutate([]),
            loading: syncProducts.isPending,
        }, fullWidth: true, children: _jsxs(BlockStack, { gap: "500", children: [_jsxs(InlineGrid, { columns: { xs: 2, sm: 4 }, gap: "300", children: [_jsx(StatPill, { label: "Active", value: stats.active, icon: StatusActiveIcon, tone: "success" }), _jsx(StatPill, { label: "Missing", value: stats.missing, icon: AlertCircleIcon, tone: "critical" }), _jsx(StatPill, { label: "Draft", value: stats.draft, icon: ClockIcon, tone: "info" }), _jsx(StatPill, { label: "Errors", value: stats.errorCount, icon: AlertCircleIcon, tone: "warning" })] }), _jsx(Card, { children: _jsxs(BlockStack, { gap: "300", children: [_jsxs(InlineStack, { gap: "300", align: "space-between", blockAlign: "end", children: [_jsx(Box, { minWidth: "280px", children: _jsx(TextField, { label: "Search", labelHidden: true, placeholder: "Search by title, SKU, or eBay listing ID", value: searchValue, onChange: setSearchValue, prefix: _jsx(Icon, { source: SearchIcon }), clearButton: true, onClearButtonClick: () => setSearchValue(''), autoComplete: "off" }) }), _jsx(InlineStack, { gap: "200", wrap: true, children: ['all', 'active', 'missing', 'error', 'inactive', 'pending'].map((f) => (_jsx(Button, { pressed: statusFilter === f, onClick: () => setStatusFilter(f), children: f.charAt(0).toUpperCase() + f.slice(1) }, f))) })] }), selectedItems.length > 0 && (_jsx(Card, { padding: "200", children: _jsxs(InlineStack, { align: "space-between", gap: "300", blockAlign: "center", children: [_jsxs(Text, { variant: "bodyMd", as: "p", fontWeight: "medium", children: [selectedItems.length, " selected"] }), _jsxs(ButtonGroup, { children: [_jsx(Button, { icon: RefreshIcon, onClick: () => bulkRelistMutation.mutate(selectedItems), loading: bulkRelistMutation.isPending, children: "Bulk relist" }), _jsx(Button, { icon: XCircleIcon, tone: "critical", onClick: () => bulkEndMutation.mutate(selectedItems), loading: bulkEndMutation.isPending, children: "Bulk end" })] })] }) })), error && (_jsx(Banner, { tone: "critical", title: "Unable to load listings", children: _jsx(Text, { as: "p", children: error instanceof Error ? error.message : 'Something went wrong.' }) })), _jsx(Divider, {}), isLoading ? (_jsx(Box, { padding: "800", children: _jsx(InlineStack, { align: "center", children: _jsx(Spinner, { accessibilityLabel: "Loading listings", size: "large" }) }) })) : (_jsx(IndexTable, { resourceName: { singular: 'listing', plural: 'listings' }, itemCount: pageListings.length, selectedItemsCount: selectedItems.length, onSelectionChange: (selectionType, _toggleType, id) => {
                                    if (selectionType === 'all') {
                                        toggleSelectAll(!allSelectedOnPage);
                                    }
                                    else if (id && typeof id === 'string') {
                                        toggleSelection(id);
                                    }
                                }, headings: [
                                    { title: 'Product' },
                                    { title: 'eBay listing' },
                                    { title: 'Status' },
                                    { title: 'Price' },
                                    { title: 'Last updated' },
                                    { title: 'Actions' },
                                ], children: rowMarkup }))] }) }), _jsx(InlineStack, { align: "center", children: _jsx(Pagination, { hasPrevious: offset > 0, onPrevious: () => setOffset(Math.max(0, offset - limit)), hasNext: offset + limit < total, onNext: () => setOffset(offset + limit) }) })] }) }));
};
export { ListingDetail };
export default Listings;
