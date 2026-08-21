export interface AppConfig {
  nodeEnv: string;
  port: number;
  corsOrigin: string;
  gcpProjectId: string;
  firestoreDatabaseId: string;
  gcsBucketName: string;
  msEntra: {
    tenantId: string;
    clientId: string;
    redirectUri: string;
  };
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessTtl: string;
    refreshTtl: string;
    attendantTtl: string;
  };
  sms: {
    provider: string;
    africastalking: {
      username: string;
      apiKey: string;
      baseUrl: string;
      senderId: string;
    };
  };
  schedulerSharedSecret: string;
}

export default (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 8080),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  gcpProjectId: process.env.GCP_PROJECT_ID ?? '',
  firestoreDatabaseId: process.env.FIRESTORE_DATABASE_ID ?? '(default)',
  gcsBucketName: process.env.GCS_BUCKET_NAME ?? '',
  msEntra: {
    tenantId: process.env.MS_ENTRA_TENANT_ID ?? '',
    clientId: process.env.MS_ENTRA_CLIENT_ID ?? '',
    redirectUri: process.env.MS_ENTRA_REDIRECT_URI ?? '',
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? '',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? '',
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL ?? '7d',
    attendantTtl: process.env.ATTENDANT_JWT_TTL ?? '12h',
  },
  sms: {
    provider: process.env.SMS_PROVIDER ?? 'mock',
    africastalking: {
      username: process.env.AFRICASTALKING_USERNAME ?? '',
      apiKey: process.env.AFRICASTALKING_API_KEY ?? '',
      baseUrl: process.env.AFRICASTALKING_BASE_URL ?? 'https://api.africastalking.com',
      senderId: process.env.AFRICASTALKING_SENDER_ID ?? '',
    },
  },
  schedulerSharedSecret: process.env.SCHEDULER_SHARED_SECRET ?? '',
});
