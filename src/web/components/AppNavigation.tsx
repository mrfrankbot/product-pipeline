import React from 'react';
import { Navigation } from '@shopify/polaris';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../hooks/useApi';
import {
  Home,
  Package,
  ShoppingCart,
  Settings as SettingsIcon,
  BarChart3,
  GitBranch,
  Image,
  Workflow,
  Store,
  Tag,
} from 'lucide-react';

const AppNavigation: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const isSelected = (path: string) => location.pathname === path;
  const isInSection = (paths: string[]) => paths.some((p) => location.pathname.startsWith(p));

  const { data: draftCount } = useQuery({
    queryKey: ['drafts-count'],
    queryFn: () => apiClient.get<{ count: number }>('/drafts/count'),
    refetchInterval: 15000,
  });

  return (
    <Navigation location={location.pathname}>
      {/* Dashboard — top level */}
      <Navigation.Section
        items={[
          {
            label: 'Dashboard',
            icon: undefined,
            selected: isSelected('/'),
            onClick: () => navigate('/'),
            url: '/',
          },
        ]}
      />

      {/* Shopify section */}
      <Navigation.Section
        title="Shopify"
        items={[
          {
            label: 'Products',
            icon: undefined,
            selected: isSelected('/listings') || location.pathname.startsWith('/listings/'),
            onClick: () => navigate('/listings'),
            url: '/listings',
          },
        ]}
      />

      {/* eBay section */}
      <Navigation.Section
        title="eBay"
        items={[
          {
            label: 'Listings',
            icon: undefined,
            selected: isSelected('/ebay/listings') || location.pathname.startsWith('/ebay/listings/'),
            onClick: () => navigate('/ebay/listings'),
            url: '/ebay/listings',
          },
          {
            label: 'Orders',
            icon: undefined,
            selected: isSelected('/orders'),
            onClick: () => navigate('/orders'),
            url: '/orders',
          },
          {
            label: 'eBay Orders',
            icon: undefined,
            selected: isSelected('/ebay-orders'),
            onClick: () => navigate('/ebay-orders'),
            url: '/ebay-orders',
          },
          {
            label: 'Mappings',
            icon: undefined,
            selected: isSelected('/mappings'),
            onClick: () => navigate('/mappings'),
            url: '/mappings',
          },
        ]}
      />

      {/* Pipeline section */}
      <Navigation.Section
        title="Pipeline"
        items={[
          {
            label: 'Overview',
            icon: undefined,
            selected: isSelected('/pipeline'),
            onClick: () => navigate('/pipeline'),
            url: '/pipeline',
          },
          {
            label: 'Review Queue',
            icon: undefined,
            selected: location.pathname.startsWith('/review'),
            onClick: () => navigate('/review'),
            url: '/review',
            badge: draftCount?.count ? String(draftCount.count) : undefined,
          },
          {
            label: 'Images',
            icon: undefined,
            selected: isSelected('/images'),
            onClick: () => navigate('/images'),
            url: '/images',
          },
          {
            label: 'Category Mapping',
            icon: undefined,
            selected: isSelected('/category-mapping'),
            onClick: () => navigate('/category-mapping'),
            url: '/category-mapping',
          },
        ]}
      />

      {/* Settings & Analytics section */}
      <Navigation.Section
        title="Settings & Analytics"
        separator
        items={[
          {
            label: 'Analytics',
            icon: undefined,
            selected: isSelected('/logs'),
            onClick: () => navigate('/logs'),
            url: '/logs',
          },
          {
            label: 'Settings',
            icon: undefined,
            selected: isSelected('/settings'),
            onClick: () => navigate('/settings'),
            url: '/settings',
          },
          {
            label: 'Help',
            icon: undefined,
            selected: location.pathname.startsWith('/help'),
            onClick: () => navigate('/help'),
            url: '/help',
            subNavigationItems: [
              {
                label: 'Documentation',
                url: '/help',
                onClick: () => navigate('/help'),
              },
              {
                label: 'Ask a Question',
                url: '/help/ask',
                onClick: () => navigate('/help/ask'),
              },
              {
                label: 'Admin',
                url: '/help/admin',
                onClick: () => navigate('/help/admin'),
              },
            ],
          },
          {
            label: 'Feature Requests',
            icon: undefined,
            selected: isSelected('/features') || isSelected('/features/admin'),
            onClick: () => navigate('/features'),
            url: '/features',
            subNavigationItems: [
              {
                label: 'Requests',
                url: '/features',
                onClick: () => navigate('/features'),
              },
              {
                label: 'Admin',
                url: '/features/admin',
                onClick: () => navigate('/features/admin'),
              },
            ],
          },
        ]}
      />
    </Navigation>
  );
};

export default AppNavigation;
