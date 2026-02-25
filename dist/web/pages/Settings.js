import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from 'react';
import { Badge, Banner, BlockStack, Box, Button, Card, Checkbox, InlineStack, Layout, Page, Select, SkeletonBodyText, SkeletonPage, Spinner, Text, TextField, } from '@shopify/polaris';
import { LinkIcon, RefreshIcon, DeleteIcon, PlusIcon } from '@shopify/polaris-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, useEbayAuthStatus, useSettings, useStatus, useUpdateSettings } from '../hooks/useApi';
import { useAppStore } from '../store';
// ── Hardcoded defaults (mirrors config files) ──────────────────────────
const DEFAULT_CONDITION_DESCRIPTIONS = {
    'Mint / Like New': 'Virtually indistinguishable from new. No visible wear, perfect optics.',
    'Like New Minus': 'Near-perfect with only the faintest handling marks. Optics pristine.',
    'Excellent Plus': 'Light signs of normal use, minor cosmetic marks. Optics clean, no haze/fungus/scratches.',
    Excellent: 'Normal cosmetic wear consistent with regular use. All functions work perfectly. Optics clear.',
    'Excellent Minus': 'Moderate cosmetic wear, possible light marks on barrel. Optics clean and functional.',
    'Good Plus': 'Visible wear and cosmetic marks. Fully functional, optics may show minor dust (does not affect image quality).',
    Good: 'Heavy wear, possible brassing or paint loss. Fully functional.',
    'Open Box': 'This item has been opened and inspected but shows no signs of use. Includes all original packaging and accessories.',
};
const DEFAULT_CATEGORY_RULES = [
    { categoryId: '31388', name: 'Digital Cameras', keywords: ['digital camera', 'dslr', 'mirrorless', 'camera body', 'camera'], priority: 100 },
    { categoryId: '3323', name: 'Camera Lenses', keywords: ['lens', 'lenses', 'prime lens', 'zoom lens', 'wide angle', 'telephoto'], priority: 90 },
    { categoryId: '4201', name: 'Film Photography Film', keywords: ['camera film', 'film', '35mm film', 'instant', 'polaroid film', 'instax'], priority: 85 },
    { categoryId: '78997', name: 'Film Photography Cameras', keywords: ['film camera', 'film slr', '35mm camera', 'rangefinder', 'medium format camera'], priority: 80 },
    { categoryId: '183331', name: 'Flashes & Flash Accessories', keywords: ['flash', 'speedlight', 'speedlite', 'strobe'], priority: 75 },
    { categoryId: '30090', name: 'Tripods & Monopods', keywords: ['tripod', 'monopod', 'gimbal', 'stabilizer'], priority: 70 },
    { categoryId: '29982', name: 'Camera Bags & Cases', keywords: ['bag', 'case', 'backpack', 'camera bag'], priority: 65 },
    { categoryId: '48446', name: 'Binoculars & Telescopes', keywords: ['binocular', 'binoculars', 'telescope', 'spotting scope'], priority: 60 },
    { categoryId: '48528', name: 'Camera Filters', keywords: ['filter', 'uv filter', 'nd filter', 'polarizer', 'cpl'], priority: 55 },
    { categoryId: '48444', name: 'Other Camera Accessories', keywords: ['accessory', 'accessories', 'strap', 'remote', 'adapter', 'battery', 'charger'], priority: 50 },
];
// ── Main Component ─────────────────────────────────────────────────────
const Settings = () => {
    const { data: settings, isLoading, error } = useSettings();
    useStatus();
    const { data: ebayAuth, isLoading: ebayLoading, refetch: refetchEbay } = useEbayAuthStatus();
    const updateSettings = useUpdateSettings();
    const { connections } = useAppStore();
    const queryClient = useQueryClient();
    const [draft, setDraft] = useState({});
    // ── Condition descriptions state ──────────────────────────────────────
    const { data: condDescData } = useQuery({
        queryKey: ['condition-descriptions'],
        queryFn: () => apiClient.get('/settings/condition-descriptions'),
    });
    const [condDraft, setCondDraft] = useState({});
    const [condSaveStatus, setCondSaveStatus] = useState('idle');
    const condDescriptions = useMemo(() => ({ ...DEFAULT_CONDITION_DESCRIPTIONS, ...(condDescData ?? {}), ...condDraft }), [condDescData, condDraft]);
    const saveCondDescMutation = useMutation({
        mutationFn: (data) => apiClient.put('/settings/condition-descriptions', data),
        onSuccess: () => {
            setCondSaveStatus('saved');
            setCondDraft({});
            queryClient.invalidateQueries({ queryKey: ['condition-descriptions'] });
            setTimeout(() => setCondSaveStatus('idle'), 3000);
        },
        onError: () => {
            setCondSaveStatus('error');
            setTimeout(() => setCondSaveStatus('idle'), 4000);
        },
    });
    const handleSaveCondDesc = () => {
        setCondSaveStatus('saving');
        saveCondDescMutation.mutate(condDescriptions);
    };
    // ── Category rules state ──────────────────────────────────────────────
    const { data: categoryData } = useQuery({
        queryKey: ['ebay-categories'],
        queryFn: () => apiClient.get('/settings/ebay-categories'),
    });
    const [categoryRules, setCategoryRules] = useState([]);
    const [catSaveStatus, setCatSaveStatus] = useState('idle');
    // Sync category rules when API data loads
    useEffect(() => {
        if (categoryData && categoryRules.length === 0) {
            setCategoryRules(categoryData);
        }
    }, [categoryData]);
    // Initialize from defaults if no API data
    const displayCategoryRules = categoryRules.length > 0
        ? categoryRules
        : (categoryData ?? DEFAULT_CATEGORY_RULES);
    const saveCatMutation = useMutation({
        mutationFn: (data) => apiClient.put('/settings/ebay-categories', data),
        onSuccess: () => {
            setCatSaveStatus('saved');
            queryClient.invalidateQueries({ queryKey: ['ebay-categories'] });
            setTimeout(() => setCatSaveStatus('idle'), 3000);
        },
        onError: () => {
            setCatSaveStatus('error');
            setTimeout(() => setCatSaveStatus('idle'), 4000);
        },
    });
    const handleSaveCategories = () => {
        setCatSaveStatus('saving');
        saveCatMutation.mutate(displayCategoryRules);
    };
    const handleCategoryChange = (idx, field, value) => {
        setCategoryRules((prev) => {
            const next = [...(prev.length > 0 ? prev : DEFAULT_CATEGORY_RULES)];
            next[idx] = { ...next[idx], [field]: value };
            return next;
        });
    };
    const handleAddCategory = () => {
        setCategoryRules((prev) => [
            ...(prev.length > 0 ? prev : DEFAULT_CATEGORY_RULES),
            { categoryId: '', name: 'New Category', keywords: [], priority: 10 },
        ]);
    };
    const handleDeleteCategory = (idx) => {
        setCategoryRules((prev) => {
            const source = prev.length > 0 ? prev : DEFAULT_CATEGORY_RULES;
            return source.filter((_, i) => i !== idx);
        });
    };
    // ── Merged settings ───────────────────────────────────────────────────
    const mergedSettings = useMemo(() => ({
        auto_sync_enabled: settings?.auto_sync_enabled ?? 'false',
        sync_interval_minutes: settings?.sync_interval_minutes ?? '5',
        sync_inventory: settings?.sync_inventory ?? 'true',
        sync_price: settings?.sync_price ?? 'true',
        description_prompt: settings?.description_prompt ?? '',
        photoroom_template_id: settings?.photoroom_template_id ?? '',
        pipeline_auto_descriptions: settings?.pipeline_auto_descriptions ?? '0',
        pipeline_auto_images: settings?.pipeline_auto_images ?? '0',
        ...settings,
        ...draft,
    }), [settings, draft]);
    const handleSave = () => {
        updateSettings.mutate(mergedSettings);
    };
    const handleConnectShopify = () => {
        window.open('/auth', '_blank', 'width=600,height=700');
    };
    const handleConnectEbay = () => {
        window.open('/ebay/auth', '_blank', 'width=600,height=700');
    };
    const handleDisconnectEbay = async () => {
        await apiClient.delete('/ebay/auth');
        refetchEbay();
    };
    const photoroomKeyConfigured = Boolean(settings?.photoroom_api_key_configured === 'true' || process.env.PHOTOROOM_API_KEY);
    // ── Loading / error states ────────────────────────────────────────────
    if (isLoading) {
        return (_jsx(SkeletonPage, { title: "Settings", children: _jsx(Layout, { children: _jsx(Layout.AnnotatedSection, { title: "Connections", description: "Loading...", children: _jsx(Card, { children: _jsx(SkeletonBodyText, { lines: 4 }) }) }) }) }));
    }
    if (error) {
        return (_jsx(Page, { title: "Settings", children: _jsx(Banner, { tone: "critical", title: "Settings unavailable", children: _jsx("p", { children: error.message }) }) }));
    }
    // ── Render ────────────────────────────────────────────────────────────
    return (_jsx(Page, { title: "Settings", children: _jsxs(Layout, { children: [_jsx(Layout.AnnotatedSection, { title: "Connections", description: "Platform integrations and authentication", children: _jsxs(BlockStack, { gap: "400", children: [_jsx(Card, { children: _jsxs(BlockStack, { gap: "300", children: [_jsx(InlineStack, { align: "space-between", blockAlign: "center", children: _jsxs(InlineStack, { gap: "200", blockAlign: "center", children: [_jsx(Text, { variant: "headingMd", as: "h3", children: "\uD83D\uDECD\uFE0F Shopify" }), _jsx(Badge, { tone: connections.shopify ? 'success' : 'critical', children: connections.shopify ? 'Connected' : 'Disconnected' })] }) }), _jsx(Text, { variant: "bodySm", as: "p", tone: "subdued", children: "Connect Shopify to sync products, inventory, and pricing." }), _jsx(Button, { icon: LinkIcon, onClick: handleConnectShopify, size: "slim", children: "Connect Shopify" })] }) }), _jsx(Card, { children: _jsxs(BlockStack, { gap: "300", children: [_jsx(InlineStack, { align: "space-between", blockAlign: "center", children: _jsxs(InlineStack, { gap: "200", blockAlign: "center", children: [_jsx(Text, { variant: "headingMd", as: "h3", children: "\uD83D\uDED2 eBay" }), ebayLoading ? (_jsx(Spinner, { size: "small", accessibilityLabel: "Checking eBay status" })) : (_jsx(Badge, { tone: ebayAuth?.connected ? 'success' : 'critical', children: ebayAuth?.connected ? 'Connected' : 'Disconnected' }))] }) }), _jsx(Text, { variant: "bodySm", as: "p", tone: "subdued", children: ebayAuth?.connected
                                                ? 'eBay account is authorized. Products will sync automatically.'
                                                : 'Authorize your eBay seller account to enable listing sync.' }), _jsxs(InlineStack, { gap: "200", children: [_jsx(Button, { icon: LinkIcon, onClick: handleConnectEbay, size: "slim", children: ebayAuth?.connected ? 'Reconnect eBay' : 'Connect eBay' }), _jsx(Button, { icon: RefreshIcon, onClick: () => refetchEbay(), size: "slim", children: "Refresh" }), ebayAuth?.connected && (_jsx(Button, { tone: "critical", onClick: handleDisconnectEbay, size: "slim", children: "Disconnect" }))] })] }) })] }) }), _jsx(Layout.AnnotatedSection, { title: "Sync", description: "Control how and when products sync between Shopify and eBay", children: _jsx(Card, { children: _jsxs(BlockStack, { gap: "400", children: [_jsxs(BlockStack, { gap: "200", children: [_jsx(Checkbox, { label: "Auto-sync enabled", checked: String(mergedSettings.auto_sync_enabled) === 'true', onChange: (value) => setDraft((prev) => ({ ...prev, auto_sync_enabled: value ? 'true' : 'false' })) }), _jsx(Checkbox, { label: "Sync inventory", checked: String(mergedSettings.sync_inventory) === 'true', onChange: (value) => setDraft((prev) => ({ ...prev, sync_inventory: value ? 'true' : 'false' })) }), _jsx(Checkbox, { label: "Sync price", checked: String(mergedSettings.sync_price) === 'true', onChange: (value) => setDraft((prev) => ({ ...prev, sync_price: value ? 'true' : 'false' })) })] }), _jsx(Box, { maxWidth: "200px", children: _jsx(Select, { label: "Sync interval (minutes)", options: [
                                            { label: '5 minutes', value: '5' },
                                            { label: '10 minutes', value: '10' },
                                            { label: '15 minutes', value: '15' },
                                            { label: '30 minutes', value: '30' },
                                        ], value: String(mergedSettings.sync_interval_minutes), onChange: (value) => setDraft((prev) => ({ ...prev, sync_interval_minutes: value })) }) }), _jsx(InlineStack, { align: "end", children: _jsx(Button, { variant: "primary", onClick: handleSave, loading: updateSettings.isPending, size: "slim", children: "Save sync settings" }) })] }) }) }), _jsx(Layout.AnnotatedSection, { title: "Pipeline", description: "Automatic processing steps for new products entering the pipeline", children: _jsx(Card, { children: _jsxs(BlockStack, { gap: "400", children: [_jsxs(BlockStack, { gap: "200", children: [_jsx(Checkbox, { label: "Auto-generate descriptions on new products", checked: String(mergedSettings.pipeline_auto_descriptions) === '1', onChange: (value) => setDraft((prev) => ({ ...prev, pipeline_auto_descriptions: value ? '1' : '0' })) }), _jsx(Checkbox, { label: "Auto-process images on new products", checked: String(mergedSettings.pipeline_auto_images) === '1', onChange: (value) => setDraft((prev) => ({ ...prev, pipeline_auto_images: value ? '1' : '0' })) })] }), _jsx(InlineStack, { align: "end", children: _jsx(Button, { variant: "primary", onClick: handleSave, loading: updateSettings.isPending, size: "slim", children: "Save pipeline settings" }) })] }) }) }), _jsx(Layout.AnnotatedSection, { title: "Photo Processing", description: "PhotoRoom integration and image template settings", children: _jsx(Card, { children: _jsxs(BlockStack, { gap: "400", children: [_jsx(TextField, { label: "PhotoRoom Template ID", value: String(mergedSettings.photoroom_template_id), onChange: (value) => setDraft((prev) => ({ ...prev, photoroom_template_id: value })), autoComplete: "off", helpText: "The PhotoRoom template used to render product images." }), _jsxs(InlineStack, { gap: "200", blockAlign: "center", children: [_jsx(Text, { variant: "bodySm", as: "span", tone: "subdued", children: "PhotoRoom API key:" }), _jsx(Badge, { tone: photoroomKeyConfigured ? 'success' : 'critical', children: photoroomKeyConfigured ? 'Configured' : 'Not configured' })] }), _jsx(InlineStack, { align: "end", children: _jsx(Button, { variant: "primary", onClick: handleSave, loading: updateSettings.isPending, size: "slim", children: "Save photo settings" }) })] }) }) }), _jsx(Layout.AnnotatedSection, { title: "eBay", description: "Condition descriptions, category mappings, and listing defaults", children: _jsxs(BlockStack, { gap: "400", children: [_jsx(Card, { children: _jsxs(BlockStack, { gap: "400", children: [_jsx(Text, { variant: "headingMd", as: "h3", children: "Condition Grade Descriptions" }), _jsx(Text, { variant: "bodySm", as: "p", tone: "subdued", children: "Edit the descriptions shown on eBay listings for each condition grade. These appear as the item condition notes visible to buyers." }), _jsx(BlockStack, { gap: "300", children: Object.entries(condDescriptions).map(([grade, desc]) => (_jsxs(BlockStack, { gap: "100", children: [_jsx(Text, { variant: "bodyMd", as: "span", fontWeight: "semibold", children: grade }), _jsx(TextField, { label: "", labelHidden: true, value: desc, onChange: (val) => setCondDraft((prev) => ({ ...prev, [grade]: val })), multiline: 2, autoComplete: "off" })] }, grade))) }), _jsxs(InlineStack, { align: "space-between", blockAlign: "center", children: [_jsxs(Text, { variant: "bodySm", as: "span", tone: condSaveStatus === 'saved' ? 'success' : condSaveStatus === 'error' ? 'critical' : 'subdued', children: [condSaveStatus === 'saved' && '✓ Saved', condSaveStatus === 'error' && '✗ Failed to save'] }), _jsx(Button, { variant: "primary", onClick: handleSaveCondDesc, loading: condSaveStatus === 'saving', size: "slim", children: "Save descriptions" })] })] }) }), _jsx(Card, { children: _jsxs(BlockStack, { gap: "400", children: [_jsx(Text, { variant: "headingMd", as: "h3", children: "eBay Category Mappings" }), _jsx(Text, { variant: "bodySm", as: "p", tone: "subdued", children: "Map Shopify product types to eBay category IDs. Keywords are matched against the product type (comma-separated, lowercased)." }), _jsx(BlockStack, { gap: "300", children: displayCategoryRules.map((rule, idx) => (_jsx(Card, { children: _jsxs(BlockStack, { gap: "200", children: [_jsxs(InlineStack, { align: "space-between", blockAlign: "center", children: [_jsx(Text, { variant: "bodyMd", as: "span", fontWeight: "semibold", children: rule.name || `Category ${idx + 1}` }), _jsx(Button, { icon: DeleteIcon, onClick: () => handleDeleteCategory(idx), tone: "critical", variant: "plain", accessibilityLabel: "Remove category" })] }), _jsxs(InlineStack, { gap: "200", wrap: true, children: [_jsx(Box, { minWidth: "180px", maxWidth: "240px", children: _jsx(TextField, { label: "Category Name", value: rule.name, onChange: (val) => handleCategoryChange(idx, 'name', val), autoComplete: "off" }) }), _jsx(Box, { minWidth: "120px", maxWidth: "140px", children: _jsx(TextField, { label: "eBay ID", value: rule.categoryId, onChange: (val) => handleCategoryChange(idx, 'categoryId', val), placeholder: "e.g. 31388", autoComplete: "off" }) }), _jsx(Box, { minWidth: "80px", maxWidth: "100px", children: _jsx(TextField, { label: "Priority", type: "number", value: String(rule.priority), onChange: (val) => handleCategoryChange(idx, 'priority', parseInt(val) || 0), autoComplete: "off" }) })] }), _jsx(TextField, { label: "Keywords", value: Array.isArray(rule.keywords) ? rule.keywords.join(', ') : rule.keywords, onChange: (val) => handleCategoryChange(idx, 'keywords', val.split(',').map((k) => k.trim()).filter(Boolean)), placeholder: "camera, dslr, mirrorless\u2026", autoComplete: "off" })] }) }, idx))) }), _jsx(Button, { icon: PlusIcon, onClick: handleAddCategory, variant: "plain", size: "slim", children: "Add category" }), _jsxs(InlineStack, { align: "space-between", blockAlign: "center", children: [_jsxs(Text, { variant: "bodySm", as: "span", tone: catSaveStatus === 'saved' ? 'success' : catSaveStatus === 'error' ? 'critical' : 'subdued', children: [catSaveStatus === 'saved' && '✓ Saved', catSaveStatus === 'error' && '✗ Failed to save'] }), _jsx(Button, { variant: "primary", onClick: handleSaveCategories, loading: catSaveStatus === 'saving', size: "slim", children: "Save categories" })] })] }) })] }) }), _jsx(Layout.AnnotatedSection, { title: "AI Descriptions", description: "Configure the AI prompt used to generate eBay listing descriptions", children: _jsx(Card, { children: _jsxs(BlockStack, { gap: "400", children: [_jsxs(InlineStack, { gap: "200", blockAlign: "center", children: [_jsx(Text, { variant: "bodySm", as: "span", tone: "subdued", children: "OpenAI API key:" }), _jsx(Badge, { tone: settings?.openai_api_key_configured === 'true' ? 'success' : 'critical', children: settings?.openai_api_key_configured === 'true' ? 'Configured' : 'Not configured' })] }), _jsx(TextField, { label: "Description Generation Prompt", value: String(mergedSettings.description_prompt), onChange: (value) => setDraft((prev) => ({ ...prev, description_prompt: value })), multiline: 10, autoComplete: "off", helpText: "This prompt is sent to the AI when generating product descriptions for new listings." }), _jsx(InlineStack, { align: "end", children: _jsx(Button, { variant: "primary", onClick: handleSave, loading: updateSettings.isPending, size: "slim", children: "Save prompt" }) })] }) }) })] }) }));
};
export default Settings;
