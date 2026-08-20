import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';

export class ConfirmImportDto {
  @ApiPropertyOptional({
    description: 'Map of row number to how to resolve each duplicate. Defaults to "skip".',
    example: { '14': 'merge', '22': 'skip' },
  })
  @IsOptional()
  duplicateDecisions?: Record<string, 'skip' | 'merge'>;
}

export function normalizeDuplicateDecisions(
  input?: Record<string, 'skip' | 'merge'>,
): Record<number, 'skip' | 'merge'> {
  const out: Record<number, 'skip' | 'merge'> = {};
  for (const [k, v] of Object.entries(input ?? {})) {
    if (v === 'skip' || v === 'merge') out[Number(k)] = v;
  }
  return out;
}
