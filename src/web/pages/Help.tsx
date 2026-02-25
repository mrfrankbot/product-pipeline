import React, { useCallback, useMemo, useState } from 'react';
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Collapsible,
  Divider,
  EmptyState,
  FormLayout,
  Icon,
  InlineStack,
  Layout,
  Modal,
  Page,
  SkeletonBodyText,
  Select,
  Text,
  TextField,
} from '@shopify/polaris';
import {
  QuestionCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  SearchIcon,
} from '@shopify/polaris-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../hooks/useApi';

interface FaqItem {
  id: number;
  question: string;
  answer: string;
  category: string | null;
  updated_at: string;
}

const Help: React.FC = () => {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['help-faq'],
    queryFn: () => apiClient.get<{ data: FaqItem[]; total: number }>('/help/faq'),
  });

  const [askOpen, setAskOpen] = useState(false);
  const [newQuestion, setNewQuestion] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [askedBy, setAskedBy] = useState('');

  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');

  const toggleExpanded = useCallback((id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const categories = useMemo(() => {
    if (!data?.data) return [];
    const cats = new Set<string>();
    for (const item of data.data) {
      if (item.category) cats.add(item.category);
    }
    return Array.from(cats).sort();
  }, [data]);

  const categoryOptions = useMemo(
    () => [
      { label: 'All categories', value: 'all' },
      ...categories.map((c) => ({ label: c, value: c })),
    ],
    [categories],
  );

  const filteredFaq = useMemo(() => {
    if (!data?.data) return [];
    return data.data.filter((item) => {
      if (filterCategory !== 'all' && item.category !== filterCategory) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          item.question.toLowerCase().includes(q) ||
          (item.answer && item.answer.toLowerCase().includes(q)) ||
          (item.category && item.category.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [data, filterCategory, search]);

  const submitQuestion = useMutation({
    mutationFn: (body: { question: string; asked_by?: string; category?: string }) =>
      apiClient.post('/help/questions', body),
    onSuccess: () => {
      setAskOpen(false);
      setNewQuestion('');
      setNewCategory('');
      setAskedBy('');
      queryClient.invalidateQueries({ queryKey: ['help-faq'] });
    },
  });

  const handleSubmit = useCallback(() => {
    if (!newQuestion.trim()) return;
    submitQuestion.mutate({
      question: newQuestion.trim(),
      ...(askedBy.trim() ? { asked_by: askedBy.trim() } : {}),
      ...(newCategory.trim() ? { category: newCategory.trim() } : {}),
    });
  }, [newQuestion, askedBy, newCategory, submitQuestion]);

  if (error) {
    return (
      <Page title="Help & FAQ">
        <Banner tone="critical" title="Failed to load FAQ">
          <Text as="p">{(error as Error).message}</Text>
        </Banner>
      </Page>
    );
  }

  return (
    <Page
      title="Help & FAQ"
      subtitle="Frequently asked questions and support"
      primaryAction={{
        content: 'Ask a Question',
        icon: QuestionCircleIcon,
        onAction: () => setAskOpen(true),
      }}
    >
      <Layout>
        {/* Search & filter */}
        <Layout.Section>
          <Card>
            <InlineStack gap="400" wrap>
              <Box minWidth="240px">
                <TextField
                  label="Search FAQ"
                  labelHidden
                  value={search}
                  onChange={setSearch}
                  placeholder="Search questions…"
                  prefix={<Icon source={SearchIcon} />}
                  clearButton
                  onClearButtonClick={() => setSearch('')}
                  autoComplete="off"
                />
              </Box>
              {categories.length > 0 && (
                <Box minWidth="200px">
                  <Select
                    label="Category"
                    labelHidden
                    options={categoryOptions}
                    value={filterCategory}
                    onChange={setFilterCategory}
                  />
                </Box>
              )}
            </InlineStack>
          </Card>
        </Layout.Section>

        {/* FAQ items */}
        <Layout.Section>
          {isLoading ? (
            <Card>
              <SkeletonBodyText lines={8} />
            </Card>
          ) : filteredFaq.length === 0 ? (
            <Card>
              <EmptyState heading="No FAQ items found" image="">
                <Text as="p">
                  {search || filterCategory !== 'all'
                    ? 'Try adjusting your search or filter.'
                    : 'No published FAQ items yet. Ask a question to get started!'}
                </Text>
              </EmptyState>
            </Card>
          ) : (
            <Card>
              <BlockStack gap="0">
                {filteredFaq.map((item, index) => {
                  const isOpen = expandedIds.has(item.id);
                  return (
                    <React.Fragment key={item.id}>
                      {index > 0 && <Divider />}
                      <Box padding="400">
                        <BlockStack gap="200">
                          <div
                            onClick={() => toggleExpanded(item.id)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleExpanded(item.id); }}
                            style={{ cursor: 'pointer' }}
                          >
                            <InlineStack align="space-between" blockAlign="center">
                              <InlineStack gap="200" blockAlign="center">
                                <Icon
                                  source={isOpen ? ChevronDownIcon : ChevronRightIcon}
                                  tone="subdued"
                                />
                                <Text variant="headingSm" as="span">
                                  {item.question}
                                </Text>
                              </InlineStack>
                              {item.category && <Badge>{item.category}</Badge>}
                            </InlineStack>
                          </div>

                          <Collapsible open={isOpen} id={`faq-${item.id}`}>
                            <Box paddingInlineStart="600" paddingBlockStart="100">
                              <Text as="p" tone="subdued">
                                {item.answer}
                              </Text>
                            </Box>
                          </Collapsible>
                        </BlockStack>
                      </Box>
                    </React.Fragment>
                  );
                })}
              </BlockStack>
            </Card>
          )}
        </Layout.Section>
      </Layout>

      {/* Ask a Question modal */}
      <Modal
        open={askOpen}
        onClose={() => setAskOpen(false)}
        title="Ask a Question"
        primaryAction={{
          content: 'Submit',
          onAction: handleSubmit,
          loading: submitQuestion.isPending,
          disabled: !newQuestion.trim(),
        }}
        secondaryActions={[{ content: 'Cancel', onAction: () => setAskOpen(false) }]}
      >
        <Modal.Section>
          <FormLayout>
            <TextField
              label="Your question"
              value={newQuestion}
              onChange={setNewQuestion}
              multiline={3}
              autoComplete="off"
              requiredIndicator
              placeholder="How do I…?"
            />
            <TextField
              label="Your name (optional)"
              value={askedBy}
              onChange={setAskedBy}
              autoComplete="off"
            />
            <TextField
              label="Category (optional)"
              value={newCategory}
              onChange={setNewCategory}
              placeholder="e.g. Shipping, Returns, Products"
              autoComplete="off"
            />
          </FormLayout>
        </Modal.Section>
      </Modal>
    </Page>
  );
};

export default Help;
