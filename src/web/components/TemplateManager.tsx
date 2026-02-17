import React, { useState, useEffect, useCallback } from 'react';
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  ButtonGroup,
  Card,
  Divider,
  InlineStack,
  Modal,
  RangeSlider,
  Text,
  TextField,
} from '@shopify/polaris';
import { useQuery } from '@tanstack/react-query';
import {
  Bookmark,
  Edit3,
  Plus,
  Star,
  Trash2,
  Image as ImageIcon,
  Palette,
  Layers,
  Copy,
} from 'lucide-react';

/* ── Types ────────────────────────────────────────────────────────────── */

interface PhotoRoomParams {
  background: string;
  padding: number;
  shadow: boolean;
}

interface PhotoTemplate {
  id: number;
  name: string;
  category: string | null;
  params: PhotoRoomParams;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

interface CategoriesResponse {
  ok: boolean;
  categories: string[];
  mounted: boolean;
}

interface TemplateManagerProps {
  /** If provided, the "Apply" button will use this product ID */
  productId?: string;
  /** Called after a template is applied to a product */
  onApplied?: (templateId: number) => void;
  /** Initial category to pre-fill when creating new templates */
  initialCategory?: string;
}

/* ── Color presets ────────────────────────────────────────────────────── */

const COLOR_PRESETS = [
  { hex: '#FFFFFF', label: 'White' },
  { hex: '#F5F5F5', label: 'Light Gray' },
  { hex: '#E0E0E0', label: 'Gray' },
  { hex: '#000000', label: 'Black' },
  { hex: '#E8F0FE', label: 'Light Blue' },
  { hex: '#FFF9E6', label: 'Cream' },
];

/* ── Preview Box ──────────────────────────────────────────────────────── */

const TemplatePreview: React.FC<{ params: PhotoRoomParams }> = ({ params }) => {
  return (
    <div
      style={{
        width: 80,
        height: 80,
        backgroundColor: params.background,
        borderRadius: 8,
        border: '1px solid #e5e7eb',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Inner box representing the product (with padding) */}
      <div
        style={{
          width: `${Math.max(20, 80 - params.padding * 160)}px`,
          height: `${Math.max(20, 80 - params.padding * 160)}px`,
          backgroundColor: '#9ca3af',
          borderRadius: 4,
          boxShadow: params.shadow ? '0 4px 8px rgba(0,0,0,0.2)' : 'none',
        }}
      />
    </div>
  );
};

/* ── Template Card ────────────────────────────────────────────────────── */

const TemplateCard: React.FC<{
  template: PhotoTemplate;
  productId?: string;
  onEdit: (template: PhotoTemplate) => void;
  onDelete: (id: number) => void;
  onApply: (template: PhotoTemplate) => void;
  onSetDefault: (template: PhotoTemplate) => void;
  applying: number | null;
}> = ({ template, productId, onEdit, onDelete, onApply, onSetDefault, applying }) => {
  return (
    <Card padding="300">
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="start">
          <InlineStack gap="300" blockAlign="center">
            <TemplatePreview params={template.params} />
            <BlockStack gap="100">
              <InlineStack gap="200" blockAlign="center">
                <Text variant="headingSm" as="h3">
                  {template.name}
                </Text>
                {template.isDefault && (
                  <Badge tone="success">⭐ Default</Badge>
                )}
              </InlineStack>
              {template.category && (
                <Text variant="bodySm" tone="subdued" as="p">
                  Category: {template.category}
                </Text>
              )}
              <InlineStack gap="200">
                <Text variant="bodySm" tone="subdued" as="span">
                  BG: {template.params.background}
                </Text>
                <Text variant="bodySm" tone="subdued" as="span">
                  Padding: {Math.round(template.params.padding * 100)}%
                </Text>
                <Text variant="bodySm" tone="subdued" as="span">
                  Shadow: {template.params.shadow ? 'On' : 'Off'}
                </Text>
              </InlineStack>
            </BlockStack>
          </InlineStack>
        </InlineStack>

        <Divider />

        <InlineStack gap="200">
          {productId && (
            <Button
              size="slim"
              variant="primary"
              loading={applying === template.id}
              onClick={() => onApply(template)}
              icon={<ImageIcon size={14} />}
            >
              Apply
            </Button>
          )}
          <Button size="slim" onClick={() => onEdit(template)} icon={<Edit3 size={14} />}>
            Edit
          </Button>
          {!template.isDefault && template.category && (
            <Button
              size="slim"
              onClick={() => onSetDefault(template)}
              icon={<Star size={14} />}
            >
              Set Default
            </Button>
          )}
          <Button
            size="slim"
            tone="critical"
            onClick={() => onDelete(template.id)}
            icon={<Trash2 size={14} />}
          >
            Delete
          </Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
};

/* ── Template Form Modal ──────────────────────────────────────────────── */

const TemplateFormModal: React.FC<{
  open: boolean;
  editingTemplate: PhotoTemplate | null;
  onClose: () => void;
  onSave: (data: {
    name: string;
    category: string;
    params: PhotoRoomParams;
    isDefault: boolean;
  }) => void;
  saving: boolean;
  initialCategory?: string;
}> = ({ open, editingTemplate, onClose, onSave, saving, initialCategory }) => {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [background, setBackground] = useState('#FFFFFF');
  const [padding, setPadding] = useState(10);
  const [shadow, setShadow] = useState(true);
  const [isDefault, setIsDefault] = useState(false);

  // Fetch categories for combobox
  const { data: categoriesData } = useQuery<CategoriesResponse>({
    queryKey: ['template-categories'],
    queryFn: async () => {
      const response = await fetch('/api/templates/categories');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.json();
    },
  });

  const availableCategories = categoriesData?.categories || [];

  useEffect(() => {
    if (editingTemplate) {
      setName(editingTemplate.name);
      setCategory(editingTemplate.category ?? '');
      setBackground(editingTemplate.params.background);
      setPadding(Math.round(editingTemplate.params.padding * 100));
      setShadow(editingTemplate.params.shadow);
      setIsDefault(editingTemplate.isDefault);
    } else {
      setName('');
      setCategory(initialCategory ?? '');
      setBackground('#FFFFFF');
      setPadding(10);
      setShadow(true);
      setIsDefault(false);
    }
  }, [editingTemplate, open, initialCategory]);

  const handleSave = () => {
    onSave({
      name,
      category,
      params: { background, padding: padding / 100, shadow },
      isDefault,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editingTemplate ? `Edit Template: ${editingTemplate.name}` : 'Create New Template'}
      primaryAction={{
        content: editingTemplate ? 'Save Changes' : 'Create Template',
        onAction: handleSave,
        loading: saving,
        disabled: !name.trim(),
      }}
      secondaryActions={[{ content: 'Cancel', onAction: onClose }]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          <TextField
            label="Template Name"
            value={name}
            onChange={setName}
            autoComplete="off"
            placeholder="e.g. Small Lenses"
          />

          <TextField
            label="Category (StyleShoots Preset)"
            value={category}
            onChange={setCategory}
            autoComplete="off"
            placeholder="Select or type a category..."
            helpText={
              availableCategories.length > 0 
                ? `Available categories: ${availableCategories.join(', ')}. Maps to a StyleShoots preset folder name for auto-apply.`
                : "Maps to a StyleShoots preset folder name for auto-apply"
            }
          />

          <Divider />

          {/* Background */}
          <BlockStack gap="200">
            <InlineStack gap="100" blockAlign="center">
              <Palette size={16} color="#6b7280" />
              <Text variant="bodyMd" fontWeight="semibold" as="span">
                Background Color
              </Text>
            </InlineStack>
            <InlineStack gap="200" wrap>
              {COLOR_PRESETS.map((preset) => (
                <button
                  key={preset.hex}
                  onClick={() => setBackground(preset.hex)}
                  title={preset.label}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 6,
                    border:
                      background === preset.hex
                        ? '2px solid #2563eb'
                        : '2px solid #e5e7eb',
                    backgroundColor: preset.hex,
                    cursor: 'pointer',
                    padding: 0,
                    position: 'relative',
                  }}
                >
                  {background === preset.hex && (
                    <span
                      style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: preset.hex === '#000000' ? '#fff' : '#2563eb',
                        fontWeight: 700,
                        fontSize: 14,
                      }}
                    >
                      ✓
                    </span>
                  )}
                </button>
              ))}
            </InlineStack>
            <Text variant="bodySm" tone="subdued" as="p">
              Selected: {background}
            </Text>
          </BlockStack>

          {/* Padding */}
          <BlockStack gap="200">
            <InlineStack gap="100" blockAlign="center">
              <Layers size={16} color="#6b7280" />
              <Text variant="bodyMd" fontWeight="semibold" as="span">
                Padding
              </Text>
              <Text variant="bodySm" tone="subdued" as="span">
                {padding}%
              </Text>
            </InlineStack>
            <RangeSlider
              label=""
              value={padding}
              min={0}
              max={50}
              step={1}
              onChange={(val) => setPadding(typeof val === 'number' ? val : val[0])}
              output
            />
          </BlockStack>

          {/* Shadow */}
          <InlineStack align="space-between" blockAlign="center">
            <Text variant="bodyMd" fontWeight="semibold" as="span">
              Drop Shadow
            </Text>
            <button
              onClick={() => setShadow(!shadow)}
              style={{
                position: 'relative',
                width: 44,
                height: 24,
                borderRadius: 12,
                border: 'none',
                backgroundColor: shadow ? '#2563eb' : '#d1d5db',
                cursor: 'pointer',
                transition: 'background-color 200ms',
                padding: 0,
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  top: 2,
                  left: shadow ? 22 : 2,
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  backgroundColor: '#fff',
                  transition: 'left 200ms',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                }}
              />
            </button>
          </InlineStack>

          {/* Default toggle */}
          {category && (
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="050">
                <Text variant="bodyMd" fontWeight="semibold" as="span">
                  Set as Default
                </Text>
                <Text variant="bodySm" tone="subdued" as="p">
                  Auto-apply when photos arrive in "{category}"
                </Text>
              </BlockStack>
              <button
                onClick={() => setIsDefault(!isDefault)}
                style={{
                  position: 'relative',
                  width: 44,
                  height: 24,
                  borderRadius: 12,
                  border: 'none',
                  backgroundColor: isDefault ? '#f59e0b' : '#d1d5db',
                  cursor: 'pointer',
                  transition: 'background-color 200ms',
                  padding: 0,
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    top: 2,
                    left: isDefault ? 22 : 2,
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    backgroundColor: '#fff',
                    transition: 'left 200ms',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                  }}
                />
              </button>
            </InlineStack>
          )}

          {/* Preview */}
          <Box padding="300" background="bg-surface-secondary" borderRadius="200">
            <InlineStack gap="300" blockAlign="center">
              <TemplatePreview params={{ background, padding: padding / 100, shadow }} />
              <BlockStack gap="100">
                <Text variant="bodySm" fontWeight="semibold" as="span">
                  Preview
                </Text>
                <Text variant="bodySm" tone="subdued" as="p">
                  Background: {background} · Padding: {padding}% · Shadow: {shadow ? 'On' : 'Off'}
                </Text>
              </BlockStack>
            </InlineStack>
          </Box>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
};

/* ── Main Component ───────────────────────────────────────────────────── */

const TemplateManager: React.FC<TemplateManagerProps> = ({ productId, onApplied, initialCategory }) => {
  const [templates, setTemplates] = useState<PhotoTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<PhotoTemplate | null>(null);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState<number | null>(null);

  const fetchTemplates = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/templates');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTemplates(data.templates || []);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const handleCreate = () => {
    setEditingTemplate(null);
    setModalOpen(true);
  };

  const handleEdit = (template: PhotoTemplate) => {
    setEditingTemplate(template);
    setModalOpen(true);
  };

  const handleSave = async (data: {
    name: string;
    category: string;
    params: PhotoRoomParams;
    isDefault: boolean;
  }) => {
    setSaving(true);
    try {
      const url = editingTemplate
        ? `/api/templates/${editingTemplate.id}`
        : '/api/templates';
      const method = editingTemplate ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.name,
          category: data.category || null,
          params: data.params,
          isDefault: data.isDefault,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      setModalOpen(false);
      await fetchTemplates();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this template?')) return;
    try {
      const res = await fetch(`/api/templates/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchTemplates();
    } catch (err) {
      setError(String(err));
    }
  };

  const handleApply = async (template: PhotoTemplate) => {
    if (!productId) return;
    setApplying(template.id);
    try {
      const res = await fetch(`/api/templates/${template.id}/apply/${productId}`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      onApplied?.(template.id);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setApplying(null);
    }
  };

  const handleSetDefault = async (template: PhotoTemplate) => {
    if (!template.category) return;
    try {
      const res = await fetch(`/api/templates/${template.id}/set-default`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: template.category }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchTemplates();
    } catch (err) {
      setError(String(err));
    }
  };

  if (loading) {
    return (
      <Card>
        <Box padding="400">
          <Text tone="subdued" as="p">
            Loading templates…
          </Text>
        </Box>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="center">
            <BlockStack gap="050">
              <Text variant="headingMd" as="h2">
                Photo Templates
              </Text>
              <Text variant="bodySm" tone="subdued" as="p">
                Reusable PhotoRoom settings for consistent photo processing
              </Text>
            </BlockStack>
            <Button variant="primary" onClick={handleCreate} icon={<Plus size={16} />}>
              New Template
            </Button>
          </InlineStack>

          {error && (
            <Banner tone="critical" onDismiss={() => setError(null)}>
              <p>{error}</p>
            </Banner>
          )}

          {templates.length === 0 ? (
            <Box padding="400">
              <BlockStack gap="200" inlineAlign="center">
                <Bookmark size={48} color="#9ca3af" />
                <Text tone="subdued" as="p" alignment="center">
                  No templates yet. Create one to save reusable photo settings.
                </Text>
                <Text variant="bodySm" tone="subdued" as="p" alignment="center">
                  Or use the chat: "Save current settings as Small Lenses template"
                </Text>
              </BlockStack>
            </Box>
          ) : (
            <BlockStack gap="300">
              {templates.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  productId={productId}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  onApply={handleApply}
                  onSetDefault={handleSetDefault}
                  applying={applying}
                />
              ))}
            </BlockStack>
          )}
        </BlockStack>
      </Card>

      <TemplateFormModal
        open={modalOpen}
        editingTemplate={editingTemplate}
        onClose={() => setModalOpen(false)}
        onSave={handleSave}
        saving={saving}
        initialCategory={initialCategory}
      />
    </>
  );
};

export default TemplateManager;
