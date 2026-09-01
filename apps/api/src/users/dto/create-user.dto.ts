import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '@loyalty/shared';
import { IsEmail, IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';

export class CreateUserDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  fullName!: string;

  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty({ description: 'A built-in Role value, or a custom role key created via /rbac/roles.' })
  @IsString()
  role!: string;

  @ApiPropertyOptional({ description: 'Required and singular when role is station_supervisor' })
  @ValidateIf((o) => o.role === Role.STATION_SUPERVISOR)
  @IsString()
  @IsOptional()
  assignedStationId?: string;
}
