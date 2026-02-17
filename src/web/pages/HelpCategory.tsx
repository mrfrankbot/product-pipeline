import React, { useMemo } from 'react';
import { Spinner } from '@shopify/polaris';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import type { HelpArticle } from './HelpCenter';
import { categorySlug, categoryFromSlug } from './HelpCenter';

/* ── Category metadata (duplicated for icons/descriptions) ── */
const CATEGORY_META: Record<string, { icon: string; description: string }> = {
  'Getting Started': {
    icon: '🚀',
    description: 'New to ProductPipeline? Start here with setup guides and first steps.',
  },
  products: {
    icon: '📦',
    description: 'Managing products, syncing to eBay, per-product overrides, and filtering.',
  },
  mappings: {
    icon: '🔗',
    description: 'Configuring field mappings between Shopify and eBay listing fields.',
  },
  pipeline: {
    icon: '⚙️',
    description: 'Auto-listing pipeline stages, image processing, and AI enrichment.',
  },
  orders: {
    icon: '🛒',
    description: 'Order syncing, fulfillment, and order management between platforms.',
  },
  analytics: {
    icon: '📊',
    description: 'Listing health reports, sync analytics, and performance tracking.',
  },
  chat: {
    icon: '💬',
    description: 'Using the AI chat assistant for help and running commands.',
  },
  general: {
    icon: '📖',
    description: 'General information, safety guards, feature requests, and support.',
  },
};

const getMeta = (name: string) =>
  CATEGORY_META[name] || { icon: '📄', description: '' };

const snippet = (text: string, max = 140) => {
  const plain = text.replace(/\*\*/g, '').replace(/\n/g, ' ');
  return plain.length > max ? plain.slice(0, max) + '…' : plain;
};

/* ═══════════════════════════════════════════════════════════
   HelpCategoryPage
   ═══════════════════════════════════════════════════════════ */
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
    () => articles.filter((a) => (a.category || 'general') === catName),
    [articles, catName],
  );

  const meta = getMeta(catName);

  if (!articles.length) {
    return (
      <div className="help-loading">
        <Spinner size="large" accessibilityLabel="Loading" />
      </div>
    );
  }

  if (!catArticles.length) {
    return (
      <div className="help-empty">
        <h3>Category not found</h3>
        <p>No articles found for this category.</p>
      </div>
    );
  }

  return (
    <div className="help-category-page">
      {/* Breadcrumbs */}
      <nav className="help-breadcrumbs">
        <span className="help-breadcrumb-link" onClick={() => navigate('/help')}>
          Help
        </span>
        <span className="help-breadcrumb-sep">›</span>
        <span className="help-breadcrumb-current">{catName}</span>
      </nav>

      {/* Category Header */}
      <div className="help-category-header">
        <h1 className="help-category-title">
          <span>{meta.icon}</span> {catName}
        </h1>
        {meta.description && (
          <p className="help-category-desc">{meta.description}</p>
        )}
      </div>

      {/* Article List */}
      <div className="help-category-articles">
        {catArticles.map((article) => (
          <div
            key={article.id}
            className="help-category-article-card"
            onClick={() => navigate(`/help/article/${article.id}`)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter') navigate(`/help/article/${article.id}`);
            }}
          >
            <p className="help-category-article-title">{article.question}</p>
            <p className="help-category-article-snippet">
              {snippet(article.answer || '')}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default HelpCategoryPage;
