/**
 * eBay Listing Prep Page
 *
 * Full-page view shown when the user clicks "Approve & List on eBay".
 * Displays all decisions the system made — editable before listing.
 * Includes a real eBay-style preview of how the listing will look.
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  Page,
  Layout,
  Card,
  Badge,
  Button,
  ButtonGroup,
  Text,
  BlockStack,
  InlineStack,
  Divider,
  Box,
  Spinner,
  TextField,
  Select,
  FormLayout,
  Banner,
  Thumbnail,
  Tooltip,
  Icon,
  Combobox,
  Listbox,
} from '@shopify/polaris';
import {
  ArrowLeftIcon,
  ExternalIcon,
  DeleteIcon,
  PlusIcon,
  RefreshIcon,
} from '@shopify/polaris-icons';
import DraggablePhotoGrid from '../components/DraggablePhotoGrid';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../hooks/useApi';
import { useAppStore } from '../store';
import { getConditionDescription } from '../../config/condition-descriptions';

// ── Types ──────────────────────────────────────────────────────────────

interface EbayListingPreview {
  sku: string;
  title: string;
  description: string;
  condition: string;
  conditionDescription?: string;
  categoryId: string;
  categoryName: string;
  price: string;
  currency: string;
  quantity: number;
  imageUrls: string[];
  brand: string;
  mpn: string;
  aspects: Record<string, string[]>;
  policies: {
    fulfillmentPolicyId: string;
    fulfillmentPolicyName: string;
    paymentPolicyId: string;
    paymentPolicyName: string;
    returnPolicyId: string;
    returnPolicyName: string;
  };
  merchantLocationKey: string;
}

interface DraftDetailResponse {
  draft: {
    id: number;
    shopify_product_id: string;
    draft_title: string | null;
    draft_description: string | null;
    draft_images_json: string | null;
    status: string;
    draftImages: string[];
    ebay_listing_id?: string | null;
    ebay_offer_id?: string | null;
  };
  live: {
    title: string;
    description: string;
    images: string[];
  };
}

// ── Condition options ──────────────────────────────────────────────────

const CONDITION_OPTIONS = [
  { label: 'New', value: 'NEW' },
  { label: 'Like New / New Other', value: 'LIKE_NEW' },
  { label: 'Excellent', value: 'USED_EXCELLENT' },
  { label: 'Very Good', value: 'VERY_GOOD' },
  { label: 'Good', value: 'GOOD' },
  { label: 'Acceptable', value: 'ACCEPTABLE' },
  { label: 'For Parts or Not Working', value: 'FOR_PARTS_OR_NOT_WORKING' },
];

const CONDITION_LABELS: Record<string, string> = {
  NEW: 'New',
  NEW_OTHER: 'New - Other',
  LIKE_NEW: 'Like New',
  USED_EXCELLENT: 'Excellent',
  VERY_GOOD: 'Very Good',
  GOOD: 'Good',
  ACCEPTABLE: 'Acceptable',
  FOR_PARTS_OR_NOT_WORKING: 'For Parts / Not Working',
};

// ── eBay category options ──────────────────────────────────────────────

interface EbayCategoryOption {
  id: string;
  name: string;
  /** "Name (ID)" — displayed in dropdown */
  label: string;
}

const EBAY_CATEGORIES: EbayCategoryOption[] = [
  { id: '31388', name: 'Digital Cameras',              label: 'Digital Cameras (31388)' },
  { id: '3323',  name: 'Camera Lenses',               label: 'Camera Lenses (3323)' },
  { id: '4201',  name: 'Film Photography Film',        label: 'Film Photography Film (4201)' },
  { id: '78997', name: 'Film Photography Cameras',     label: 'Film Photography Cameras (78997)' },
  { id: '183331',name: 'Flashes & Flash Accessories',  label: 'Flashes & Flash Accessories (183331)' },
  { id: '30090', name: 'Tripods & Monopods',           label: 'Tripods & Monopods (30090)' },
  { id: '29982', name: 'Camera Bags & Cases',          label: 'Camera Bags & Cases (29982)' },
  { id: '48446', name: 'Binoculars & Telescopes',      label: 'Binoculars & Telescopes (48446)' },
  { id: '48528', name: 'Camera Filters',               label: 'Camera Filters (48528)' },
  { id: '48444', name: 'Other Camera Accessories',     label: 'Other Camera Accessories (48444)' },
];

/** Given a category ID, return the matching label or the raw ID as fallback */
function getCategoryLabel(categoryId: string): string {
  const match = EBAY_CATEGORIES.find((c) => c.id === categoryId);
  return match ? match.label : categoryId;
}

// ── localStorage helpers ───────────────────────────────────────────────

const STORAGE_KEY = (draftId: number) => `ebay-prep-overrides-${draftId}`;

const loadOverrides = (draftId: number): Partial<EditState> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(draftId));
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
};

const saveOverrides = (draftId: number, overrides: Partial<EditState>) => {
  try {
    localStorage.setItem(STORAGE_KEY(draftId), JSON.stringify(overrides));
  } catch { /* ignore */ }
};

const clearOverrides = (draftId: number) => {
  try {
    localStorage.removeItem(STORAGE_KEY(draftId));
  } catch { /* ignore */ }
};

// ── EditState ──────────────────────────────────────────────────────────

interface EditState {
  title: string;
  price: string;
  categoryId: string;
  condition: string;
  conditionDescription: string;
  aspects: Array<{ key: string; value: string }>;
  description: string;
  imageUrls: string[];
}

// ── eBay-style preview component ───────────────────────────────────────

const EbayPreview: React.FC<{ state: EditState; brand: string; categoryName?: string; policies?: EbayListingPreview['policies'] }> = ({
  state,
  brand,
  categoryName,
  policies,
}) => {
  const [activeImg, setActiveImg] = useState(0);

  const conditionLabel = CONDITION_LABELS[state.condition] || state.condition;
  const priceNum = parseFloat(state.price) || 0;

  return (
    <div
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        overflow: 'hidden',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        background: '#fff',
      }}
    >
      {/* eBay header bar */}
      <div
        style={{
          background: 'linear-gradient(135deg, #e53238 0%, #0064d3 100%)',
          padding: '8px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <span style={{ color: '#fff', fontWeight: 800, fontSize: '20px', letterSpacing: '-0.5px' }}>ebay</span>
        <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: '12px', marginLeft: '8px' }}>Preview — not live yet</span>
      </div>

      {/* Main content */}
      <div style={{ padding: '16px' }}>
        {/* Title */}
        <h2
          style={{
            fontSize: '18px',
            fontWeight: 700,
            color: '#111',
            margin: '0 0 12px 0',
            lineHeight: '1.3',
          }}
        >
          {state.title || 'Untitled Product'}
        </h2>

        {/* Condition badge */}
        <div style={{ marginBottom: '12px' }}>
          <span
            style={{
              display: 'inline-block',
              padding: '2px 8px',
              background: '#f0f7ff',
              color: '#0064d3',
              borderRadius: '4px',
              fontSize: '12px',
              fontWeight: 600,
              border: '1px solid #c8e0ff',
            }}
          >
            Condition: {conditionLabel}
          </span>
        </div>

        {/* Photos + price row */}
        <div style={{ display: 'flex', gap: '20px', marginBottom: '16px' }}>
          {/* Photo gallery */}
          <div style={{ flexShrink: 0, width: '260px' }}>
            {state.imageUrls.length > 0 ? (
              <>
                <div
                  style={{
                    width: '260px',
                    height: '260px',
                    border: '1px solid #e5e7eb',
                    borderRadius: '4px',
                    overflow: 'hidden',
                    background: '#fafafa',
                    marginBottom: '8px',
                  }}
                >
                  <img
                    src={state.imageUrls[activeImg]}
                    alt="Product"
                    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  {state.imageUrls.slice(0, 8).map((url, i) => (
                    <div
                      key={i}
                      onClick={() => setActiveImg(i)}
                      style={{
                        width: '44px',
                        height: '44px',
                        border: `2px solid ${i === activeImg ? '#0064d3' : '#e5e7eb'}`,
                        borderRadius: '3px',
                        overflow: 'hidden',
                        cursor: 'pointer',
                        background: '#fafafa',
                      }}
                    >
                      <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div
                style={{
                  width: '260px',
                  height: '260px',
                  border: '1px dashed #d1d5db',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#9ca3af',
                  fontSize: '14px',
                }}
              >
                No photos
              </div>
            )}
          </div>

          {/* Pricing + seller */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ marginBottom: '8px' }}>
              <div style={{ fontSize: '28px', fontWeight: 700, color: '#111' }}>
                US ${priceNum.toFixed(2)}
              </div>
              <div style={{ fontSize: '12px', color: '#555', marginTop: '2px' }}>
                + Free shipping · Free returns
              </div>
            </div>

            <div style={{ marginTop: '16px', padding: '12px', background: '#f0f9f0', borderRadius: '6px', border: '1px solid #c3e6cb' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a7f37', marginBottom: '4px' }}>Add to cart</div>
              <div style={{ fontSize: '12px', color: '#555' }}>Ships from Salt Lake City, UT</div>
              <div style={{ fontSize: '12px', color: '#555', marginTop: '2px' }}>Seller: usedcam-0 ⭐⭐⭐⭐⭐</div>
            </div>

            {/* Policies summary */}
            {policies && (
              <div style={{ marginTop: '12px', fontSize: '12px', color: '#555' }}>
                <div>✓ Returns accepted</div>
                <div>✓ Secure payments</div>
                <div style={{ color: '#888', marginTop: '4px', fontSize: '11px' }}>
                  {categoryName ? `${categoryName} (${state.categoryId})` : `Category ID: ${state.categoryId}`}
                </div>
              </div>
            )}
          </div>
        </div>

        <Divider />

        {/* Item specifics */}
        {state.aspects.length > 0 && (
          <div style={{ marginTop: '16px' }}>
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#111', marginBottom: '10px' }}>
              Item specifics
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 20px' }}>
              {brand && (
                <React.Fragment key="brand-row">
                  <div style={{ fontSize: '13px', color: '#555' }}>Brand</div>
                  <div style={{ fontSize: '13px', fontWeight: 500, color: '#111' }}>{brand}</div>
                </React.Fragment>
              )}
              {state.aspects.filter((a) => a.key && a.value).map((aspect, i) => (
                <React.Fragment key={i}>
                  <div style={{ fontSize: '13px', color: '#555' }}>{aspect.key}</div>
                  <div style={{ fontSize: '13px', fontWeight: 500, color: '#111' }}>{aspect.value}</div>
                </React.Fragment>
              ))}
            </div>
          </div>
        )}

        {/* Description */}
        {state.description && (
          <>
            <Divider />
            <div style={{ marginTop: '16px' }}>
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#111', marginBottom: '8px' }}>
                Description
              </div>
              <div
                style={{
                  fontSize: '13px',
                  lineHeight: '1.6',
                  color: '#333',
                  maxHeight: '200px',
                  overflow: 'auto',
                  padding: '8px',
                  background: '#fafafa',
                  border: '1px solid #f3f4f6',
                  borderRadius: '4px',
                }}
                dangerouslySetInnerHTML={{ __html: state.description }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ── Aspects Editor ─────────────────────────────────────────────────────

const AspectsEditor: React.FC<{
  aspects: Array<{ key: string; value: string }>;
  onChange: (aspects: Array<{ key: string; value: string }>) => void;
}> = ({ aspects, onChange }) => {
  const updateAspect = (idx: number, field: 'key' | 'value', val: string) => {
    const next = aspects.map((a, i) => (i === idx ? { ...a, [field]: val } : a));
    onChange(next);
  };

  const removeAspect = (idx: number) => {
    onChange(aspects.filter((_, i) => i !== idx));
  };

  const addAspect = () => {
    onChange([...aspects, { key: '', value: '' }]);
  };

  return (
    <BlockStack gap="300">
      {aspects.map((aspect, idx) => (
        <InlineStack key={idx} gap="200" blockAlign="center">
          <div style={{ flex: 1 }}>
            <TextField
              label="Field"
              labelHidden
              placeholder="e.g. Mount Type"
              value={aspect.key}
              onChange={(val) => updateAspect(idx, 'key', val)}
              autoComplete="off"
            />
          </div>
          <div style={{ flex: 1 }}>
            <TextField
              label="Value"
              labelHidden
              placeholder="e.g. Canon EF"
              value={aspect.value}
              onChange={(val) => updateAspect(idx, 'value', val)}
              autoComplete="off"
            />
          </div>
          <Button
            icon={DeleteIcon}
            onClick={() => removeAspect(idx)}
            tone="critical"
            variant="plain"
            accessibilityLabel="Remove aspect"
          />
        </InlineStack>
      ))}
      <Button icon={PlusIcon} onClick={addAspect} variant="plain" size="slim">
        Add Item Specific
      </Button>
    </BlockStack>
  );
};

// ── Photos Editor (replaced by DraggablePhotoGrid) ────────────────────
// PhotosEditor has been removed. DraggablePhotoGrid from
// src/web/components/DraggablePhotoGrid.tsx is used directly in the
// Photos card below. Drag to reorder; × to remove; first photo = MAIN.

// ── Main Component ─────────────────────────────────────────────────────

const EbayListingPrep: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { addNotification } = useAppStore();
  const draftId = parseInt(id || '0');

  const [editState, setEditState] = useState<EditState | null>(null);
  const [brand, setBrand] = useState('');
  const [categoryName, setCategoryName] = useState('');
  const [policies, setPolicies] = useState<EbayListingPreview['policies'] | undefined>(undefined);
  const [showPreview, setShowPreview] = useState(false);
  const [hasSavedOverrides, setHasSavedOverrides] = useState(false);

  // Category combobox state
  const [categoryInputValue, setCategoryInputValue] = useState('');
  const [categoryPopoverActive, setCategoryPopoverActive] = useState(false);

  // ── Load draft data ────────────────────────────────────────────────

  const { data: detailData, isLoading: draftLoading } = useQuery({
    queryKey: ['draft-detail', draftId],
    queryFn: () => apiClient.get<DraftDetailResponse>(`/drafts/${draftId}`),
    enabled: draftId > 0,
  });

  const draft = detailData?.draft;

  // ── Fetch preview data (auto-loads on mount) ────────────────────────

  const previewMutation = useMutation({
    mutationFn: () =>
      apiClient.post<{ success: boolean; preview?: EbayListingPreview; error?: string }>(
        `/drafts/${draftId}/preview-ebay-listing`,
      ),
    onSuccess: (data) => {
      if (data.preview) {
        const preview = data.preview;
        setBrand(preview.brand);
        setCategoryName(preview.categoryName || '');
        setPolicies(preview.policies);

        // Convert aspects from Record to array
        const aspectsArray = Object.entries(preview.aspects).map(([key, vals]) => ({
          key,
          value: Array.isArray(vals) ? vals.join(', ') : String(vals),
        }));

        const initial: EditState = {
          title: preview.title,
          price: preview.price,
          categoryId: preview.categoryId,
          condition: preview.condition,
          conditionDescription: preview.conditionDescription || '',
          aspects: aspectsArray,
          description: preview.description,
          imageUrls: preview.imageUrls,
        };

        // Merge saved overrides from localStorage
        const saved = loadOverrides(draftId);
        const hasSaved = Object.keys(saved).length > 0;
        setHasSavedOverrides(hasSaved);

        if (hasSaved) {
          const merged = { ...initial, ...saved };
          setEditState(merged);
          // Sync category combobox display value
          setCategoryInputValue(getCategoryLabel(merged.categoryId));
        } else {
          setEditState(initial);
          // Sync category combobox display value
          setCategoryInputValue(getCategoryLabel(initial.categoryId));
        }
      } else {
        addNotification({
          type: 'error',
          title: 'Could not load listing preview',
          message: data.error || 'Failed to fetch eBay preview. Check eBay connection in Settings.',
          autoClose: 10000,
        });
      }
    },
    onError: (err) => {
      addNotification({
        type: 'error',
        title: 'Preview error',
        message: err instanceof Error ? err.message : 'Unknown error',
        autoClose: 10000,
      });
    },
  });

  // Auto-load preview on mount
  useEffect(() => {
    if (draftId > 0) {
      previewMutation.mutate();
    }
  }, [draftId]);

  // ── List on eBay ───────────────────────────────────────────────────

  const listOnEbayMutation = useMutation({
    mutationFn: () => {
      if (!editState) throw new Error('No listing data');
      const aspectsRecord: Record<string, string[]> = {};
      editState.aspects.forEach(({ key, value }) => {
        if (key.trim()) aspectsRecord[key.trim()] = value.split(',').map((v) => v.trim()).filter(Boolean);
      });
      return apiClient.post<{ success: boolean; listingId?: string; ebayUrl?: string; error?: string }>(
        `/drafts/${draftId}/list-on-ebay`,
        {
          title: editState.title,
          price: parseFloat(editState.price),
          categoryId: editState.categoryId,
          condition: editState.condition,
          aspects: aspectsRecord,
          description: editState.description,
          imageUrls: editState.imageUrls,
        },
      );
    },
    onSuccess: (data) => {
      if (data.success && data.listingId) {
        clearOverrides(draftId);
        queryClient.invalidateQueries({ queryKey: ['draft-detail', draftId] });
        queryClient.invalidateQueries({ queryKey: ['drafts'] });
        addNotification({
          type: 'success',
          title: '🎉 Listed on eBay!',
          message: `Listing ID: ${data.listingId}`,
          autoClose: 10000,
        });
        navigate(`/review/${draftId}`);
      } else {
        addNotification({
          type: 'error',
          title: 'Listing failed',
          message: data.error || 'Unknown error',
          autoClose: 10000,
        });
      }
    },
    onError: (err) => {
      addNotification({
        type: 'error',
        title: 'Listing failed',
        message: err instanceof Error ? err.message : 'Unknown error',
        autoClose: 10000,
      });
    },
  });

  // ── Save as Draft (saves overrides to localStorage + title/desc to API) ──

  const saveDraftMutation = useMutation({
    mutationFn: () => {
      if (!editState) return Promise.resolve({ success: true });
      return apiClient.put(`/drafts/${draftId}`, {
        title: editState.title,
        description: editState.description,
      });
    },
    onSuccess: () => {
      if (editState) {
        saveOverrides(draftId, {
          price: editState.price,
          categoryId: editState.categoryId,
          condition: editState.condition,
          conditionDescription: editState.conditionDescription,
          aspects: editState.aspects,
          imageUrls: editState.imageUrls,
        });
      }
      queryClient.invalidateQueries({ queryKey: ['draft-detail', draftId] });
      addNotification({ type: 'success', title: 'Draft saved', message: 'Your changes have been saved', autoClose: 4000 });
      navigate(`/review/${draftId}`);
    },
    onError: () => {
      addNotification({ type: 'error', title: 'Save failed', autoClose: 5000 });
    },
  });

  // ── Update helpers ─────────────────────────────────────────────────

  const update = useCallback(<K extends keyof EditState>(key: K, value: EditState[K]) => {
    setEditState((prev) => (prev ? { ...prev, [key]: value } : prev));
  }, []);

  // ── Category combobox ──────────────────────────────────────────────

  /** Options filtered by whatever the user has typed */
  const filteredCategoryOptions = useMemo(() => {
    const q = categoryInputValue.toLowerCase().trim();
    if (!q) return EBAY_CATEGORIES;
    return EBAY_CATEGORIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.id.includes(q) ||
        c.label.toLowerCase().includes(q),
    );
  }, [categoryInputValue]);

  /** User selects an option from the dropdown */
  const handleCategorySelect = useCallback(
    (selectedId: string) => {
      update('categoryId', selectedId);
      const match = EBAY_CATEGORIES.find((c) => c.id === selectedId);
      const display = match ? match.label : selectedId;
      setCategoryInputValue(display);
      setCategoryName(match?.name ?? '');
      setCategoryPopoverActive(false);
    },
    [update],
  );

  /** User types in the combobox text field */
  const handleCategoryInputChange = useCallback(
    (value: string) => {
      setCategoryInputValue(value);
      setCategoryPopoverActive(true);
      // If the typed value looks like a bare numeric ID, store it directly
      if (/^\d+$/.test(value.trim())) {
        update('categoryId', value.trim());
        const match = EBAY_CATEGORIES.find((c) => c.id === value.trim());
        setCategoryName(match?.name ?? '');
      }
    },
    [update],
  );

  // ── Condition auto-populate ────────────────────────────────────────

  /** When condition changes, auto-populate conditionDescription from config */
  const handleConditionChange = useCallback(
    (val: string) => {
      update('condition', val);
      const desc = getConditionDescription(val);
      if (desc) update('conditionDescription', desc);
    },
    [update],
  );

  // ── Loading / Error states ─────────────────────────────────────────

  if (draftLoading) {
    return (
      <Page backAction={{ content: 'Back to Review', url: `/review/${draftId}` }} title="Loading...">
        <div style={{ textAlign: 'center', padding: '4rem' }}>
          <Spinner size="large" />
        </div>
      </Page>
    );
  }

  const isLoading = previewMutation.isPending;
  const pageTitle = draft?.draft_title || `Draft #${draftId}`;
  const charCount = editState?.title.length || 0;

  return (
    <Page
      backAction={{ content: 'Back to Review', url: `/review/${draftId}` }}
      title="Prepare eBay Listing"
      subtitle={pageTitle}
      titleMetadata={
        <Badge tone="attention">Not yet listed</Badge>
      }
      secondaryActions={[
        {
          content: 'Reload from System',
          icon: RefreshIcon,
          onAction: () => previewMutation.mutate(),
          loading: previewMutation.isPending,
          disabled: listOnEbayMutation.isPending,
        },
      ]}
    >
      {isLoading && !editState && (
        <div style={{ textAlign: 'center', padding: '4rem' }}>
          <Spinner size="large" />
          <Text variant="bodySm" as="p" tone="subdued" alignment="center">
            Loading eBay listing data…
          </Text>
        </div>
      )}

      {hasSavedOverrides && editState && !isLoading && (
        <div style={{ marginBottom: '16px' }}>
          <Banner tone="info">
            <p>
              Loaded your previously saved edits. Click "Reload from System" to start fresh with system defaults.
            </p>
          </Banner>
        </div>
      )}

      {editState && (
        <Layout>
          {/* ── Left Column: Editable Fields ──────────────────────── */}
          <Layout.Section>
            <BlockStack gap="400">
            {/* Listing Details Card */}
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">Listing Details</Text>

                <FormLayout>
                  {/* Title */}
                  <TextField
                    label={
                      <InlineStack gap="200" blockAlign="center">
                        <span>eBay Title</span>
                        <Badge tone={charCount > 80 ? 'critical' : charCount > 65 ? 'warning' : 'success'}>
                          {`${charCount}/80`}
                        </Badge>
                      </InlineStack>
                    }
                    value={editState.title}
                    onChange={(val) => update('title', val.slice(0, 80))}
                    maxLength={80}
                    showCharacterCount
                    helpText="eBay allows up to 80 characters. Avoid special characters like ©, ™."
                    autoComplete="off"
                    error={charCount > 80 ? 'Title exceeds 80 character eBay limit' : undefined}
                  />

                  {/* Price */}
                  <TextField
                    label="Price (USD)"
                    type="number"
                    prefix="$"
                    value={editState.price}
                    onChange={(val) => update('price', val)}
                    helpText="Price as it will appear on eBay. Pulled from Shopify."
                    autoComplete="off"
                  />

                  <FormLayout.Group>
                    {/* eBay Category — searchable combobox */}
                    <Combobox
                      activator={
                        <Combobox.TextField
                          label="eBay Category"
                          value={categoryInputValue}
                          onChange={handleCategoryInputChange}
                          onFocus={() => setCategoryPopoverActive(true)}
                          onBlur={() => {
                            // Short delay so a click on an option registers first
                            setTimeout(() => setCategoryPopoverActive(false), 150);
                          }}
                          placeholder="Search or enter category ID…"
                          helpText={
                            categoryName
                              ? `Auto-suggested · type to search, or enter a numeric ID`
                              : 'Type to search categories, or enter a numeric ID'
                          }
                          autoComplete="off"
                        />
                      }
                      allowMultiple={false}
                    >
                      {categoryPopoverActive && filteredCategoryOptions.length > 0 ? (
                        <Listbox onSelect={handleCategorySelect}>
                          {filteredCategoryOptions.map((cat) => (
                            <Listbox.Option
                              key={cat.id}
                              value={cat.id}
                              selected={editState.categoryId === cat.id}
                              accessibilityLabel={cat.label}
                            >
                              <Listbox.TextOption selected={editState.categoryId === cat.id}>
                                {cat.label}
                              </Listbox.TextOption>
                            </Listbox.Option>
                          ))}
                        </Listbox>
                      ) : null}
                    </Combobox>

                    {/* Condition */}
                    <Select
                      label="Condition"
                      options={CONDITION_OPTIONS}
                      value={editState.condition}
                      onChange={handleConditionChange}
                      helpText="Changes auto-populate the condition description below"
                    />
                  </FormLayout.Group>

                  {/* Condition description — auto-populated, still editable */}
                  <TextField
                    label="Condition Description"
                    value={editState.conditionDescription}
                    onChange={(val) => update('conditionDescription', val)}
                    helpText="Auto-filled from Pictureline grade; edit freely. Shown to buyers on eBay."
                    maxLength={1000}
                    multiline={2}
                    autoComplete="off"
                  />
                </FormLayout>
              </BlockStack>
            </Card>

            {/* Item Specifics Card */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text variant="headingMd" as="h2">Item Specifics</Text>
                    <Text variant="bodySm" as="p" tone="subdued">
                      Auto-extracted from product data. Brand "{brand}" is always included.
                    </Text>
                  </BlockStack>
                  <Badge>{`${editState.aspects.length} fields`}</Badge>
                </InlineStack>

                <AspectsEditor
                  aspects={editState.aspects}
                  onChange={(aspects) => update('aspects', aspects)}
                />
              </BlockStack>
            </Card>

            <div style={{ marginTop: '16px' }} />

            {/* Policies Card */}
            {policies && (
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" as="h2">Business Policies</Text>
                  <Text variant="bodySm" as="p" tone="subdued">
                    Policies are set in your eBay seller account and applied automatically.
                  </Text>
                  <div
                    style={{
                      background: '#f9fafb',
                      borderRadius: '8px',
                      padding: '12px 16px',
                      border: '1px solid #e3e5e7',
                    }}
                  >
                    <BlockStack gap="200">
                      <InlineStack align="space-between">
                        <Text variant="bodySm" as="span" tone="subdued">Fulfillment / Shipping</Text>
                        <BlockStack gap="100">
                          <Text variant="bodySm" as="span" fontWeight="semibold">{policies.fulfillmentPolicyName}</Text>
                          <Text variant="bodySm" as="span" tone="subdued">
                            <code style={{ fontSize: '11px', background: '#f3f4f6', padding: '1px 4px', borderRadius: '3px' }}>
                              {policies.fulfillmentPolicyId}
                            </code>
                          </Text>
                        </BlockStack>
                      </InlineStack>
                      <InlineStack align="space-between">
                        <Text variant="bodySm" as="span" tone="subdued">Returns</Text>
                        <BlockStack gap="100">
                          <Text variant="bodySm" as="span" fontWeight="semibold">{policies.returnPolicyName}</Text>
                          <Text variant="bodySm" as="span" tone="subdued">
                            <code style={{ fontSize: '11px', background: '#f3f4f6', padding: '1px 4px', borderRadius: '3px' }}>
                              {policies.returnPolicyId}
                            </code>
                          </Text>
                        </BlockStack>
                      </InlineStack>
                      <InlineStack align="space-between">
                        <Text variant="bodySm" as="span" tone="subdued">Payment</Text>
                        <BlockStack gap="100">
                          <Text variant="bodySm" as="span" fontWeight="semibold">{policies.paymentPolicyName}</Text>
                          <Text variant="bodySm" as="span" tone="subdued">
                            <code style={{ fontSize: '11px', background: '#f3f4f6', padding: '1px 4px', borderRadius: '3px' }}>
                              {policies.paymentPolicyId}
                            </code>
                          </Text>
                        </BlockStack>
                      </InlineStack>
                    </BlockStack>
                  </div>
                  <Text variant="bodySm" as="p" tone="subdued">
                    To change policies, update them in your{' '}
                    <a
                      href="https://www.ebay.com/sh/acc/business-policies"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#0064d3' }}
                    >
                      eBay Business Policies
                    </a>{' '}
                    settings.
                  </Text>
                </BlockStack>
              </Card>
            )}

            <div style={{ marginTop: '16px' }} />

            {/* Photos Card */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text variant="headingMd" as="h2">Photos</Text>
                    <Text variant="bodySm" as="p" tone="subdued">
                      Drag to reorder. First photo (MAIN) is the hero image on eBay. Click ✕ to remove.
                    </Text>
                  </BlockStack>
                  <Badge tone={editState.imageUrls.length === 0 ? 'critical' : 'success'}>
                    {`${editState.imageUrls.length} photo${editState.imageUrls.length !== 1 ? 's' : ''}`}
                  </Badge>
                </InlineStack>

                <DraggablePhotoGrid
                  imageUrls={editState.imageUrls}
                  onChange={(urls) => update('imageUrls', urls)}
                />
              </BlockStack>
            </Card>

            <div style={{ marginTop: '16px' }} />

            {/* Description Card */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="headingMd" as="h2">Description</Text>
                  <Badge>
                    {`${editState.description.length} chars${editState.description.length > 500000 ? ' (⚠️ too long)' : ''}`}
                  </Badge>
                </InlineStack>
                <textarea
                  value={editState.description}
                  onChange={(e) => update('description', e.target.value)}
                  rows={16}
                  style={{
                    width: '100%',
                    padding: '12px',
                    fontSize: '13px',
                    lineHeight: '1.6',
                    borderRadius: '8px',
                    border: '1px solid #c9cccf',
                    fontFamily: 'monospace',
                    resize: 'vertical',
                    boxSizing: 'border-box',
                  }}
                />
                <Text variant="bodySm" as="p" tone="subdued">
                  HTML is supported. This will be the eBay listing description.
                </Text>
              </BlockStack>
            </Card>

            {/* Preview toggle */}
            <div style={{ marginTop: '16px' }}>
              <Button
                onClick={() => setShowPreview((v) => !v)}
                variant="plain"
                size="slim"
              >
                {showPreview ? '▲ Hide eBay Preview' : '▼ Show eBay Preview'}
              </Button>
            </div>

            {showPreview && (
              <div style={{ marginTop: '12px' }}>
                <EbayPreview state={editState} brand={brand} categoryName={categoryName} policies={policies} />
              </div>
            )}

            <div style={{ height: '100px' }} />
            </BlockStack>
          </Layout.Section>

          {/* ── Right Column: eBay Preview + Sticky Actions ──────── */}
          <Layout.Section variant="oneThird">
            {/* Sticky actions */}
            <div
              style={{
                position: 'sticky',
                top: '16px',
                zIndex: 100,
              }}
            >
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" as="h2">Ready to List</Text>

                  {editState.imageUrls.length === 0 && (
                    <Banner tone="critical">
                      <p>⚠️ No photos — eBay requires at least one image.</p>
                    </Banner>
                  )}
                  {editState.title.length === 0 && (
                    <Banner tone="critical">
                      <p>⚠️ Title is required.</p>
                    </Banner>
                  )}

                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text variant="bodySm" as="span" tone="subdued">Title</Text>
                      <Text variant="bodySm" as="span">{charCount}/80 chars</Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text variant="bodySm" as="span" tone="subdued">Price</Text>
                      <Text variant="bodySm" as="span" fontWeight="semibold">${editState.price}</Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text variant="bodySm" as="span" tone="subdued">Condition</Text>
                      <Text variant="bodySm" as="span">{CONDITION_LABELS[editState.condition] || editState.condition}</Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text variant="bodySm" as="span" tone="subdued">Photos</Text>
                      <Text variant="bodySm" as="span">{editState.imageUrls.length} image{editState.imageUrls.length !== 1 ? 's' : ''}</Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text variant="bodySm" as="span" tone="subdued">Category</Text>
                      <Text variant="bodySm" as="span">
                        {categoryName ? `${categoryName} (${editState.categoryId})` : editState.categoryId}
                      </Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text variant="bodySm" as="span" tone="subdued">Item Specifics</Text>
                      <Text variant="bodySm" as="span">{editState.aspects.filter((a) => a.key).length} fields</Text>
                    </InlineStack>
                  </BlockStack>

                  <Divider />

                  <Button
                    variant="primary"
                    size="large"
                    fullWidth
                    onClick={() => listOnEbayMutation.mutate()}
                    loading={listOnEbayMutation.isPending}
                    disabled={
                      editState.imageUrls.length === 0 ||
                      editState.title.length === 0 ||
                      saveDraftMutation.isPending
                    }
                  >
                    🛍️ List on eBay
                  </Button>

                  <Button
                    fullWidth
                    onClick={() => saveDraftMutation.mutate()}
                    loading={saveDraftMutation.isPending}
                    disabled={listOnEbayMutation.isPending}
                  >
                    💾 Save as Draft
                  </Button>

                  <Button
                    fullWidth
                    variant="plain"
                    url={`/review/${draftId}`}
                    disabled={listOnEbayMutation.isPending || saveDraftMutation.isPending}
                  >
                    ← Back without saving
                  </Button>
                </BlockStack>
              </Card>

              <div style={{ marginTop: '16px' }} />

              {/* Compact live preview */}
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text variant="headingMd" as="h2">Preview</Text>
                    <Badge tone="info">Live</Badge>
                  </InlineStack>
                  <EbayPreview state={editState} brand={brand} categoryName={categoryName} policies={policies} />
                </BlockStack>
              </Card>
            </div>
          </Layout.Section>
        </Layout>
      )}
    </Page>
  );
};

export default EbayListingPrep;
