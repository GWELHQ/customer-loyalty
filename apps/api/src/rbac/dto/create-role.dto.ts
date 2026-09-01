import { ApiProperty } from '@nestjs/swagger';
import { Permission } from '@loyalty/shared';
import { ArrayMinSize, IsArray, IsIn, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateRoleDto {
  @ApiProperty({ description: 'Lowercase snake_case, 3-64 characters, starting with a letter. Cannot be changed later.' })
  @IsString()
  @Matches(/^[a-z][a-z0-9_]{2,63}$/)
  key!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  displayName!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(500)
  description!: string;

  @ApiProperty({ enum: Permission, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(Object.values(Permission), { each: true })
  permissions!: Permission[];
}
