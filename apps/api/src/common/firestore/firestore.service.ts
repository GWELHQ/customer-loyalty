import { existsSync } from 'node:fs';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { App, getApps, initializeApp } from 'firebase-admin/app';
import { Firestore, getFirestore } from 'firebase-admin/firestore';
import type { AppConfig } from '../../config/configuration';

/**
 * Thin wrapper around the Firebase Admin Firestore client. Centralizing
 * this means every module gets the same initialized app/database, and
 * local dev vs Cloud Run credential resolution happens in exactly one place.
 *
 * Credential resolution is Application Default Credentials in both cases:
 * locally it reads the file at GOOGLE_APPLICATION_CREDENTIALS; on Cloud Run
 * it uses the attached runtime service account automatically. No key
 * material is ever read directly in this file.
 */
@Injectable()
export class FirestoreService implements OnModuleInit {
  private readonly logger = new Logger('FirestoreService');
  private app!: App;
  private db!: Firestore;

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  onModuleInit() {
    this.assertCredentialsFileExists();
    const existing = getApps();
    this.app = existing[0] ?? initializeApp({ projectId: this.config.get('gcpProjectId') });
    this.db = getFirestore(this.app, this.config.get('firestoreDatabaseId'));
    // Domain types throughout this codebase use optional fields
    // (`homeStationId?`, `specialRateIdAtSale?`, `metadata?`, an audit
    // event's `actorUserId` for system-triggered events, ...) that are
    // `undefined` rather than omitted or null when unset. Firestore
    // rejects `undefined` field values by default; this makes every write
    // site treat "unset optional field" the same way TypeScript already
    // does, instead of requiring every caller to manually strip undefined
    // keys before every .set()/.add()/.update().
    //
    // getFirestore(app, dbId) caches one instance per (app, databaseId),
    // and settings() may only be called once per instance — guard against
    // a second onModuleInit reusing an already-configured instance (e.g.
    // multiple Nest app instances in the same process during e2e tests).
    try {
      this.db.settings({ ignoreUndefinedProperties: true });
    } catch (err) {
      if (!(err instanceof Error) || !err.message.includes('already been initialized')) throw err;
    }
  }

  /**
   * When GOOGLE_APPLICATION_CREDENTIALS points at a local key file (dev
   * only — Cloud Run leaves it unset and uses the attached service
   * account), firebase-admin reads that file synchronously and crashes the
   * whole process with an opaque ENOENT stack trace if it's missing. This
   * is the single most common first-run stumbling block, so fail with a
   * message that says exactly what to do instead.
   */
  private assertCredentialsFileExists(): void {
    const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!credentialsPath) return; // fine — Cloud Run / emulator / gcloud auth application-default login
    if (existsSync(credentialsPath)) return;

    this.logger.error(
      `GOOGLE_APPLICATION_CREDENTIALS is set to "${credentialsPath}" but that file doesn't exist, so the API ` +
        'cannot start. Download a service account key for your Firebase project ' +
        '(Firebase console → Project settings → Service accounts → Generate new private key), ' +
        `save it at "${credentialsPath}", and restart. Alternatively, unset GOOGLE_APPLICATION_CREDENTIALS in ` +
        '.env and run `gcloud auth application-default login` to use your own gcloud credentials for local dev.',
    );
    process.exit(1);
  }

  get collection() {
    return this.db.collection.bind(this.db);
  }

  get doc() {
    return this.db.doc.bind(this.db);
  }

  get runTransaction() {
    return this.db.runTransaction.bind(this.db);
  }

  batch() {
    return this.db.batch();
  }

  get instance(): Firestore {
    return this.db;
  }
}
