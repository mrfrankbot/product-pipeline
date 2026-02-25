import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Navigation } from '@shopify/polaris';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../hooks/useApi';
import { HomeIcon, ProductIcon, OrderIcon, SettingsIcon, ChartVerticalFilledIcon, ImageIcon, ViewIcon, QuestionCircleIcon, StarIcon, ListBulletedIcon, CategoriesIcon, } from '@shopify/polaris-icons';
const AppNavigation = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const isSelected = (path) => location.pathname === path;
    const { data: draftCount } = useQuery({
        queryKey: ['drafts-count'],
        queryFn: () => apiClient.get('/drafts/count'),
        refetchInterval: 15000,
    });
    return (_jsxs(Navigation, { location: location.pathname, children: [_jsx(Navigation.Section, { items: [
                    {
                        label: 'Dashboard',
                        icon: HomeIcon,
                        selected: isSelected('/'),
                        onClick: () => navigate('/'),
                        url: '/',
                    },
                ] }), _jsx(Navigation.Section, { title: "Shopify", items: [
                    {
                        label: 'Products',
                        icon: ProductIcon,
                        selected: isSelected('/listings') || location.pathname.startsWith('/listings/'),
                        onClick: () => navigate('/listings'),
                        url: '/listings',
                    },
                ] }), _jsx(Navigation.Section, { title: "eBay", items: [
                    {
                        label: 'Listings',
                        icon: ViewIcon,
                        selected: isSelected('/ebay/listings') || location.pathname.startsWith('/ebay/listings/'),
                        onClick: () => navigate('/ebay/listings'),
                        url: '/ebay/listings',
                    },
                    {
                        label: 'Orders',
                        icon: OrderIcon,
                        selected: isSelected('/orders'),
                        onClick: () => navigate('/orders'),
                        url: '/orders',
                    },
                    {
                        label: 'eBay Orders',
                        icon: ListBulletedIcon,
                        selected: isSelected('/ebay-orders'),
                        onClick: () => navigate('/ebay-orders'),
                        url: '/ebay-orders',
                    },
                    {
                        label: 'Mappings',
                        icon: CategoriesIcon,
                        selected: isSelected('/mappings'),
                        onClick: () => navigate('/mappings'),
                        url: '/mappings',
                    },
                ] }), _jsx(Navigation.Section, { title: "Pipeline", items: [
                    {
                        label: 'Overview',
                        icon: ListBulletedIcon,
                        selected: isSelected('/pipeline'),
                        onClick: () => navigate('/pipeline'),
                        url: '/pipeline',
                    },
                    {
                        label: 'Review Queue',
                        icon: ProductIcon,
                        selected: location.pathname.startsWith('/review'),
                        onClick: () => navigate('/review'),
                        url: '/review',
                        badge: draftCount?.count ? String(draftCount.count) : undefined,
                    },
                    {
                        label: 'Images',
                        icon: ImageIcon,
                        selected: isSelected('/images'),
                        onClick: () => navigate('/images'),
                        url: '/images',
                    },
                    {
                        label: 'Category Mapping',
                        icon: CategoriesIcon,
                        selected: isSelected('/category-mapping'),
                        onClick: () => navigate('/category-mapping'),
                        url: '/category-mapping',
                    },
                ] }), _jsx(Navigation.Section, { title: "Settings & Analytics", separator: true, items: [
                    {
                        label: 'Analytics',
                        icon: ChartVerticalFilledIcon,
                        selected: isSelected('/logs'),
                        onClick: () => navigate('/logs'),
                        url: '/logs',
                    },
                    {
                        label: 'Settings',
                        icon: SettingsIcon,
                        selected: isSelected('/settings'),
                        onClick: () => navigate('/settings'),
                        url: '/settings',
                    },
                    {
                        label: 'Help',
                        icon: QuestionCircleIcon,
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
                        icon: StarIcon,
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
                ] })] }));
};
export default AppNavigation;
