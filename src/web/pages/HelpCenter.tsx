import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
  EmptyState,
  Icon,
  InlineGrid,
  InlineStack,
  Layout,
  Page,
  SkeletonBodyText,
  Text,
  TextField,
} from '@shopify/polaris';
import {
  QuestionCircleIcon,
  SearchIcon,
  ChevronRightIcon,
  ProductIcon,
  OrderIcon,
  ChartLineIcon,
  SettingsIcon,
  ImageIcon,
  ListBulletedIcon,
  AutomationIcon,
  ClipboardChecklistIcon,
} from '@shopify/polaris-icons';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useLocation, Outlet } from 'react-router-dom';
import { apiClient } from '../hooks/useApi';

/* ── Types ──────────────────────────────────────────────── */
export interface HelpArticle {
  id: number;
  question: string;
  answer: string;
  category: string;
  sort_order: number;
  updated_at: string;
}

export interface HelpCategoryInfo {
  name: string;
  slug: string;
  count: number;
  icon: string;
  color: string;
  description: string;
}

/* ── Category metadata ──────────────────────────────────── */
const CATEGORY_META: Record<
  string,
  { icon: React.FC<any>; description: string; order: number }
> = {
  'Getting Started': {
    icon: QuestionCircleIcon,
    description: 'New here? Start with the basics',
    order: 0,
  },
  Products: {
    icon: ProductIcon,
    description: 'Managing your Shopify product catalog',
    order: 1,
  },
  Mappings: {
    icon: ListBulletedIcon,
    description: 'Configure how Shopify fields map to eBay',
    order: 2,
  },
  Pipeline: {
    icon: AutomationIcon,
    description: 'Automated listing workflow and stages',
    order: 3,
  },
  Orders: {
    icon: OrderIcon,
    description: 'Order sync and fulfillment',
    order: 4,
  },
  Analytics: {
    icon: ChartLineIcon,
    description: 'Reports, logs, and insights',
    order: 5,
  },
  Chat: {
    icon: ClipboardChecklistIcon,
    description: 'Using the AI assistant',
    order: 6,
  },
  General: {
    icon: SettingsIcon,
    description: 'General usage and tips',
    order: 7,
  },
};

const getCategoryMeta = (name: string) =>
  CATEGORY_META[name] ?? { icon: QuestionCircleIcon, description: '', order: 99 };

export const categorySlug = (name: string) =>
  encodeURIComponent(name.toLowerCase().replace(/\s+/g, '-'));
export const categoryFromSlug = (slug: string, categories: string[]) =>
  categories.find((c) => categorySlug(c) === slug) || slug;

const snippet = (text: string, max = 120) => {
  const plain = text.replace(/\*\*/g, '').replace(/\n/g, ' ');
  return plain.length > max ? plain.slice(0, max) + '…' : plain;
};

/* ═══════════════════════════════════════════════════════════
   HelpCenter — outer layout with sidebar + <Outlet>
   ═══════════════════════════════════════════════════════════ */
const HelpCenter: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ category?: string; id?: string }>();

  const [sidebarSearch, setSidebarSearch] = useState('');

  // Fetch all published articles
  const { data, isLoading } = useQuery({
    queryKey: ['help-articles-all'],
    queryFn: () => apiClient.get<{ data: HelpArticle[]; total: number }>('/help/faq'),
  });

  const articles = data?.data || [];

  // Derive sorted categories
  const categories = useMemo(() => {
    const catMap = new Map<string, HelpArticle[]>();
    for (const a of articles) {
      const cat = a.category || 'General';
      if (!catMap.has(cat)) catMap.set(cat, []);
      catMap.get(cat)!.push(a);
    }
    return Array.from(catMap.entries())
      .map(([name, items]) => ({ name, items }))
      .sort((a, b) => getCategoryMeta(a.name).order - getCategoryMeta(b.name).order);
  }, [articles]);

  // Filter sidebar articles by search
  const filteredCategories = useMemo(() => {
    if (!sidebarSearch.trim()) return categories;
    const q = sidebarSearch.toLowerCase();
    return categories
      .map((cat) => ({
        ...cat,
        items: cat.items.filter(
          (a) =>
            a.question.toLowerCase().includes(q) ||
            (a.answer && a.answer.toLowerCase().includes(q)),
        ),
      }))
      .filter((cat) => cat.items.length > 0);
  }, [categories, sidebarSearch]);

  const activeArticleId = params.id ? Number(params.id) : null;
  const isLanding = location.pathname === '/help';

  const goToArticle = useCallback(
    (id: number) => navigate(`/help/article/${id}`),
    [navigate],
  );

  const goToCategory = useCallback(
    (name: string) => navigate(`/help/category/${categorySlug(name)}`),
    [navigate],
  );

  return (
    <Page
      title="Help Center"
      subtitle="Documentation, guides, and support"
      primaryAction={{
        content: 'Ask a Question',
        icon: QuestionCircleIcon,
        onAction: () => navigate('/help/ask'),
      }}
      fullWidth
    >
      <Layout>
        {/* Sidebar */}
        <Layout.Section variant="oneThird">
          <BlockStack gap="300">
            <Card>
              <BlockStack gap="300">
                <TextField
                  label=""
                  labelHidden
                  value={sidebarSearch}
                  onChange={setSidebarSearch}
                  placeholder="Filter articles…"
                  prefix={<Icon source={SearchIcon} />}
                  clearButton
                  onClearButtonClick={() => setSidebarSearch('')}
                  autoComplete="off"
                />

                {isLoading ? (
                  <SkeletonBodyText lines={8} />
                ) : (
                  <BlockStack gap="100">
                    <Button
                      variant="plain"
                      fullWidth
                      textAlign="left"
                      onClick={() => navigate('/help')}
                    >
                      <Text
                        variant="bodySm"
                        fontWeight={isLanding ? 'semibold' : 'regular'}
                        tone={isLanding ? undefined : 'subdued'}
                        as="span"
                      >
                        📚 All articles
                      </Text>
                    </Button>

                    <Divider />

                    {filteredCategories.map((cat) => {
                      const meta = getCategoryMeta(cat.name);
                      const isCatActive =
                        params.category &&
                        categoryFromSlug(
                          params.category,
                          categories.map((c) => c.name),
                        ) === cat.name;

                      return (
                        <BlockStack key={cat.name} gap="050">
                          <InlineStack gap="200" blockAlign="center">
                            <Button
                              variant="plain"
                              fullWidth
                              textAlign="left"
                              onClick={() => goToCategory(cat.name)}
                            >
                              <InlineStack gap="200" blockAlign="center">
                                <Icon source={meta.icon} />
                                <Text
                                  variant="bodySm"
                                  fontWeight={isCatActive ? 'semibold' : 'regular'}
                                  as="span"
                                >
                                  {cat.name}
                                </Text>
                                <Badge>{String(cat.items.length)}</Badge>
                              </InlineStack>
                            </Button>
                          </InlineStack>

                          {(isCatActive || sidebarSearch) &&
                            cat.items.map((article) => (
                              <Box key={article.id} paddingInlineStart="600">
                                <Button
                                  variant="plain"
                                  fullWidth
                                  textAlign="left"
                                  onClick={() => goToArticle(article.id)}
                                >
                                  <Text
                                    variant="bodySm"
                                    tone={activeArticleId === article.id ? undefined : 'subdued'}
                                    fontWeight={activeArticleId === article.id ? 'semibold' : 'regular'}
                                    as="span"
                                  >
                                    {article.question.length > 45
                                      ? article.question.slice(0, 45) + '…'
                                      : article.question}
                                  </Text>
                                </Button>
                              </Box>
                            ))}
                        </BlockStack>
                      );
                    })}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        {/* Main content */}
        <Layout.Section>
          {isLanding ? (
            <HelpLanding
              articles={articles}
              categories={categories}
              isLoading={isLoading}
              goToArticle={goToArticle}
              goToCategory={goToCategory}
            />
          ) : (
            <Outlet context={{ articles, categories }} />
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
};

/* ═══════════════════════════════════════════════════════════
   HelpLanding — hero + search + category cards
   ═══════════════════════════════════════════════════════════ */
interface HelpLandingProps {
  articles: HelpArticle[];
  categories: { name: string; items: HelpArticle[] }[];
  isLoading: boolean;
  goToArticle: (id: number) => void;
  goToCategory: (name: string) => void;
}

const HelpLanding: React.FC<HelpLandingProps> = ({
  articles,
  categories,
  isLoading,
  goToArticle,
  goToCategory,
}) => {
  const [search, setSearch] = useState('');

  const searchResults = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.toLowerCase();
    return articles
      .filter(
        (a) =>
          a.question.toLowerCase().includes(q) ||
          (a.answer && a.answer.toLowerCase().includes(q)) ||
          (a.category && a.category.toLowerCase().includes(q)),
      )
      .slice(0, 10);
  }, [search, articles]);

  if (isLoading) {
    return (
      <Card>
        <SkeletonBodyText lines={12} />
      </Card>
    );
  }

  if (articles.length === 0) {
    return (
      <Card>
        <EmptyState heading="No documentation yet" image="">
          <Text as="p">
            No published articles yet. Ask a question to get started!
          </Text>
        </EmptyState>
      </Card>
    );
  }

  return (
    <BlockStack gap="400">
      {/* Search */}
      <Card>
        <BlockStack gap="300">
          <Text variant="headingMd" as="h2">Search documentation</Text>
          <TextField
            label=""
            labelHidden
            value={search}
            onChange={setSearch}
            placeholder="Search articles…"
            prefix={<Icon source={SearchIcon} />}
            clearButton
            onClearButtonClick={() => setSearch('')}
            autoComplete="off"
          />

          {search.trim() && (
            <BlockStack gap="200">
              <Divider />
              {searchResults.length === 0 ? (
                <Box padding="300">
                  <Text tone="subdued" as="p">
                    No results for "{search}". Try different keywords.
                  </Text>
                </Box>
              ) : (
                searchResults.map((a) => (
                  <Box
                    key={a.id}
                    padding="300"
                    background="bg-fill-secondary"
                    borderRadius="200"
                  >
                    <BlockStack gap="100">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text variant="bodyMd" fontWeight="semibold" as="p">
                          {a.question}
                        </Text>
                        <Badge>{a.category || 'General'}</Badge>
                      </InlineStack>
                      <Text variant="bodySm" tone="subdued" as="p">
                        {snippet(a.answer || '', 150)}
                      </Text>
                      <Button
                        variant="plain"
                        onClick={() => goToArticle(a.id)}
                      >
                        Read article →
                      </Button>
                    </BlockStack>
                  </Box>
                ))
              )}
            </BlockStack>
          )}
        </BlockStack>
      </Card>

      {/* Category cards */}
      {!search.trim() && (
        <InlineGrid columns={{ xs: 1, sm: 2, md: 2 }} gap="300">
          {categories.map((cat) => {
            const meta = getCategoryMeta(cat.name);
            return (
              <Card key={cat.name}>
                <BlockStack gap="200">
                  <InlineStack gap="200" blockAlign="center">
                    <Box background="bg-fill-secondary" borderRadius="200" padding="200">
                      <Icon source={meta.icon} />
                    </Box>
                    <BlockStack gap="050">
                      <Text variant="headingSm" as="h3">{cat.name}</Text>
                      <Text variant="bodySm" tone="subdued" as="p">
                        {cat.items.length} article{cat.items.length !== 1 ? 's' : ''}
                      </Text>
                    </BlockStack>
                  </InlineStack>
                  {meta.description && (
                    <Text variant="bodySm" tone="subdued" as="p">
                      {meta.description}
                    </Text>
                  )}
                  <Button variant="secondary" onClick={() => goToCategory(cat.name)}>
                    Browse {cat.name}
                  </Button>
                </BlockStack>
              </Card>
            );
          })}
        </InlineGrid>
      )}
    </BlockStack>
  );
};

export default HelpCenter;
