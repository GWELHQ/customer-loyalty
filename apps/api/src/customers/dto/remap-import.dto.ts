import { ApiProperty } from '@nestjs/swagger';
import { IsObject } from 'class-validator';

export class RemapImportDto {
  @ApiProperty({
    description: 'Column-in-file -> customer-field mapping, replacing whatever was auto-detected.',
    example: { 'Customer Name': 'fullName', 'Phone': 'phoneNumber' },
  })
  @IsObject()
  columnMapping!: Record<string, string>;
}
