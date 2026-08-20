// e2e tests run against the Firestore emulator, never a real project.
// Start it first: firebase emulators:start --only firestore
// (see the repo README's "Running tests" section).
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? 'localhost:8080';
process.env.GCP_PROJECT_ID = process.env.GCP_PROJECT_ID ?? 'green-wells-loyalty-test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.SCHEDULER_SHARED_SECRET = 'test-scheduler-secret';
process.env.GCS_BUCKET_NAME = 'green-wells-loyalty-test-files';
