import { ApiProperty } from '@nestjs/swagger';
import { UserStatus } from '@loyalty/shared';
import { IsEnum } from 'class-validator';

export class UpdateAttendantStatusDto {
  @ApiProperty({ enum: UserStatus, enumName: 'UserStatus' })
  @IsEnum(UserStatus)
  status!: UserStatus;
}
