export const env = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080/api/v1',
  msEntraTenantId: import.meta.env.VITE_MS_ENTRA_TENANT_ID ?? '',
  msEntraClientId: import.meta.env.VITE_MS_ENTRA_CLIENT_ID ?? '',
  msEntraRedirectUri: import.meta.env.VITE_MS_ENTRA_REDIRECT_URI ?? `${window.location.origin}/auth/microsoft/callback`,
  dataMode: (import.meta.env.VITE_DATA_MODE ?? 'api') as 'api' | 'demo',
};
