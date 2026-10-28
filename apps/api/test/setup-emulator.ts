// e2e tests run against the Firestore emulator, never a real project.
// Start it first: firebase emulators:start --only firestore
// (see the repo README's "Running tests" section).
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? 'localhost:8080';
process.env.GCP_PROJECT_ID = process.env.GCP_PROJECT_ID ?? 'green-wells-loyalty-test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.SCHEDULER_SHARED_SECRET = 'test-scheduler-secret';
process.env.GCS_BUCKET_NAME = 'green-wells-loyalty-test-files';
// Hard-set, not `??` — ConfigModule loads apps/api/.env, which may point at
// the live SMS gateway and mailbox, and dotenv never overrides a var that's
// already set. Without this, a test sale would text a real phone number.
process.env.SMS_PROVIDER = 'mock';
process.env.EMAIL_PROVIDER = 'mock';
