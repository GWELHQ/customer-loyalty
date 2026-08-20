import { Module } from '@nestjs/common';
import { AttendantsModule } from '../attendants/attendants.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MicrosoftOidcService } from './microsoft-oidc.service';

@Module({
  imports: [UsersModule, AttendantsModule],
  controllers: [AuthController],
  providers: [AuthService, MicrosoftOidcService],
})
export class AuthModule {}
