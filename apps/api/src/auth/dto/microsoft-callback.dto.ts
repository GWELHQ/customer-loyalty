import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class MicrosoftCallbackDto {
  @ApiProperty({ description: 'The raw Microsoft Entra ID id_token obtained by the SPA via MSAL.js' })
  @IsString()
  @MinLength(10)
  idToken!: string;
}
