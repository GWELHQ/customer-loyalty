import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';
import { AfricasTalkingSmsProvider } from './africastalking-sms.provider';
import { MockSmsProvider } from './mock-sms.provider';
import { SMS_PROVIDER } from './sms-provider.interface';
import { SmsController } from './sms.controller';
import { SmsService } from './sms.service';

@Module({
  controllers: [SmsController],
  providers: [
    AfricasTalkingSmsProvider,
    MockSmsProvider,
    {
      provide: SMS_PROVIDER,
      useFactory: (config: ConfigService<AppConfig, true>, africastalking: AfricasTalkingSmsProvider, mock: MockSmsProvider) =>
        config.get('sms', { infer: true }).provider === 'africastalking' ? africastalking : mock,
      inject: [ConfigService, AfricasTalkingSmsProvider, MockSmsProvider],
    },
    SmsService,
  ],
  exports: [SmsService],
})
export class SmsModule {}
