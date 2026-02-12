import React from 'react';
import { Badge, BlockStack, Box, Card, InlineStack, Text } from '@shopify/polaris';

interface MetricCardProps {
  title: string;
  value: number | string;
  trend?: {
    value: number;
    period: string;
  };
  icon?: React.ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'critical';
  loading?: boolean;
  onClick?: () => void;
}

const formatValue = (value: number | string) => {
  if (typeof value === 'number') {
    return value.toLocaleString();
  }
  return value;
};

const MetricCard: React.FC<MetricCardProps> = ({
  title,
  value,
  trend,
  icon,
  tone = 'default',
  loading = false,
  onClick,
}) => {
  return (
    <Card padding="400">
      <div onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>
        <BlockStack gap="200">
          <InlineStack align="space-between">
            <Text tone="subdued" as="p">
              {title}
            </Text>
            {icon}
          </InlineStack>
          <Text variant="headingLg" as="p">
            {loading ? '—' : formatValue(value)}
          </Text>
          {trend && !loading && (
            <InlineStack gap="200" align="center">
              <Badge tone={trend.value >= 0 ? 'success' : 'critical'}>
                {`${trend.value >= 0 ? '+' : ''}${trend.value}%`}
              </Badge>
              <Text tone="subdued" as="span">
                {trend.period}
              </Text>
            </InlineStack>
          )}
          {tone !== 'default' && (
            <Box>
              <Badge tone={tone}>{tone === 'critical' ? 'Needs attention' : tone}</Badge>
            </Box>
          )}
        </BlockStack>
      </div>
    </Card>
  );
};

export default MetricCard;
