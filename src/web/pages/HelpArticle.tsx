import React, { useCallback, useMemo, useState } from 'react';
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
  Page,
  Spinner,
  Text,
} from '@shopify/polaris';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ThumbsUpIcon,
  ThumbsDownIcon,
  ChevronRightIcon,
} from '@shopify/polaris-icons';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import type { HelpArticle as HelpArticleType } from './HelpCenter';
import { categorySlug } from './HelpCenter';

/* ── Simple markdown-ish renderer ───────────────────────── */
function renderArticleContent(text: string): React.ReactNode {
  if (!text) return null;
  const blocks = text.split(/\n\n+/);
  return blocks.map((block, i) => {
    const trimmed = block.trim();
    if (!trimmed) return null;
    const lines = trimmed.split('\n');
    const isNumberedList = lines.every(
      (l) => /^\d+\.\s/.test(l.trim()) || l.trim() === '',
    );
    const isBulletList = lines.every(
      (l) => /^[-•]\s/.test(l.trim()) || l.trim() === '',
    );
    if (isNumberedList) {
      return (
        <ol key={i} style={{ paddingLeft: 20, margin: '8px 0' }}>
          {lines
            .filter((l) => l.trim())
            .map((l, j) => (
              <li key={j} style={{ marginBottom: 4 }}>
                {renderInline(l.replace(/^\d+\.\s*/, ''))}
              </li>
            ))}
        </ol>
      );
    }
    if (isBulletList) {
      return (
        <ul key={i} style={{ paddingLeft: 20, margin: '8px 0' }}>
          {lines
            .filter((l) => l.trim())
            .map((l, j) => (
              <li key={j} style={{ marginBottom: 4 }}>
                {renderInline(l.replace(/^[-•]\s*/, ''))}
              </li>
            ))}
        </ul>
      );
    }
    return (
      <p key={i} style={{ margin: '8px 0', lineHeight: 1.6 }}>
        {renderInline(trimmed)}
      </p>
    );
  });
}

function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) parts.push(text.slice(lastIdx, match.index));
    parts.push(<strong key={match.index}>{match[1]}</strong>);
    lastIdx = regex.lastIndex;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

/* ═══════════════════════════════════════════════════════════
   HelpArticlePage
   ═══════════════════════════════════════════════════════════ */
interface OutletCtx {
  articles: HelpArticleType[];
  categories: { name: string; items: HelpArticleType[] }[];
}

const HelpArticlePage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const ctx = useOutletContext<OutletCtx>();
  const articles = ctx?.articles || [];
  const categories = ctx?.categories || [];

  const [feedback, setFeedback] = useState<'yes' | 'no' | null>(null);

  const article = useMemo(
    () => articles.find((a) => a.id === Number(id)),
    [articles, id],
  );

  const orderedArticles = useMemo(() => categories.flatMap((c) => c.items), [categories]);

  const currentIndex = useMemo(
    () => orderedArticles.findIndex((a) => a.id === Number(id)),
    [orderedArticles, id],
  );

  const prevArticle = currentIndex > 0 ? orderedArticles[currentIndex - 1] : null;
  const nextArticle =
    currentIndex >= 0 && currentIndex < orderedArticles.length - 1
      ? orderedArticles[currentIndex + 1]
      : null;

  const relatedArticles = useMemo(() => {
    if (!article) return [];
    return articles
      .filter((a) => a.category === article.category && a.id !== article.id)
      .slice(0, 4);
  }, [article, articles]);

  const handleFeedback = useCallback((value: 'yes' | 'no') => {
    setFeedback(value);
  }, []);

  if (!articles.length) {
    return (
      <Card>
        <Box padding="600">
          <InlineStack align="center">
            <Spinner size="large" accessibilityLabel="Loading article" />
          </InlineStack>
        </Box>
      </Card>
    );
  }

  if (!article) {
    return (
      <Card>
        <EmptyState heading="Article not found" image="">
          <Text as="p">This article may have been removed or the link is incorrect.</Text>
          <Button onClick={() => navigate('/help')}>Back to Help Center</Button>
        </EmptyState>
      </Card>
    );
  }

  const catName = article.category || 'General';

  return (
    <BlockStack gap="400">
      {/* Breadcrumbs */}
      <InlineStack gap="200" blockAlign="center">
        <Button variant="plain" onClick={() => navigate('/help')}>
          Help
        </Button>
        <Icon source={ChevronRightIcon} tone="subdued" />
        <Button
          variant="plain"
          onClick={() => navigate(`/help/category/${categorySlug(catName)}`)}
        >
          {catName}
        </Button>
        <Icon source={ChevronRightIcon} tone="subdued" />
        <Text variant="bodySm" tone="subdued" as="span">
          {article.question.length > 40
            ? article.question.slice(0, 40) + '…'
            : article.question}
        </Text>
      </InlineStack>

      {/* Article */}
      <Card>
        <BlockStack gap="400">
          <BlockStack gap="200">
            <InlineStack gap="200" blockAlign="center">
              <Badge>{catName}</Badge>
            </InlineStack>
            <Text variant="headingLg" as="h1">
              {article.question}
            </Text>
            <Text variant="bodySm" tone="subdued" as="p">
              Last updated{' '}
              {new Date(article.updated_at).toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
            </Text>
          </BlockStack>

          <Divider />

          {/* Article body */}
          <Box>
            <div style={{ lineHeight: 1.7, color: 'var(--p-color-text)' }}>
              {renderArticleContent(article.answer || '')}
            </div>
          </Box>

          <Divider />

          {/* Feedback */}
          <Box background="bg-fill-secondary" borderRadius="200" padding="400">
            <BlockStack gap="200" inlineAlign="center">
              <Text variant="bodySm" fontWeight="semibold" as="p">
                Was this article helpful?
              </Text>
              {feedback ? (
                <Text variant="bodySm" tone="success" as="p">
                  Thanks for your feedback!
                </Text>
              ) : (
                <InlineStack gap="300">
                  <Button
                    icon={ThumbsUpIcon}
                    onClick={() => handleFeedback('yes')}
                  >
                    Yes, helpful
                  </Button>
                  <Button
                    icon={ThumbsDownIcon}
                    onClick={() => handleFeedback('no')}
                  >
                    Not really
                  </Button>
                </InlineStack>
              )}
            </BlockStack>
          </Box>
        </BlockStack>
      </Card>

      {/* Related articles */}
      {relatedArticles.length > 0 && (
        <Card>
          <BlockStack gap="300">
            <Text variant="headingMd" as="h3">Related articles</Text>
            <Divider />
            <BlockStack gap="200">
              {relatedArticles.map((a) => (
                <InlineStack key={a.id} align="space-between" blockAlign="center">
                  <Button variant="plain" onClick={() => navigate(`/help/article/${a.id}`)}>
                    {a.question}
                  </Button>
                  <Icon source={ChevronRightIcon} tone="subdued" />
                </InlineStack>
              ))}
            </BlockStack>
          </BlockStack>
        </Card>
      )}

      {/* Prev / Next */}
      <InlineStack align="space-between">
        {prevArticle ? (
          <Button
            icon={ArrowLeftIcon}
            onClick={() => navigate(`/help/article/${prevArticle.id}`)}
          >
            {prevArticle.question.length > 35
              ? prevArticle.question.slice(0, 35) + '…'
              : prevArticle.question}
          </Button>
        ) : (
          <Box />
        )}
        {nextArticle ? (
          <Button
            icon={ArrowRightIcon}
            onClick={() => navigate(`/help/article/${nextArticle.id}`)}
          >
            {nextArticle.question.length > 35
              ? nextArticle.question.slice(0, 35) + '…'
              : nextArticle.question}
          </Button>
        ) : (
          <Box />
        )}
      </InlineStack>
    </BlockStack>
  );
};

export default HelpArticlePage;
