import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import {
  ImportRowResult,
  ImportStatus,
  normalizePhoneNumber,
  type Customer,
  type ImportJob,
  type ImportRow,
} from '@loyalty/shared';
import { FirestoreService } from '../common/firestore/firestore.service';
import { fromDoc, nowIso } from '../common/firestore/helpers';
import { StorageService } from '../common/storage/storage.service';
import type { StaffPrincipal } from '../common/types/principal';
import { StationsService } from '../stations/stations.service';
import { CustomersService } from './customers.service';

const JOBS_COLLECTION = 'imports';
const MAX_ROWS = 5000;

const HEADER_ALIASES: Record<string, keyof MappedRow> = {
  'customer name': 'fullName',
  name: 'fullName',
  'full name': 'fullName',
  'phone number': 'phoneNumber',
  phone: 'phoneNumber',
  mobile: 'phoneNumber',
  'home station': 'homeStationId',
  station: 'homeStationId',
  'date first registered': 'registeredDate',
  'registered date': 'registeredDate',
};

interface MappedRow {
  fullName?: string;
  phoneNumber?: string;
  homeStationId?: string;
  registeredDate?: string;
}

export type DuplicateAction = 'skip' | 'merge';

@Injectable()
export class CustomerImportsService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly storage: StorageService,
    private readonly customers: CustomersService,
    private readonly stations: StationsService,
  ) {}

  private jobsCol() {
    return this.firestore.collection(JOBS_COLLECTION);
  }
  private rowsCol(jobId: string) {
    return this.jobsCol().doc(jobId).collection('rows');
  }

  /**
   * Parses the uploaded workbook, auto-maps recognized headers, classifies
   * every row (would-create / duplicate-of-existing / rejected), and
   * persists the job + row previews. Nothing is written to the customers
   * collection yet — that only happens on confirm().
   */
  async uploadAndPreview(
    file: { originalname: string; buffer: Buffer; mimetype: string },
    homeStationId: string,
    uploadedBy: StaffPrincipal,
  ): Promise<ImportJob> {
    const station = await this.stations.findById(homeStationId);
    if (!station) throw new BadRequestException('Selected branch was not found');

    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(file.buffer, { type: 'buffer' });
    } catch {
      throw new BadRequestException(
        'Could not read this file as a spreadsheet. Re-save it as .xlsx from Excel/Google Sheets, or upload .csv, and try again.',
      );
    }
    const sheet = workbook.Sheets[workbook.SheetNames[0]!];
    if (!sheet) throw new BadRequestException('The file has no readable sheet');

    const rows: Record<string, string>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    if (rows.length === 0) throw new BadRequestException('The file has no data rows');
    if (rows.length > MAX_ROWS) {
      throw new BadRequestException(`File has ${rows.length} rows; maximum is ${MAX_ROWS}`);
    }

    const headers = Object.keys(rows[0]!);
    const columnMapping = this.autoMapColumns(headers);
    if (!Object.values(columnMapping).includes('fullName') || !Object.values(columnMapping).includes('phoneNumber')) {
      throw new BadRequestException(
        'Could not find required columns "Customer name" and "Phone number" in the file',
      );
    }

    const gcsFilePath = await this.storage.uploadBuffer('imports', file.originalname, file.buffer, file.mimetype);

    const now = nowIso();
    const jobDoc: Omit<ImportJob, 'id'> = {
      fileName: file.originalname,
      gcsFilePath,
      status: ImportStatus.PREVIEWED,
      totalRows: rows.length,
      createdCount: 0,
      duplicateCount: 0,
      rejectedCount: 0,
      uploadedByUserId: uploadedBy.userId,
      uploadedByName: uploadedBy.fullName,
      columnMapping,
      allHeaders: headers,
      homeStationId: station.id,
      homeStationName: station.name,
      createdAt: now,
      updatedAt: now,
    };
    const jobRef = await this.jobsCol().add(jobDoc);

    const classified = await this.classifyRows(rows, columnMapping, station.id);
    await this.writeRows(jobRef.id, classified);

    const counts = this.summarize(classified);
    await jobRef.update({ ...counts, updatedAt: nowIso() });

    return { ...jobDoc, ...counts, id: jobRef.id };
  }

  private autoMapColumns(headers: string[]): Record<string, string> {
    const mapping: Record<string, string> = {};
    for (const header of headers) {
      const key = header.trim().toLowerCase();
      const field = HEADER_ALIASES[key];
      if (field) mapping[header] = field;
    }
    return mapping;
  }

  private async classifyRows(
    rows: Record<string, string>[],
    columnMapping: Record<string, string>,
    homeStationId: string,
  ): Promise<ImportRow[]> {
    const seenInFile = new Set<string>();
    const results: ImportRow[] = new Array(rows.length);
    const pending: { index: number; rowNumber: number; rawData: Record<string, string>; normalizedPhone: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i]!;
      const mapped: MappedRow = {};
      for (const [column, field] of Object.entries(columnMapping)) {
        (mapped as Record<string, string>)[field] = String(raw[column] ?? '').trim();
      }
      // Every row belongs to the branch selected for this whole import
      // batch, not whatever (if anything) a "Home station" column says —
      // batches are uploaded per-branch, so the picker is authoritative.
      const rawData = { ...raw, __mappedFullName: mapped.fullName ?? '', __mappedHomeStationId: homeStationId };

      const rowNumber = i + 2; // account for header row, 1-indexed
      if (!mapped.fullName) {
        results[i] = { rowNumber, rawData, result: ImportRowResult.REJECTED, problem: 'Missing customer name' };
        continue;
      }
      if (!mapped.phoneNumber) {
        results[i] = { rowNumber, rawData, result: ImportRowResult.REJECTED, problem: 'Missing phone number' };
        continue;
      }

      let normalizedPhone: string;
      try {
        normalizedPhone = normalizePhoneNumber(mapped.phoneNumber);
      } catch {
        results[i] = {
          rowNumber,
          rawData,
          result: ImportRowResult.REJECTED,
          problem: `Not a valid Kenyan mobile number: "${mapped.phoneNumber}"`,
        };
        continue;
      }

      if (seenInFile.has(normalizedPhone)) {
        results[i] = {
          rowNumber,
          rawData: { ...rawData, __normalizedPhone: normalizedPhone },
          result: ImportRowResult.DUPLICATE_SKIPPED,
          problem: 'Duplicate phone number within this file',
        };
        continue;
      }
      seenInFile.add(normalizedPhone);
      pending.push({ index: i, rowNumber, rawData: { ...rawData, __normalizedPhone: normalizedPhone }, normalizedPhone });
    }

    // One batched lookup for every candidate row instead of a Firestore
    // round-trip per row — this is what made large files slow to preview.
    const existingByPhone = await this.customers.findManyByPhone(pending.map((p) => p.normalizedPhone));
    for (const p of pending) {
      const existing = existingByPhone.get(p.normalizedPhone);
      results[p.index] = existing
        ? {
            rowNumber: p.rowNumber,
            rawData: p.rawData,
            result: ImportRowResult.DUPLICATE_SKIPPED,
            customerId: existing.id,
            problem: `Already on record as ${existing.fullName}`,
          }
        : { rowNumber: p.rowNumber, rawData: p.rawData, result: ImportRowResult.CREATED };
    }

    return results;
  }

  private async writeRows(jobId: string, rows: ImportRow[]): Promise<void> {
    const chunks = chunk(rows, 400);
    for (const rowsChunk of chunks) {
      const batch = this.firestore.batch();
      for (const row of rowsChunk) {
        batch.set(this.rowsCol(jobId).doc(String(row.rowNumber)), row);
      }
      await batch.commit();
    }
  }

  private summarize(rows: ImportRow[]) {
    return {
      createdCount: rows.filter((r) => r.result === ImportRowResult.CREATED).length,
      duplicateCount: rows.filter((r) => r.result === ImportRowResult.DUPLICATE_SKIPPED).length,
      rejectedCount: rows.filter((r) => r.result === ImportRowResult.REJECTED).length,
    };
  }

  async findJob(id: string): Promise<ImportJob> {
    const snap = await this.jobsCol().doc(id).get();
    if (!snap.exists) throw new NotFoundException('Import job not found');
    return fromDoc<ImportJob>(snap);
  }

  async listRows(id: string): Promise<ImportRow[]> {
    await this.findJob(id);
    const snap = await this.rowsCol(id).orderBy('rowNumber').get();
    return snap.docs.map((d) => d.data() as ImportRow);
  }

  /**
   * Re-classifies every row against a caller-supplied column mapping —
   * lets the user correct auto-detection instead of being stuck with it.
   * Nothing has been written to the customers collection yet at this
   * point, so this just re-derives the preview from the original file
   * data already stored on each row (minus our own __-prefixed fields).
   */
  async remapColumns(id: string, columnMapping: Record<string, string>): Promise<ImportJob> {
    const job = await this.findJob(id);
    if (job.status === ImportStatus.COMPLETED) {
      throw new BadRequestException('This import has already been completed');
    }
    const allowedFields: (keyof MappedRow)[] = ['fullName', 'phoneNumber', 'homeStationId', 'registeredDate'];
    for (const field of Object.values(columnMapping)) {
      if (!allowedFields.includes(field as keyof MappedRow)) {
        throw new BadRequestException(`Unknown customer field: ${field}`);
      }
    }
    if (!Object.values(columnMapping).includes('fullName') || !Object.values(columnMapping).includes('phoneNumber')) {
      throw new BadRequestException('Choose a column for both Customer name and Phone number');
    }

    const existingRows = await this.listRows(id);
    const originalRows = existingRows
      .sort((a, b) => a.rowNumber - b.rowNumber)
      .map((r) => stripInternalFields(r.rawData));

    const classified = await this.classifyRows(originalRows, columnMapping, job.homeStationId);
    await this.writeRows(id, classified);

    const counts = this.summarize(classified);
    await this.jobsCol().doc(id).update({ columnMapping, ...counts, updatedAt: nowIso() });

    return this.findJob(id);
  }

  /**
   * Creates a Customer for every row classified CREATED, applies the
   * caller's decision (skip vs merge home station) for each duplicate, and
   * writes a per-row error report to GCS for anything rejected.
   */
  async confirm(
    id: string,
    duplicateDecisions: Record<number, DuplicateAction>,
    actor: StaffPrincipal,
  ): Promise<ImportJob> {
    const job = await this.findJob(id);
    if (job.status === ImportStatus.COMPLETED) return job;

    const rows = await this.listRows(id);
    const toCreate = rows.filter((r) => r.result === ImportRowResult.CREATED);
    const toMerge = rows.filter(
      (r) =>
        r.result === ImportRowResult.DUPLICATE_SKIPPED &&
        r.customerId &&
        (duplicateDecisions[r.rowNumber] ?? 'skip') === 'merge' &&
        r.rawData.__mappedHomeStationId,
    );

    // Batched writes instead of one create()/update() round-trip per row
    // — the sequential version is what made confirming a large import slow.
    const now = nowIso();
    let created = 0;
    for (const rowsChunk of chunk(toCreate, 400)) {
      const batch = this.firestore.batch();
      for (const row of rowsChunk) {
        const doc: Omit<Customer, 'id'> = {
          fullName: row.rawData.__mappedFullName!,
          phoneNumber: row.rawData.__normalizedPhone!,
          homeStationId: row.rawData.__mappedHomeStationId,
          totalCashbackEarned: 0,
          source: 'import',
          createdAt: now,
          updatedAt: now,
        };
        batch.set(this.customers.col().doc(), doc);
        created++;
      }
      await batch.commit();
    }

    let merged = 0;
    for (const rowsChunk of chunk(toMerge, 400)) {
      const batch = this.firestore.batch();
      for (const row of rowsChunk) {
        batch.update(this.customers.col().doc(row.customerId!), {
          homeStationId: row.rawData.__mappedHomeStationId,
          updatedAt: now,
        });
        merged++;
      }
      await batch.commit();
    }

    const rejectedRows = rows.filter((r) => r.result === ImportRowResult.REJECTED);
    let errorReportGcsPath: string | undefined;
    if (rejectedRows.length > 0) {
      const csv = this.buildErrorReportCsv(rejectedRows);
      errorReportGcsPath = await this.storage.uploadBuffer(
        'import-error-reports',
        `${id}-errors.csv`,
        Buffer.from(csv, 'utf-8'),
        'text/csv',
      );
    }

    await this.jobsCol().doc(id).update({
      status: ImportStatus.COMPLETED,
      createdCount: created,
      errorReportGcsPath,
      updatedAt: nowIso(),
    });

    return this.findJob(id);
  }

  private buildErrorReportCsv(rows: ImportRow[]): string {
    const header = 'row,problem,rawData\n';
    const lines = rows.map(
      (r) => `${r.rowNumber},"${(r.problem ?? '').replace(/"/g, '""')}","${JSON.stringify(r.rawData).replace(/"/g, '""')}"`,
    );
    return header + lines.join('\n');
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function stripInternalFields(rawData: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawData)) {
    if (!key.startsWith('__')) out[key] = value;
  }
  return out;
}
