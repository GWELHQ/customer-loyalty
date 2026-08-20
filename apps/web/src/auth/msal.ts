import { PublicClientApplication, type Configuration } from '@azure/msal-browser';
import { env } from '../env';

const msalConfig: Configuration = {
  auth: {
    clientId: env.msEntraClientId,
    authority: `https://login.microsoftonline.com/${env.msEntraTenantId}`,
    redirectUri: env.msEntraRedirectUri,
  },
  cache: {
    cacheLocation: 'sessionStorage',
    storeAuthStateInCookie: false,
  },
};

export const msalInstance = new PublicClientApplication(msalConfig);
export const msalScopes = ['openid', 'profile', 'email'];

// msal-browser v3 requires initialize() to resolve before any other call.
export const msalReady = msalInstance.initialize();
