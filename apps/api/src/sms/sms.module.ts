import { Module } from '@nestjs/common';
import { MockSmsProvider } from './mock-sms.provider';
import { SMS_PROVIDER } from './sms-provider.interface';
import { SmsService } from './sms.service';

@Module({
  providers: [
    // SMS_PROVIDER is always the mock in this deliverable. Swap this
    // factory for a real provider class (e.g. Africa's Talking) in prod —
    // SmsService and every caller only depend on the SmsProvider interface.
    { provide: SMS_PROVIDER, useClass: MockSmsProvider },
    SmsService,
  ],
  exports: [SmsService],
})
export class SmsModule {}
