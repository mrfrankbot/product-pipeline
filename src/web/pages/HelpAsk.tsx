import React, { useCallback, useState } from 'react';
import {
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
  FormLayout,
  Icon,
  InlineStack,
  Page,
  Select,
  Text,
} from '@shopify/polaris';
import { QuestionCircleIcon, CheckCircleIcon } from '@shopify/polaris-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../hooks/useApi';

const CATEGORY_OPTIONS = [
  { label: 'Select a category…', value: '' },
  { label: 'Getting Started', value: 'Getting Started' },
  { label: 'Products', value: 'Products' },
  { label: 'Mappings', value: 'Mappings' },
  { label: 'Pipeline', value: 'Pipeline' },
  { label: 'Orders', value: 'Orders' },
  { label: 'Analytics', value: 'Analytics' },
  { label: 'Chat', value: 'Chat' },
  { label: 'General', value: 'General' },
];

const HelpAsk: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [question, setQuestion] = useState('');
  const [category, setCategory] = useState('');
  const [askedBy, setAskedBy] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const submitMutation = useMutation({
    mutationFn: (body: { question: string; asked_by?: string; category?: string }) =>
      apiClient.post('/help/questions', body),
    onSuccess: () => {
      setSubmitted(true);
      queryClient.invalidateQueries({ queryKey: ['help-articles-all'] });
    },
  });

  const handleSubmit = useCallback(() => {
    if (!question.trim()) return;
    submitMutation.mutate({
      question: question.trim(),
      ...(askedBy.trim() ? { asked_by: askedBy.trim() } : {}),
      ...(category ? { category } : {}),
    });
  }, [question, askedBy, category, submitMutation]);

  if (submitted) {
    return (
      <Page
        title="Ask a Question"
        backAction={{ content: 'Help Center', onAction: () => navigate('/help') }}
      >
        <Card>
          <BlockStack gap="400" inlineAlign="center">
            <Box background="bg-fill-success-secondary" borderRadius="full" padding="300">
              <Icon source={CheckCircleIcon} tone="success" />
            </Box>
            <Text variant="headingLg" as="h2">
              Question Submitted!
            </Text>
            <Text as="p" tone="subdued">
              Your question has been received. If our AI can answer it, you'll see it in the
              documentation shortly. Otherwise, an admin will review and respond.
            </Text>
            <InlineStack gap="300">
              <Button onClick={() => navigate('/help')}>Back to Help Center</Button>
              <Button
                variant="primary"
                onClick={() => {
                  setSubmitted(false);
                  setQuestion('');
                  setCategory('');
                  setAskedBy('');
                }}
              >
                Ask Another Question
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      </Page>
    );
  }

  return (
    <Page
      title="Ask a Question"
      subtitle="Can't find what you're looking for? Submit a question."
      backAction={{ content: 'Help Center', onAction: () => navigate('/help') }}
    >
      <BlockStack gap="400">
        {/* Info banner */}
        <Banner tone="info" title="AI-powered answers">
          <Text as="p">
            Submit your question and our AI will try to answer it instantly. Questions may
            also be reviewed by an admin and added to the documentation.
          </Text>
        </Banner>

        <Card>
          <BlockStack gap="400">
            <InlineStack gap="300" blockAlign="center">
              <Box background="bg-fill-secondary" borderRadius="200" padding="200">
                <Icon source={QuestionCircleIcon} />
              </Box>
              <Text variant="headingMd" as="h2">Your question</Text>
            </InlineStack>

            <Divider />

            <FormLayout>
              <FormLayout.Group>
                <div>
                  <Text variant="bodySm" fontWeight="semibold" as="p">
                    Question <span style={{ color: 'var(--p-color-text-critical)' }}>*</span>
                  </Text>
                  <textarea
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="How do I…?"
                    rows={4}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      marginTop: 4,
                      border: '1px solid var(--p-color-border)',
                      borderRadius: 'var(--p-border-radius-200)',
                      fontSize: '0.875rem',
                      fontFamily: 'inherit',
                      resize: 'vertical',
                      lineHeight: 1.5,
                    }}
                  />
                </div>
              </FormLayout.Group>

              <FormLayout.Group>
                <Select
                  label="Category"
                  options={CATEGORY_OPTIONS}
                  value={category}
                  onChange={setCategory}
                />
              </FormLayout.Group>

              <FormLayout.Group>
                <div>
                  <Text variant="bodySm" fontWeight="semibold" as="p">
                    Your name (optional)
                  </Text>
                  <input
                    type="text"
                    value={askedBy}
                    onChange={(e) => setAskedBy(e.target.value)}
                    placeholder="e.g. Jane"
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      marginTop: 4,
                      border: '1px solid var(--p-color-border)',
                      borderRadius: 'var(--p-border-radius-200)',
                      fontSize: '0.875rem',
                      fontFamily: 'inherit',
                    }}
                  />
                </div>
              </FormLayout.Group>
            </FormLayout>

            {submitMutation.isError && (
              <Banner tone="critical" title="Submission failed">
                <Text as="p">
                  {(submitMutation.error as Error)?.message ?? 'Please try again.'}
                </Text>
              </Banner>
            )}

            <InlineStack gap="300">
              <Button
                variant="primary"
                onClick={handleSubmit}
                loading={submitMutation.isPending}
                disabled={!question.trim()}
              >
                Submit Question
              </Button>
              <Button onClick={() => navigate('/help')}>Cancel</Button>
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
};

export default HelpAsk;
