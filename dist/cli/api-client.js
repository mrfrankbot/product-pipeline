/**
 * Shared API client for CLI → server communication.
 */
const DEFAULT_SERVER_URL = 'http://localhost:3000';
export function getServerUrl() {
    return process.env.SERVER_URL || DEFAULT_SERVER_URL;
}
export async function apiGet(path, params) {
    const url = new URL(path, getServerUrl());
    if (params) {
        for (const [k, v] of Object.entries(params)) {
            if (v !== undefined && v !== '')
                url.searchParams.set(k, v);
        }
    }
    const res = await fetch(url.toString());
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`API ${res.status}: ${body}`);
    }
    return res.json();
}
export async function apiPost(path, body) {
    const url = new URL(path, getServerUrl());
    const res = await fetch(url.toString(), {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`API ${res.status}: ${text}`);
    }
    return res.json();
}
export async function apiPut(path, body) {
    const url = new URL(path, getServerUrl());
    const res = await fetch(url.toString(), {
        method: 'PUT',
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`API ${res.status}: ${text}`);
    }
    return res.json();
}
export async function apiDelete(path) {
    const url = new URL(path, getServerUrl());
    const res = await fetch(url.toString(), { method: 'DELETE' });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`API ${res.status}: ${text}`);
    }
    return res.json();
}
