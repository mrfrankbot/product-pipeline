import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Spinner } from '@shopify/polaris';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useLocation, Outlet } from 'react-router-dom';
import { apiClient } from '../hooks/useApi';
import '../styles/help.css';

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
const CATEGORY_META: Record<string, { icon: string; color: string; description: string; order: number }> = {
  'Getting Started': {
    icon: '🚀',
    color: '#e8f5e9',
    description: 'New here? Start with the basics',
    order: 0,
  },
  Products: {
    icon: '📦',
    color: '#e3f2fd',
    description: 'Managing your Shopify product catalog',
    order: 1,
  },
  Mappings: {
    icon: '🔗',
    color: '#f3e5f5',
    description: 'Configure how Shopify fields map to eBay',
    order: 2,
  },
  Pipeline: {
    icon: '⚡',
    color: '#fff3e0',
    description: 'Automated listing workflow and stages',
    order: 3,
  },
  Orders: {
    icon: '🛒',
    color: '#e8eaf6',
    description: 'Order sync and fulfillment',
    order: 4,
  },
  Analytics: {
    icon: '📊',
    color: '#fce4ec',
    description: 'Reports, logs, and insights',
    order: 5,
  },
  Chat: {
    icon: '💬',
    color: '#e0f7fa',
    description: 'Using the AI assistant',
    order: 6,
  },
  General: {
    icon: '📖',
    color: '#f1f8e9',
    description: 'General usage and tips',
    order: 7,
  },
};

const getCategoryMeta = (name: string) =>
  CATEGORY_META[name] || { icon: '📄', color: '#f5f5f5', description: '', order: 99 };

export const categorySlug = (name: string) => encodeURIComponent(name.toLowerCase().replace(/\s+/g, '-'));
export const categoryFromSlug = (slug: string, categories: string[]) =>
  categories.find((c) => categorySlug(c) === slug) || slug;

/* ── Helpers ────────────────────────────────────────────── */
const stripFormatting = (text: string) => text.replace(/\*\*/g, '').replace(/\n/g, ' ');

const snippet = (text: string, max = 120) => {
  const plain = stripFormatting(text);
  return plain.length > max ? plain.slice(0, max) + '…' : plain;
};

/* ═══════════════════════════════════════════════════════════
   HelpCenter — outer layout with sidebar + <Outlet>
   ═══════════════════════════════════════════════════════════ */
const HelpCenter: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ category?: string; id?: string }>();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
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
      const cat = a.category || 'general';
      if (!catMap.has(cat)) catMap.set(cat, []);
      catMap.get(cat)!.push(a);
    }
    return Array.from(catMap.entries())
      .map(([name, items]) => ({ name, items }))
      .sort((a, b) => getCategoryMeta(a.name).order - getCategoryMeta(b.name).order);
  }, [articles]);

  // Auto-expand the active category
  useEffect(() => {
    if (params.category) {
      const catName = categoryFromSlug(
        params.category,
        categories.map((c) => c.name),
      );
      setExpandedCats((prev) => {
        const next = new Set(prev);
        next.add(catName);
        return next;
      });
    }
    if (params.id) {
      const article = articles.find((a) => a.id === Number(params.id));
      if (article) {
        setExpandedCats((prev) => {
          const next = new Set(prev);
          next.add(article.category || 'general');
          return next;
        });
      }
    }
  }, [params.category, params.id, categories, articles]);

  const toggleCategory = useCallback((name: string) => {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

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

  // Auto-expand all when searching
  useEffect(() => {
    if (sidebarSearch.trim()) {
      setExpandedCats(new Set(filteredCategories.map((c) => c.name)));
    }
  }, [sidebarSearch, filteredCategories]);

  const activeArticleId = params.id ? Number(params.id) : null;

  const goToArticle = useCallback(
    (id: number) => {
      navigate(`/help/article/${id}`);
      setSidebarOpen(false);
    },
    [navigate],
  );

  const goToCategory = useCallback(
    (name: string) => {
      navigate(`/help/category/${categorySlug(name)}`);
      setSidebarOpen(false);
    },
    [navigate],
  );

  const isLanding = location.pathname === '/help';

  return (
    <div className="help-docs">
      {/* Mobile overlay */}
      {sidebarOpen && <div className="help-mobile-overlay" onClick={() => setSidebarOpen(false)} />}

      {/* Sidebar */}
      <aside className={`help-docs-sidebar${sidebarOpen ? ' mobile-open' : ''}`}>
        <div className="help-sidebar-header">
          <span className="help-sidebar-title" onClick={() => navigate('/help')}>
            📚 Documentation
          </span>
        </div>

        <div className="help-sidebar-search">
          <input
            type="text"
            placeholder="Filter articles…"
            value={sidebarSearch}
            onChange={(e) => setSidebarSearch(e.target.value)}
          />
        </div>

        {isLoading ? (
          <div className="help-loading">
            <Spinner size="small" accessibilityLabel="Loading" />
          </div>
        ) : (
          filteredCategories.map((cat) => {
            const meta = getCategoryMeta(cat.name);
            const isExpanded = expandedCats.has(cat.name);
            return (
              <div className="help-sidebar-category" key={cat.name}>
                <button
                  className={`help-sidebar-category-btn${
                    params.category && categoryFromSlug(params.category, categories.map((c) => c.name)) === cat.name
                      ? ' active'
                      : ''
                  }`}
                  onClick={() => toggleCategory(cat.name)}
                >
                  <span>
                    {meta.icon} {cat.name}
                  </span>
                  <span className="help-sidebar-category-count">{cat.items.length}</span>
                  <span className={`help-sidebar-category-chevron${isExpanded ? ' open' : ''}`}>▸</span>
                </button>
                <div
                  className="help-sidebar-articles"
                  style={{ maxHeight: isExpanded ? `${cat.items.length * 34 + 4}px` : '0px' }}
                >
                  {cat.items.map((article) => (
                    <div
                      key={article.id}
                      className={`help-sidebar-article-link${activeArticleId === article.id ? ' active' : ''}`}
                      onClick={() => goToArticle(article.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') goToArticle(article.id);
                      }}
                    >
                      {article.question.length > 40
                        ? article.question.slice(0, 40) + '…'
                        : article.question}
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </aside>

      {/* Main content area */}
      <main className="help-docs-main">
        {isLanding ? (
          <HelpLanding
            articles={articles}
            categories={categories}
            goToArticle={goToArticle}
            goToCategory={goToCategory}
          />
        ) : (
          <Outlet context={{ articles, categories }} />
        )}
      </main>

      {/* Mobile sidebar toggle */}
      <button className="help-mobile-toggle" onClick={() => setSidebarOpen((prev) => !prev)}>
        ☰
      </button>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════
   HelpLanding — hero + search + category cards + popular
   ═══════════════════════════════════════════════════════════ */
interface HelpLandingProps {
  articles: HelpArticle[];
  categories: { name: string; items: HelpArticle[] }[];
  goToArticle: (id: number) => void;
  goToCategory: (name: string) => void;
}

const HelpLanding: React.FC<HelpLandingProps> = ({ articles, categories, goToArticle, goToCategory }) => {
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

  // Popular = first article from each category
  const popular = useMemo(
    () => categories.slice(0, 8).map((c) => c.items[0]).filter(Boolean),
    [categories],
  );

  return (
    <div className="help-landing">
      {/* Hero */}
      <div className="help-hero">
        <h1>How can we help?</h1>
        <p>Search our documentation or browse by category below</p>
        <div className="help-hero-search">
          <span className="help-hero-search-icon">🔍</span>
          <input
            type="text"
            placeholder="Search articles…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Search results */}
      {search.trim() && (
        <div className="help-search-results">
          {searchResults.length === 0 ? (
            <div className="help-empty">
              <h3>No results found</h3>
              <p>Try different keywords or browse the categories below</p>
            </div>
          ) : (
            searchResults.map((a) => (
              <div
                key={a.id}
                className="help-search-result-item"
                onClick={() => goToArticle(a.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') goToArticle(a.id);
                }}
              >
                <p className="help-search-result-category">{a.category || 'general'}</p>
                <p className="help-search-result-title">{a.question}</p>
                <p className="help-search-result-snippet">{snippet(a.answer || '', 150)}</p>
              </div>
            ))
          )}
        </div>
      )}

      {/* Category cards */}
      {!search.trim() && (
        <>
          <div className="help-categories-grid">
            {categories.map((cat) => {
              const meta = getCategoryMeta(cat.name);
              return (
                <div
                  key={cat.name}
                  className="help-category-card"
                  onClick={() => goToCategory(cat.name)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') goToCategory(cat.name);
                  }}
                >
                  <div
                    className="help-category-card-icon"
                    style={{ background: meta.color }}
                  >
                    {meta.icon}
                  </div>
                  <p className="help-category-card-title">{cat.name}</p>
                  {meta.description && (
                    <p className="help-category-card-desc">{meta.description}</p>
                  )}
                  <p className="help-category-card-count">
                    {cat.items.length} article{cat.items.length !== 1 ? 's' : ''}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Popular Articles */}
          {popular.length > 0 && (
            <div className="help-popular-section">
              <h2 className="help-section-title">Popular Articles</h2>
              <div className="help-popular-list">
                {popular.map((a) => (
                  <div
                    key={a.id}
                    className="help-popular-item"
                    onClick={() => goToArticle(a.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') goToArticle(a.id);
                    }}
                  >
                    <span className="help-popular-item-icon">→</span>
                    <span className="help-popular-item-text">{a.question}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default HelpCenter;
