export interface TimItem {
    id: number;
    submissionId: number;
    productName: string;
    serialNumber: string | null;
    condition: string | null;
    offerPrice: number | null;
    itemStatus: string;
    sellingPrice: number | null;
    category: string | null;
    tags: string | null;
    upc: string | null;
    sku: string | null;
    brand: string | null;
    price: number | null;
    graderNotes: string | null;
    conditionNotes: string | null;
    imageUrls: string[] | null;
    createdAt: string;
    updatedAt: string;
    submission?: {
        id: number;
        status: string;
        createdAt: string;
        recordedByEmployee?: string;
        customer?: {
            name: string;
            email: string;
            phone: string;
        };
    };
}
export declare function fetchTimItems(forceRefresh?: boolean): Promise<TimItem[]>;
export declare function clearTimCache(): void;
