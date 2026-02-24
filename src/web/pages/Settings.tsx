import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Checkbox,
  Select,
  Spinner,
  TextField,
} from '@shopify/polaris';
import { LinkIcon, RefreshIcon } from '@shopify/polaris-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, useEbayAuthStatus, useSettings, useStatus, useUpdateSettings } from '../hooks/useApi';
import { useAppStore } from '../store';
import '../styles/settings.css';

// ── Types ──────────────────────────────────────────────────────────────

interface ConditionDescriptions {
  [grade: string]: string;
}

interface CategoryRule {
  categoryId: string;
  name: string;
  keywords: string[];
  priority: number;
}

// ── Section definitions ────────────────────────────────────────────────

const SECTIONS = [
  { id: 'connections', label: 'Connections', icon: '🔗', color: '#e8f5e9' },
  { id: 'sync', label: 'Sync', icon: '🔄', color: '#e3f2fd' },
  { id: 'pipeline', label: 'Pipeline', icon: '⚡', color: '#fff3e0' },
  { id: 'photo-processing', label: 'Photo Processing', icon: '📷', color: '#f3e5f5' },
  { id: 'ebay', label: 'eBay', icon: '🛒', color: '#e8eaf6' },
  { id: 'ai-descriptions', label: 'AI Descriptions', icon: '🤖', color: '#e0f7fa' },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

// ── Hardcoded defaults (mirrors config files) ──────────────────────────

const DEFAULT_CONDITION_DESCRIPTIONS: ConditionDescriptions = {
  'Mint / Like New': 'Virtually indistinguishable from new. No visible wear, perfect optics.',
  'Like New Minus': 'Near-perfect with only the faintest handling marks. Optics pristine.',
  'Excellent Plus': 'Light signs of normal use, minor cosmetic marks. Optics clean, no haze/fungus/scratches.',
  Excellent: 'Normal cosmetic wear consistent with regular use. All functions work perfectly. Optics clear.',
  'Excellent Minus': 'Moderate cosmetic wear, possible light marks on barrel. Optics clean and functional.',
  'Good Plus': 'Visible wear and cosmetic marks. Fully functional, optics may show minor dust (does not affect image quality).',
  Good: 'Heavy wear, possible brassing or paint loss. Fully functional.',
  'Open Box': 'This item has been opened and inspected but shows no signs of use. Includes all original packaging and accessories.',
};

const DEFAULT_CATEGORY_RULES: CategoryRule[] = [
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

// ── Sub-components ─────────────────────────────────────────────────────

const StatusBadge: React.FC<{ connected: boolean; label?: string }> = ({ connected, label }) => (
  <div className={`settings-status-badge ${connected ? 'connected' : 'disconnected'}`}>
    <div className={`settings-status-dot ${connected ? 'connected' : 'disconnected'}`} />
    {label ?? (connected ? 'Connected' : 'Disconnected')}
  </div>
);

// ── Main Component ─────────────────────────────────────────────────────

const Settings: React.FC = () => {
  const { data: settings, isLoading, error } = useSettings();
  useStatus();
  const { data: ebayAuth, isLoading: ebayLoading, refetch: refetchEbay } = useEbayAuthStatus();
  const updateSettings = useUpdateSettings();
  const { connections } = useAppStore();
  const queryClient = useQueryClient();

  const [draft, setDraft] = useState<Record<string, string | boolean>>({});
  const [activeSection, setActiveSection] = useState<SectionId>('connections');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // ── Condition descriptions state ──────────────────────────────────────
  const { data: condDescData } = useQuery({
    queryKey: ['condition-descriptions'],
    queryFn: () => apiClient.get<ConditionDescriptions>('/settings/condition-descriptions'),
  });
  const [condDraft, setCondDraft] = useState<ConditionDescriptions>({});
  const [condSaveStatus, setCondSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const condDescriptions = useMemo(
    () => ({ ...DEFAULT_CONDITION_DESCRIPTIONS, ...(condDescData ?? {}), ...condDraft }),
    [condDescData, condDraft],
  );

  const saveCondDescMutation = useMutation({
    mutationFn: (data: ConditionDescriptions) =>
      apiClient.put<{ ok: boolean }>('/settings/condition-descriptions', data),
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
    queryFn: () => apiClient.get<CategoryRule[]>('/settings/ebay-categories'),
  });
  const [categoryRules, setCategoryRules] = useState<CategoryRule[]>([]);
  const [catSaveStatus, setCatSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

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
    mutationFn: (data: CategoryRule[]) =>
      apiClient.put<{ ok: boolean }>('/settings/ebay-categories', data),
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

  const handleCategoryChange = (idx: number, field: keyof CategoryRule, value: string | string[] | number) => {
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

  const handleDeleteCategory = (idx: number) => {
    setCategoryRules((prev) => {
      const source = prev.length > 0 ? prev : DEFAULT_CATEGORY_RULES;
      return source.filter((_, i) => i !== idx);
    });
  };

  // ── Merged settings ───────────────────────────────────────────────────
  const mergedSettings = useMemo(
    () => ({
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
    }),
    [settings, draft],
  );

  const handleSave = () => {
    updateSettings.mutate(mergedSettings as Record<string, string>);
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

  const photoroomKeyConfigured = Boolean(
    settings?.photoroom_api_key_configured === 'true' || process.env.PHOTOROOM_API_KEY,
  );

  // ── Scroll-spy ────────────────────────────────────────────────────────
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);

  const registerSection = useCallback((id: string, el: HTMLElement | null) => {
    if (el) sectionRefs.current.set(id, el);
    else sectionRefs.current.delete(id);
  }, []);

  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect();

    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id as SectionId);
          }
        }
      },
      { rootMargin: '-20% 0px -70% 0px', threshold: 0 },
    );

    for (const el of sectionRefs.current.values()) {
      observerRef.current.observe(el);
    }

    return () => observerRef.current?.disconnect();
  }, []);

  const scrollToSection = (id: SectionId) => {
    const el = sectionRefs.current.get(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    setSidebarOpen(false);
  };

  // ── Loading / error states ────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="settings-page">
        <div className="settings-main" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Spinner size="large" accessibilityLabel="Loading settings" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="settings-page">
        <div className="settings-main">
          <div className="settings-card">
            <p className="settings-card-title">Settings unavailable</p>
            <p className="settings-card-desc">{(error as Error).message}</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="settings-page">
      {/* Mobile overlay */}
      {sidebarOpen && <div className="settings-mobile-overlay" onClick={() => setSidebarOpen(false)} />}

      {/* Sidebar */}
      <aside className={`settings-sidebar${sidebarOpen ? ' mobile-open' : ''}`}>
        <div className="settings-sidebar-header">
          <span className="settings-sidebar-title">⚙️ &nbsp;Settings</span>
        </div>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            className={`settings-nav-item${activeSection === s.id ? ' active' : ''}`}
            onClick={() => scrollToSection(s.id)}
          >
            <span className="settings-nav-icon">{s.icon}</span>
            {s.label}
          </button>
        ))}
      </aside>

      {/* Main content */}
      <main className="settings-main">
        <div className="settings-page-header">
          <h1 className="settings-page-title">Settings</h1>
          <p className="settings-page-subtitle">Manage sync configuration, platform connections, and eBay settings</p>
        </div>

        {/* ── Connections ─────────────────────────────────────────────── */}
        <section
          id="connections"
          className="settings-section"
          ref={(el) => registerSection('connections', el)}
        >
          <div className="settings-section-header">
            <div className="settings-section-icon" style={{ background: '#e8f5e9' }}>🔗</div>
            <div className="settings-section-title-block">
              <h2 className="settings-section-title">Connections</h2>
              <p className="settings-section-desc">Platform integrations and authentication</p>
            </div>
          </div>

          <div className="settings-connections-grid">
            {/* Shopify */}
            <div className="settings-connection-card">
              <div className="settings-connection-header">
                <div className="settings-connection-name">
                  <div className="settings-connection-logo">🛍️</div>
                  <span className="settings-connection-title">Shopify</span>
                </div>
                <StatusBadge connected={Boolean(connections.shopify)} />
              </div>
              <p className="settings-connection-desc">
                Connect Shopify to sync products, inventory, and pricing.
              </p>
              <div className="settings-connection-actions">
                <Button icon={LinkIcon} onClick={handleConnectShopify} size="slim">
                  Connect Shopify
                </Button>
              </div>
            </div>

            {/* eBay */}
            <div className="settings-connection-card">
              <div className="settings-connection-header">
                <div className="settings-connection-name">
                  <div className="settings-connection-logo">🛒</div>
                  <span className="settings-connection-title">eBay</span>
                </div>
                {ebayLoading ? (
                  <Spinner size="small" accessibilityLabel="Checking eBay status" />
                ) : (
                  <StatusBadge connected={Boolean(ebayAuth?.connected)} />
                )}
              </div>
              <p className="settings-connection-desc">
                {ebayAuth?.connected
                  ? 'eBay account is authorized. Products will sync automatically.'
                  : 'Authorize your eBay seller account to enable listing sync.'}
              </p>
              <div className="settings-connection-actions">
                <Button icon={LinkIcon} onClick={handleConnectEbay} size="slim">
                  {ebayAuth?.connected ? 'Reconnect eBay' : 'Connect eBay'}
                </Button>
                <Button icon={RefreshIcon} onClick={() => refetchEbay()} size="slim">
                  Refresh
                </Button>
                {ebayAuth?.connected && (
                  <Button tone="critical" onClick={handleDisconnectEbay} size="slim">
                    Disconnect
                  </Button>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* ── Sync ────────────────────────────────────────────────────── */}
        <section
          id="sync"
          className="settings-section"
          ref={(el) => registerSection('sync', el)}
        >
          <div className="settings-section-header">
            <div className="settings-section-icon" style={{ background: '#e3f2fd' }}>🔄</div>
            <div className="settings-section-title-block">
              <h2 className="settings-section-title">Sync</h2>
              <p className="settings-section-desc">Control how and when products sync between Shopify and eBay</p>
            </div>
          </div>

          <div className="settings-card">
            <div className="settings-checkboxes">
              <Checkbox
                label="Auto-sync enabled"
                checked={String(mergedSettings.auto_sync_enabled) === 'true'}
                onChange={(value) =>
                  setDraft((prev) => ({ ...prev, auto_sync_enabled: value ? 'true' : 'false' }))
                }
              />
              <Checkbox
                label="Sync inventory"
                checked={String(mergedSettings.sync_inventory) === 'true'}
                onChange={(value) =>
                  setDraft((prev) => ({ ...prev, sync_inventory: value ? 'true' : 'false' }))
                }
              />
              <Checkbox
                label="Sync price"
                checked={String(mergedSettings.sync_price) === 'true'}
                onChange={(value) =>
                  setDraft((prev) => ({ ...prev, sync_price: value ? 'true' : 'false' }))
                }
              />
            </div>
            <div style={{ maxWidth: '200px' }}>
              <Select
                label="Sync interval (minutes)"
                options={[
                  { label: '5 minutes', value: '5' },
                  { label: '10 minutes', value: '10' },
                  { label: '15 minutes', value: '15' },
                  { label: '30 minutes', value: '30' },
                ]}
                value={String(mergedSettings.sync_interval_minutes)}
                onChange={(value) => setDraft((prev) => ({ ...prev, sync_interval_minutes: value }))}
              />
            </div>
            <div className="settings-save-bar">
              <Button
                variant="primary"
                onClick={handleSave}
                loading={updateSettings.isPending}
                size="slim"
              >
                Save sync settings
              </Button>
            </div>
          </div>
        </section>

        {/* ── Pipeline ────────────────────────────────────────────────── */}
        <section
          id="pipeline"
          className="settings-section"
          ref={(el) => registerSection('pipeline', el)}
        >
          <div className="settings-section-header">
            <div className="settings-section-icon" style={{ background: '#fff3e0' }}>⚡</div>
            <div className="settings-section-title-block">
              <h2 className="settings-section-title">Pipeline</h2>
              <p className="settings-section-desc">Automatic processing steps for new products entering the pipeline</p>
            </div>
          </div>

          <div className="settings-card">
            <div className="settings-checkboxes">
              <Checkbox
                label="Auto-generate descriptions on new products"
                checked={String(mergedSettings.pipeline_auto_descriptions) === '1'}
                onChange={(value) =>
                  setDraft((prev) => ({ ...prev, pipeline_auto_descriptions: value ? '1' : '0' }))
                }
              />
              <Checkbox
                label="Auto-process images on new products"
                checked={String(mergedSettings.pipeline_auto_images) === '1'}
                onChange={(value) =>
                  setDraft((prev) => ({ ...prev, pipeline_auto_images: value ? '1' : '0' }))
                }
              />
            </div>
            <div className="settings-save-bar">
              <Button
                variant="primary"
                onClick={handleSave}
                loading={updateSettings.isPending}
                size="slim"
              >
                Save pipeline settings
              </Button>
            </div>
          </div>
        </section>

        {/* ── Photo Processing ─────────────────────────────────────────── */}
        <section
          id="photo-processing"
          className="settings-section"
          ref={(el) => registerSection('photo-processing', el)}
        >
          <div className="settings-section-header">
            <div className="settings-section-icon" style={{ background: '#f3e5f5' }}>📷</div>
            <div className="settings-section-title-block">
              <h2 className="settings-section-title">Photo Processing</h2>
              <p className="settings-section-desc">PhotoRoom integration and image template settings</p>
            </div>
          </div>

          <div className="settings-card">
            <div style={{ marginBottom: '20px' }}>
              <TextField
                label="PhotoRoom Template ID"
                value={String(mergedSettings.photoroom_template_id)}
                onChange={(value) => setDraft((prev) => ({ ...prev, photoroom_template_id: value }))}
                autoComplete="off"
                helpText="The PhotoRoom template used to render product images."
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
              <span style={{ fontSize: '14px', color: '#6d7175' }}>PhotoRoom API key:</span>
              <Badge tone={photoroomKeyConfigured ? 'success' : 'critical'}>
                {photoroomKeyConfigured ? 'Configured' : 'Not configured'}
              </Badge>
            </div>
            <div className="settings-save-bar">
              <Button
                variant="primary"
                onClick={handleSave}
                loading={updateSettings.isPending}
                size="slim"
              >
                Save photo settings
              </Button>
            </div>
          </div>
        </section>

        {/* ── eBay ─────────────────────────────────────────────────────── */}
        <section
          id="ebay"
          className="settings-section"
          ref={(el) => registerSection('ebay', el)}
        >
          <div className="settings-section-header">
            <div className="settings-section-icon" style={{ background: '#e8eaf6' }}>🛒</div>
            <div className="settings-section-title-block">
              <h2 className="settings-section-title">eBay</h2>
              <p className="settings-section-desc">Condition descriptions, category mappings, and listing defaults</p>
            </div>
          </div>

          {/* Condition Descriptions */}
          <div className="settings-card">
            <p className="settings-card-title">Condition Grade Descriptions</p>
            <p className="settings-card-desc">
              Edit the descriptions shown on eBay listings for each condition grade. These appear as the item condition notes visible to buyers.
            </p>
            <div className="settings-conditions-grid">
              {Object.entries(condDescriptions).map(([grade, desc]) => (
                <div key={grade} className="settings-condition-item">
                  <div className="settings-condition-grade">
                    <span>{grade}</span>
                  </div>
                  <TextField
                    label=""
                    labelHidden
                    value={desc}
                    onChange={(val) =>
                      setCondDraft((prev) => ({ ...prev, [grade]: val }))
                    }
                    multiline={2}
                    autoComplete="off"
                  />
                </div>
              ))}
            </div>
            <div className="settings-save-bar">
              <span className={`settings-save-status${condSaveStatus === 'saved' ? ' saved' : condSaveStatus === 'error' ? ' error' : ''}`}>
                {condSaveStatus === 'saved' && '✓ Saved'}
                {condSaveStatus === 'error' && '✗ Failed to save'}
              </span>
              <Button
                variant="primary"
                onClick={handleSaveCondDesc}
                loading={condSaveStatus === 'saving'}
                size="slim"
              >
                Save descriptions
              </Button>
            </div>
          </div>

          {/* Category Mappings */}
          <div className="settings-card">
            <p className="settings-card-title">eBay Category Mappings</p>
            <p className="settings-card-desc">
              Map Shopify product types to eBay category IDs. Keywords are matched against the product type (comma-separated, lowercased).
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table className="settings-category-table">
                <thead>
                  <tr>
                    <th style={{ width: '22%' }}>Category Name</th>
                    <th style={{ width: '12%' }}>eBay ID</th>
                    <th style={{ width: '10%' }}>Priority</th>
                    <th>Keywords</th>
                    <th style={{ width: '40px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {displayCategoryRules.map((rule, idx) => (
                    <tr key={idx} className="settings-category-row">
                      <td>
                        <input
                          className="settings-category-name-input"
                          value={rule.name}
                          onChange={(e) => handleCategoryChange(idx, 'name', e.target.value)}
                          placeholder="Category name"
                        />
                      </td>
                      <td>
                        <input
                          className="settings-category-id-input"
                          value={rule.categoryId}
                          onChange={(e) => handleCategoryChange(idx, 'categoryId', e.target.value)}
                          placeholder="e.g. 31388"
                        />
                      </td>
                      <td>
                        <input
                          className="settings-category-id-input"
                          type="number"
                          value={rule.priority}
                          onChange={(e) => handleCategoryChange(idx, 'priority', parseInt(e.target.value) || 0)}
                          placeholder="100"
                        />
                      </td>
                      <td>
                        <input
                          className="settings-category-keywords-input"
                          value={Array.isArray(rule.keywords) ? rule.keywords.join(', ') : rule.keywords}
                          onChange={(e) =>
                            handleCategoryChange(idx, 'keywords', e.target.value.split(',').map((k) => k.trim()).filter(Boolean))
                          }
                          placeholder="camera, dslr, mirrorless…"
                        />
                      </td>
                      <td>
                        <button
                          className="settings-category-delete-btn"
                          onClick={() => handleDeleteCategory(idx)}
                          title="Remove category"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="settings-add-row-btn" onClick={handleAddCategory}>
              + Add category
            </button>
            <div className="settings-save-bar">
              <span className={`settings-save-status${catSaveStatus === 'saved' ? ' saved' : catSaveStatus === 'error' ? ' error' : ''}`}>
                {catSaveStatus === 'saved' && '✓ Saved'}
                {catSaveStatus === 'error' && '✗ Failed to save'}
              </span>
              <Button
                variant="primary"
                onClick={handleSaveCategories}
                loading={catSaveStatus === 'saving'}
                size="slim"
              >
                Save categories
              </Button>
            </div>
          </div>
        </section>

        {/* ── AI Descriptions ──────────────────────────────────────────── */}
        <section
          id="ai-descriptions"
          className="settings-section"
          ref={(el) => registerSection('ai-descriptions', el)}
        >
          <div className="settings-section-header">
            <div className="settings-section-icon" style={{ background: '#e0f7fa' }}>🤖</div>
            <div className="settings-section-title-block">
              <h2 className="settings-section-title">AI Descriptions</h2>
              <p className="settings-section-desc">Configure the AI prompt used to generate eBay listing descriptions</p>
            </div>
          </div>

          <div className="settings-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
              <span style={{ fontSize: '14px', color: '#6d7175' }}>OpenAI API key:</span>
              <Badge tone={settings?.openai_api_key_configured === 'true' ? 'success' : 'critical'}>
                {settings?.openai_api_key_configured === 'true' ? 'Configured' : 'Not configured'}
              </Badge>
            </div>
            <TextField
              label="Description Generation Prompt"
              value={String(mergedSettings.description_prompt)}
              onChange={(value) => setDraft((prev) => ({ ...prev, description_prompt: value }))}
              multiline={10}
              autoComplete="off"
              helpText="This prompt is sent to the AI when generating product descriptions for new listings."
            />
            <div className="settings-save-bar">
              <Button
                variant="primary"
                onClick={handleSave}
                loading={updateSettings.isPending}
                size="slim"
              >
                Save prompt
              </Button>
            </div>
          </div>
        </section>
      </main>

      {/* Mobile sidebar toggle */}
      <button
        className="settings-mobile-toggle"
        onClick={() => setSidebarOpen((v) => !v)}
        aria-label="Toggle settings navigation"
      >
        ☰
      </button>
    </div>
  );
};

export default Settings;
