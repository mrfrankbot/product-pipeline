/**
 * Shared API client for CLI → server communication.
 */

const DEFAULT_SERVER_URL = 'http://localhost:3000';

export function getServerUrl(): string {
  return process.env.SERVER_URL || DEFAULT_SERVER_URL;
}

export async function apiGet<T = any>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(path, getServerUrl());
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export async function apiPost<T = any>(path: string, body?: any): Promise<T> {
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
  return res.json() as Promise<T>;
}

export async function apiPut<T = any>(path: string, body?: any): Promise<T> {
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
  return res.json() as Promise<T>;
}

export async function apiDelete<T = any>(path: string): Promise<T> {
  const url = new URL(path, getServerUrl());
  const res = await fetch(url.toString(), { method: 'DELETE' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}
