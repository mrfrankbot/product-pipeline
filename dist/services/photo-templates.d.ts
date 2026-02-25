/**
 * Photo Templates Service — Phase 3
 *
 * Templates are named sets of PhotoRoom params { background, padding, shadow }.
 * Each template optionally maps to a StyleShoots preset category so the
 * watcher can auto-apply the right settings when a new product folder appears.
 *
 * DB table: photo_templates
 */
export interface PhotoRoomParams {
    background: string;
    padding: number;
    shadow: boolean;
}
export interface PhotoTemplate {
    id: number;
    name: string;
    category: string | null;
    params: PhotoRoomParams;
    isDefault: boolean;
    createdAt: string;
    updatedAt: string;
}
export declare function initPhotoTemplatesTable(): Promise<void>;
export declare function createTemplate(name: string, params: PhotoRoomParams, category?: string | null, isDefault?: boolean): Promise<PhotoTemplate>;
export declare function getTemplate(id: number): Promise<PhotoTemplate | null>;
export declare function getTemplateByName(name: string): Promise<PhotoTemplate | null>;
export declare function listTemplates(category?: string): Promise<PhotoTemplate[]>;
export declare function updateTemplate(id: number, updates: {
    name?: string;
    category?: string | null;
    params?: Partial<PhotoRoomParams>;
    isDefault?: boolean;
}): Promise<PhotoTemplate | null>;
export declare function deleteTemplate(id: number): Promise<boolean>;
export declare function getDefaultForCategory(category: string): Promise<PhotoTemplate | null>;
export declare function setDefaultForCategory(templateId: number, category: string): Promise<PhotoTemplate | null>;
/**
 * Find or create a template by name. Used by the chat to upsert.
 */
export declare function upsertTemplate(name: string, params: PhotoRoomParams, category?: string | null, isDefault?: boolean): Promise<PhotoTemplate>;
