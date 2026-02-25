import React, { useMemo } from 'react';
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
  EmptyState,
  Icon,
  InlineStack,
  Spinner,
  Text,
} from '@shopify/polaris';
import { ChevronRightIcon, QuestionCircleIcon } from '@shopify/polaris-icons';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import type { HelpArticle } from './HelpCenter';
import { categorySlug, categoryFromSlug } from './HelpCenter';

const snippet = (text: string, max = 140) => {
  const plain = text.replace(/\*\*/g, '').replace(/\n/g, ' ');
  return plain.length > max ? plain.slice(0, max) + '…' : plain;
};

interface OutletCtx {
  articles: HelpArticle[];
  categories: { name: string; items: HelpArticle[] }[];
}

const HelpCategoryPage: React.FC = () => {
  const { category: catSlug } = useParams<{ category: string }>();
  const navigate = useNavigate();
  const ctx = useOutletContext<OutletCtx>();
  const articles = ctx?.articles || [];
  const categories = ctx?.categories || [];

  const catName = useMemo(
    () =>
      categoryFromSlug(
        catSlug || '',
        categories.map((c) => c.name),
      ),
    [catSlug, categories],
  );

  const catArticles = useMemo(
    () => articles.filter((a) => (a.category || 'General') === catName),
    [articles, catName],
  );

  if (!articles.length) {
    return (
      <Card>
        <Box padding="600">
          <InlineStack align="center">
            <Spinner size="large" accessibilityLabel="Loading" />
          </InlineStack>
        </Box>
      </Card>
    );
  }

  if (!catArticles.length) {
    return (
      <Card>
        <EmptyState heading="Category not found" image="">
          <Text as="p">No articles found for this category.</Text>
          <Button onClick={() => navigate('/help')}>Back to Help Center</Button>
        </EmptyState>
      </Card>
    );
  }

  return (
    <BlockStack gap="400">
      {/* Breadcrumbs */}
      <InlineStack gap="200" blockAlign="center">
        <Button variant="plain" onClick={() => navigate('/help')}>
          Help
        </Button>
        <Icon source={ChevronRightIcon} tone="subdued" />
        <Text variant="bodySm" tone="subdued" as="span">
          {catName}
        </Text>
      </InlineStack>

      {/* Category header */}
      <Card>
        <BlockStack gap="200">
          <InlineStack gap="200" blockAlign="center">
            <Box background="bg-fill-secondary" borderRadius="200" padding="200">
              <Icon source={QuestionCircleIcon} />
            </Box>
            <BlockStack gap="050">
              <Text variant="headingLg" as="h1">{catName}</Text>
              <Text variant="bodySm" tone="subdued" as="p">
                {catArticles.length} article{catArticles.length !== 1 ? 's' : ''}
              </Text>
            </BlockStack>
          </InlineStack>
        </BlockStack>
      </Card>

      {/* Article list */}
      <Card>
        <BlockStack gap="0">
          {catArticles.map((article, index) => (
            <React.Fragment key={article.id}>
              {index > 0 && <Divider />}
              <div
                onClick={() => navigate(`/help/article/${article.id}`)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/help/article/${article.id}`); }}
                style={{ cursor: 'pointer', padding: 'var(--p-space-400)' }}
              >
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text variant="bodyMd" fontWeight="semibold" as="p">
                      {article.question}
                    </Text>
                    <Text variant="bodySm" tone="subdued" as="p">
                      {snippet(article.answer || '')}
                    </Text>
                  </BlockStack>
                  <Icon source={ChevronRightIcon} tone="subdued" />
                </InlineStack>
              </div>
            </React.Fragment>
          ))}
        </BlockStack>
      </Card>
    </BlockStack>
  );
};

export default HelpCategoryPage;
