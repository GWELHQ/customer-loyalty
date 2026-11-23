import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { EMAIL_PROVIDER } from './email-provider.interface';
import { EmailRecipientSettingsService } from './email-recipient-settings.service';
import { EmailService } from './email.service';
import { MicrosoftGraphEmailProvider } from './microsoft-graph-email.provider';
import { MockEmailProvider } from './mock-email.provider';

@Global()
@Module({
  providers: [
    MockEmailProvider,
    MicrosoftGraphEmailProvider,
    {
      provide: EMAIL_PROVIDER,
      useFactory: (config: ConfigService<AppConfig, true>, mock: MockEmailProvider, graph: MicrosoftGraphEmailProvider) =>
        ['microsoft-graph', 'graph'].includes(config.get('email', { infer: true }).provider) ? graph : mock,
      inject: [ConfigService, MockEmailProvider, MicrosoftGraphEmailProvider],
    },
    EmailRecipientSettingsService,
    EmailService,
  ],
  exports: [EmailService, EmailRecipientSettingsService],
})
export class EmailModule {}
